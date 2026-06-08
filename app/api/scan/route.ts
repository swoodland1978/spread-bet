import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";
import Anthropic from "@anthropic-ai/sdk";
import { TRACKED_STOCKS, TRIGGER_PCT, TAKE_PROFIT_PCT, STOP_LOSS_PCT } from "@/lib/stocks";
import { gatherIntelligence } from "@/lib/intelligence";
import type { StockQuote, AIAnalysis } from "@/lib/types";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isMarketOpen(): boolean {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const etOffset = -5 * 60 * 60000;
  const etTime = new Date(utc + etOffset);
  const day = etTime.getDay();
  const totalMins = etTime.getHours() * 60 + etTime.getMinutes();
  if (day === 0 || day === 6) return false;
  return totalMins >= 570 && totalMins < 960;
}

async function fetchQuote(symbol: string, name: string): Promise<StockQuote | null> {
  try {
    const q = await yahooFinance.quote(symbol);
    const data = q as Record<string, unknown>;
    const price = (data.regularMarketPrice as number) ?? 0;
    const prev = (data.regularMarketPreviousClose as number) ?? price;
    const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return {
      symbol, name, price, previousClose: prev,
      changePercent: Math.round(changePct * 100) / 100,
      high: (data.regularMarketDayHigh as number) ?? price,
      low: (data.regularMarketDayLow as number) ?? price,
      volume: (data.regularMarketVolume as number) ?? 0,
      marketCap: data.marketCap as number | undefined,
      updatedAt: new Date().toISOString(),
      marketOpen: isMarketOpen(),
    };
  } catch {
    return null;
  }
}

async function analyseWithFullContext(quote: StockQuote, briefing: string): Promise<AIAnalysis | null> {
  const direction = quote.changePercent > 0 ? "UP" : "DOWN";

  const prompt = `You are a world-class intraday spread bet trader. A stock in our watchlist has moved significantly. You have been given comprehensive market intelligence — use ALL of it to determine whether this move is real and sustainable, or whether it will reverse.

══════════════════════════════════════════════
TRIGGERED STOCK: ${quote.name} (${quote.symbol})
CURRENT PRICE: $${quote.price.toFixed(2)}
PREVIOUS CLOSE: $${quote.previousClose.toFixed(2)}
TODAY'S MOVE: ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% (${direction})
DAY RANGE: $${quote.low.toFixed(2)} – $${quote.high.toFixed(2)}
VOLUME: ${(quote.volume / 1_000_000).toFixed(1)}M shares
══════════════════════════════════════════════

${briefing}

══════════════════════════════════════════════
YOUR TASK:
══════════════════════════════════════════════

Analyse this ${Math.abs(quote.changePercent).toFixed(1)}% move using everything above. Consider:

1. NEWS CATALYST — Is there a clear reason for this move? Earnings? FDA? Geopolitical? If news-driven, moves tend to sustain. If no catalyst, it's likely noise.

2. MACRO ALIGNMENT — Is the broader market moving the same direction? If NASDAQ is down 2% and this stock is down 4%, the extra 2% might revert. If NASDAQ is flat and this stock dropped 5%, something stock-specific is happening.

3. SECTOR CONTEXT — Is the whole sector moving, or just this stock? Sector-wide moves are harder to fade. Single-stock moves on news are more tradeable.

4. MOMENTUM vs EXHAUSTION — Has the stock already made its big move (price near day high/low), or is there room to run? High volume confirms conviction. Low volume suggests the move may fade.

5. GOVERNMENT/POLICY — Any tariffs, regulation, rate decisions, or political events that could sustain or reverse this?

6. SPREAD BET MECHANICS — We bet £/point. Entry includes the spread cost. Auto-close at +${TAKE_PROFIT_PCT}% or -${STOP_LOSS_PCT}%. Position held intraday only.

Based on your analysis, choose the BEST trade:
- LONG: You believe the stock will continue higher or stay elevated
- SHORT: You believe the stock will reverse lower or the upward move will fade
- AVOID: Not enough conviction, or the risk/reward doesn't justify a trade

For stake sizing:
- £0.5/pt: Low conviction, small bet
- £1/pt: Moderate conviction
- £2/pt: High conviction, clear catalyst
- £3/pt: Very high conviction, strong edge

Respond with ONLY this JSON:
{"direction":"LONG"|"SHORT"|"AVOID","confidence":0-100,"stakePerPoint":0.5|1|2|3,"reasoning":"3-4 sentences. Explain what's driving the move, whether it's justified, what the macro context says, and why you chose this direction and stake size."}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as { type: string; text: string }).text
      .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(text);

    return {
      id: nanoid(),
      symbol: quote.symbol,
      name: quote.name,
      direction: parsed.direction,
      confidence: Math.min(100, Math.max(0, parsed.confidence ?? 50)),
      reasoning: parsed.reasoning ?? "",
      triggerPrice: quote.price,
      triggerChangePercent: quote.changePercent,
      stakePerPoint: parsed.stakePerPoint ?? 1,
      newsHeadlines: [],
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`Analysis error for ${quote.symbol}:`, err);
    return null;
  }
}

export async function GET() {
  try {
    const marketOpen = isMarketOpen();

    // 1. Fetch all 25 stock prices in parallel
    const quoteResults = await Promise.allSettled(
      TRACKED_STOCKS.map(s => fetchQuote(s.symbol, s.name))
    );
    const quotes: StockQuote[] = quoteResults
      .filter((r): r is PromiseFulfilledResult<StockQuote | null> => r.status === "fulfilled")
      .map(r => r.value)
      .filter((q): q is StockQuote => q !== null);

    // 2. Find triggered stocks (>3% move)
    const triggered = quotes.filter(q => Math.abs(q.changePercent) >= TRIGGER_PCT);

    // 3. For each triggered stock: gather FULL intelligence + run AI
    const analyses: AIAnalysis[] = [];
    const intelligenceSummaries: Record<string, string> = {};

    if (triggered.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const results = await Promise.allSettled(
        triggered.map(async (q) => {
          // Gather comprehensive intelligence: stock news, macro, indices, sector
          const intel = await gatherIntelligence(q);
          intelligenceSummaries[q.symbol] = intel.briefing;
          // Feed everything to the AI
          const analysis = await analyseWithFullContext(q, intel.briefing);
          return analysis;
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          // Attach top news headlines to the analysis for display
          const symbol = r.value.symbol;
          const stockNews = intelligenceSummaries[symbol];
          const headlines = stockNews
            ?.split("\n")
            .filter(l => l.startsWith("• "))
            .map(l => l.replace("• ", "").replace(/ \(.*$/, ""))
            .slice(0, 5) ?? [];
          r.value.newsHeadlines = headlines;
          analyses.push(r.value);
        }
      }
    }

    return NextResponse.json({
      quotes,
      triggered: triggered.map(q => q.symbol),
      analyses,
      marketOpen,
      scannedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Scan error:", err);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
