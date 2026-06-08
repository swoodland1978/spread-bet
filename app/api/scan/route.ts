import { NextResponse } from "next/server";
import { TRACKED_STOCKS, TRIGGER_PCT } from "@/lib/stocks";
import type { StockQuote } from "@/lib/types";

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

export async function GET() {
  const errors: string[] = [];
  const marketOpen = isMarketOpen();
  const quotes: StockQuote[] = [];

  // Fetch all stock prices from Finnhub (3 at a time with delay)
  try {
    const symbols = TRACKED_STOCKS.map(s => s.symbol);
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += 3) {
      batches.push(symbols.slice(i, i + 3));
    }
    for (let i = 0; i < batches.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 250));
      const results = await Promise.allSettled(batches[i].map(s => fetchFinnhubQuote(s)));
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) quotes.push(r.value);
      }
    }
  } catch (err) {
    errors.push(`Price fetch: ${String(err)}`);
  }

  // Identify triggered stocks (>4% move) — trades are opened client-side mechanically
  const triggered = quotes.filter(q => Math.abs(q.changePercent) >= TRIGGER_PCT);

  return NextResponse.json({
    quotes,
    triggered: triggered.map(q => q.symbol),
    marketOpen,
    scannedAt: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
  });
}
