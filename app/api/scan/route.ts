import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";
import Anthropic from "@anthropic-ai/sdk";
import { TRACKED_STOCKS, TRIGGER_PCT, STAKE_PER_POINT, TAKE_PROFIT_PCT, STOP_LOSS_PCT } from "@/lib/stocks";
import type { StockQuote, NewsItem, AIAnalysis } from "@/lib/types";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const NEWS_API_KEY = process.env.NEWS_API_KEY;

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
      symbol,
      name,
      price,
      previousClose: prev,
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

async function fetchNews(symbol: string, name: string): Promise<NewsItem[]> {
  if (!NEWS_API_KEY) return [];
  try {
    const query = encodeURIComponent(`${name} stock`);
    const res = await fetch(`https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&pageSize=8&language=en&apiKey=${NEWS_API_KEY}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles ?? []).slice(0, 8).map((a: { title?: string; description?: string; source?: { name?: string }; url?: string; publishedAt?: string }) => ({
      symbol,
      headline: a.title ?? "",
      summary: a.description ?? "",
      source: a.source?.name ?? "",
      url: a.url ?? "",
      publishedAt: a.publishedAt ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

async function analyseStock(quote: StockQuote, news: NewsItem[]): Promise<AIAnalysis | null> {
  const headlines = news.map(n => `• ${n.headline} (${n.source})`).join("\n");
  const direction = quote.changePercent > 0 ? "UP" : "DOWN";

  const prompt = `You are an expert intraday spread bet trader analysing whether a stock move is real or will reverse.

STOCK: ${quote.name} (${quote.symbol})
CURRENT PRICE: $${quote.price.toFixed(2)}
TODAY'S MOVE: ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% (${direction})
DAY HIGH: $${quote.high.toFixed(2)} | DAY LOW: $${quote.low.toFixed(2)}
VOLUME: ${(quote.volume / 1_000_000).toFixed(1)}M
TIME: ${new Date().toUTCString()}

RECENT NEWS:
${headlines || "No recent news available."}

ANALYSIS REQUIRED:
1. Is this ${Math.abs(quote.changePercent).toFixed(1)}% move justified by the news, or is it likely an intraday overreaction?
2. Will it sustain/extend, or will it revert toward the open?
3. Should we go LONG (bet it stays up / goes higher), SHORT (bet it drops / reverses), or AVOID?

RULES:
- Intraday ONLY — auto-close at +${TAKE_PROFIT_PCT}% profit or -${STOP_LOSS_PCT}% loss
- We can go LONG or SHORT
- Only trade when you have conviction — AVOID is often the right call
- News-driven moves (earnings, FDA, M&A) tend to sustain
- Momentum exhaustion after big moves is common — consider shorting overextended stocks
- Low volume moves are less reliable

Respond ONLY with JSON:
{"direction":"LONG"|"SHORT"|"AVOID","confidence":0-100,"stakePerPoint":0.5|1|2|3,"reasoning":"2-3 sentences explaining your analysis"}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
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
      stakePerPoint: parsed.stakePerPoint ?? STAKE_PER_POINT,
      newsHeadlines: news.slice(0, 5).map(n => n.headline),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`Analysis error for ${quote.symbol}:`, err);
    return null;
  }
}

/** Full scan: fetch all prices, identify triggers, gather news, run AI, return results */
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

    // 3. For each triggered stock: fetch news + run AI analysis
    const analyses: AIAnalysis[] = [];
    if (triggered.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const analysisResults = await Promise.allSettled(
        triggered.map(async (q) => {
          const news = await fetchNews(q.symbol, q.name);
          return analyseStock(q, news);
        })
      );
      for (const r of analysisResults) {
        if (r.status === "fulfilled" && r.value) analyses.push(r.value);
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
