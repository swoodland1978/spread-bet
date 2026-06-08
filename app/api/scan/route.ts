import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TRACKED_STOCKS, TRIGGER_PCT, TAKE_PROFIT_PCT, STOP_LOSS_PCT } from "@/lib/stocks";
import type { StockQuote, AIAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

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

// ── Fetch prices directly from Finnhub ───────────────────────────────────────

async function fetchFinnhubQuote(symbol: string): Promise<StockQuote | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c || d.c === 0) return null;
    const price = d.c as number;
    const prev = d.pc as number;
    const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    const stock = TRACKED_STOCKS.find(s => s.symbol === symbol);
    return {
      symbol,
      name: stock?.name ?? symbol,
      price,
      previousClose: prev,
      changePercent: Math.round(changePct * 100) / 100,
      high: d.h as number,
      low: d.l as number,
      volume: 0,
      updatedAt: new Date().toISOString(),
      marketOpen: isMarketOpen(),
    };
  } catch {
    return null;
  }
}

// ── AI Analysis ──────────────────────────────────────────────────────────────

async function analyseStock(quote: StockQuote): Promise<AIAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // Gather news from RSS feeds
  let briefing = "No news data available.";
  try {
    const { gatherIntelligence } = await import("@/lib/intelligence");
    const intel = await gatherIntelligence(quote);
    briefing = intel.briefing;
  } catch (err) {
    console.error("Intel gathering failed:", err);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const direction = quote.changePercent > 0 ? "UP" : "DOWN";

  const prompt = `You are a world-class intraday spread bet trader. Analyse this stock move.

STOCK: ${quote.name} (${quote.symbol})
PRICE: $${quote.price.toFixed(2)} | PREV CLOSE: $${quote.previousClose.toFixed(2)}
MOVE: ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% (${direction})
RANGE: $${quote.low.toFixed(2)} – $${quote.high.toFixed(2)}

${briefing}

Choose LONG / SHORT / AVOID. Stake £0.5–£3/pt. Auto-close at +${TAKE_PROFIT_PCT}% or -${STOP_LOSS_PCT}%.
Respond ONLY with JSON:
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
      id: uid(),
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
    console.error(`AI error for ${quote.symbol}:`, err);
    return null;
  }
}

// ── Main scan endpoint ───────────────────────────────────────────────────────

export async function GET() {
  const errors: string[] = [];
  const marketOpen = isMarketOpen();
  let quotes: StockQuote[] = [];
  const analyses: AIAnalysis[] = [];

  // 1. Fetch all stock prices from Finnhub (5 at a time)
  try {
    const symbols = TRACKED_STOCKS.map(s => s.symbol);
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += 5) {
      batches.push(symbols.slice(i, i + 5));
    }
    for (const batch of batches) {
      const results = await Promise.allSettled(batch.map(s => fetchFinnhubQuote(s)));
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) quotes.push(r.value);
      }
    }
  } catch (err) {
    errors.push(`Price fetch: ${String(err)}`);
  }

  // 2. Find triggered stocks
  const triggered = quotes.filter(q => Math.abs(q.changePercent) >= TRIGGER_PCT);

  // 3. AI analysis for triggered stocks (max 3 to stay in timeout)
  if (triggered.length > 0 && process.env.ANTHROPIC_API_KEY) {
    for (const q of triggered.slice(0, 3)) {
      try {
        const analysis = await analyseStock(q);
        if (analysis) analyses.push(analysis);
      } catch (err) {
        errors.push(`Analysis ${q.symbol}: ${String(err)}`);
      }
    }
  }

  return NextResponse.json({
    quotes,
    triggered: triggered.map(q => q.symbol),
    analyses,
    marketOpen,
    scannedAt: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
    debug: { quotesCount: quotes.length, triggeredCount: triggered.length },
  });
}
