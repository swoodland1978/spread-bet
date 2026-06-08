import { NextResponse } from "next/server";
import yahooFinance from "yahoo-finance2";
import { TRACKED_STOCKS } from "@/lib/stocks";
import type { StockQuote } from "@/lib/types";

export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    const open = isMarketOpen();
    const quotes: StockQuote[] = [];

    // Fetch each stock individually to avoid typing issues with batch quote
    const results = await Promise.allSettled(
      TRACKED_STOCKS.map(async (stock) => {
        const q = await yahooFinance.quote(stock.symbol);
        const price = (q as Record<string, unknown>).regularMarketPrice as number ?? 0;
        const prev = (q as Record<string, unknown>).regularMarketPreviousClose as number ?? price;
        const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
        return {
          symbol: stock.symbol,
          name: stock.name,
          price,
          previousClose: prev,
          changePercent: Math.round(changePct * 100) / 100,
          high: (q as Record<string, unknown>).regularMarketDayHigh as number ?? price,
          low: (q as Record<string, unknown>).regularMarketDayLow as number ?? price,
          volume: (q as Record<string, unknown>).regularMarketVolume as number ?? 0,
          marketCap: (q as Record<string, unknown>).marketCap as number | undefined,
          updatedAt: new Date().toISOString(),
          marketOpen: open,
        } satisfies StockQuote;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") quotes.push(r.value);
    }

    return NextResponse.json({ quotes, marketOpen: open });
  } catch (err) {
    console.error("Price fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch prices" }, { status: 500 });
  }
}
