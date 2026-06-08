import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TRACKED_STOCKS, TRIGGER_PCT, TAKE_PROFIT_PCT, STOP_LOSS_PCT } from "@/lib/stocks";
import { fetchAllQuotes } from "@/lib/yahoo";
import { gatherIntelligence } from "@/lib/intelligence";
import type { StockQuote, AIAnalysis } from "@/lib/types";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

async function analyseWithFullContext(quote: StockQuote, briefing: string): Promise<AIAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

1. NEWS CATALYST — Is there a clear reason? Earnings? Geopolitical? If news-driven, moves tend to sustain.
2. MACRO ALIGNMENT — Is the broader market confirming or contradicting?
3. SECTOR CONTEXT — Whole sector moving, or just this stock?
4. MOMENTUM vs EXHAUSTION — Has the move run its course, or room to extend?
5. GOVERNMENT/POLICY — Tariffs, regulation, rate decisions?
6. SPREAD BET MECHANICS — £/point stake, auto-close at +${TAKE_PROFIT_PCT}% or -${STOP_LOSS_PCT}%, intraday only.

Choose: LONG / SHORT / AVOID. Stake: £0.5–£3/pt based on conviction.

Respond with ONLY this JSON:
{"direction":"LONG"|"SHORT"|"AVOID","confidence":0-100,"stakePerPoint":0.5|1|2|3,"reasoning":"3-4 sentences."}`;

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

    // 1. Fetch ALL 25 stock prices in one batch call (not 25 individual calls)
    const symbols = TRACKED_STOCKS.map(s => s.symbol);
    const rawQuotes = await fetchAllQuotes(symbols);

    const quotes: StockQuote[] = rawQuotes.map(q => {
      const stock = TRACKED_STOCKS.find(s => s.symbol === q.symbol);
      const price = q.regularMarketPrice;
      const prev = q.regularMarketPreviousClose || price;
      const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
      return {
        symbol: q.symbol,
        name: stock?.name ?? q.symbol,
        price,
        previousClose: prev,
        changePercent: Math.round(changePct * 100) / 100,
        high: q.regularMarketDayHigh || price,
        low: q.regularMarketDayLow || price,
        volume: q.regularMarketVolume || 0,
        marketCap: q.marketCap,
        updatedAt: new Date().toISOString(),
        marketOpen,
      };
    });

    // 2. Find triggered stocks (>3% move)
    const triggered = quotes.filter(q => Math.abs(q.changePercent) >= TRIGGER_PCT);

    // 3. For each triggered stock: gather FULL intelligence + run AI
    const analyses: AIAnalysis[] = [];

    if (triggered.length > 0 && process.env.ANTHROPIC_API_KEY) {
      // Run intelligence gathering + AI analysis sequentially to stay within timeout
      for (const q of triggered.slice(0, 3)) { // max 3 per scan to stay in budget
        try {
          const intel = await gatherIntelligence(q);
          const analysis = await analyseWithFullContext(q, intel.briefing);
          if (analysis) {
            const headlines = intel.stockNews
              .slice(0, 5)
              .map(n => n.headline);
            analysis.newsHeadlines = headlines;
            analyses.push(analysis);
          }
        } catch (err) {
          console.error(`Intel/analysis failed for ${q.symbol}:`, err);
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
    return NextResponse.json({ error: "Scan failed", detail: String(err) }, { status: 500 });
  }
}
