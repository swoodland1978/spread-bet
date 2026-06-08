import { NextResponse } from "next/server";
import { TRACKED_STOCKS } from "@/lib/stocks";
import { fetchYahooQuotes } from "@/lib/yahoo";
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
    const symbols = TRACKED_STOCKS.map(s => s.symbol);
    const rawQuotes = await fetchYahooQuotes(symbols);

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
        marketOpen: open,
      };
    });

    return NextResponse.json({ quotes, marketOpen: open });
  } catch (err) {
    console.error("Price fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch prices" }, { status: 500 });
  }
}
