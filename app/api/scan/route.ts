import { NextResponse } from "next/server";
import { igLogin, igGetAccount, igGetPositions } from "@/lib/ig-client";
import { TRACKED_STOCKS, TRIGGER_PCT } from "@/lib/stocks";
import type { StockQuote } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IG_DEMO_URL = "https://demo-api.ig.com/gateway/deal";

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

/** Fetch prices from IG for a specific EPIC */
async function fetchIGPrice(epic: string, session: { cst: string; securityToken: string }): Promise<{ bid: number; offer: number; percentageChange: number; high: number; low: number } | null> {
  try {
    const res = await fetch(`${IG_DEMO_URL}/markets/${epic}`, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json; charset=UTF-8",
        "X-IG-API-KEY": process.env.IG_API_KEY!,
        "CST": session.cst,
        "X-SECURITY-TOKEN": session.securityToken,
        "VERSION": "3",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const snap = data.snapshot ?? {};
    return {
      bid: snap.bid ?? 0,
      offer: snap.offer ?? 0,
      percentageChange: snap.percentageChange ?? 0,
      high: snap.high ?? 0,
      low: snap.low ?? 0,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const errors: string[] = [];
  const marketOpen = isMarketOpen();
  const quotes: StockQuote[] = [];

  try {
    // 1. Login to IG
    const session = await igLogin();

    // 2. Fetch prices for all stocks from IG (3 at a time with delay)
    const batches: typeof TRACKED_STOCKS[number][][] = [];
    for (let i = 0; i < TRACKED_STOCKS.length; i += 3) {
      batches.push(TRACKED_STOCKS.slice(i, i + 3));
    }

    for (let i = 0; i < batches.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      const results = await Promise.allSettled(
        batches[i].map(async (stock) => {
          const price = await fetchIGPrice(stock.igEpic, session);
          if (!price || (price.bid === 0 && price.offer === 0)) return null;
          const midPrice = (price.bid + price.offer) / 2;
          return {
            symbol: stock.symbol,
            name: stock.name,
            price: midPrice,
            previousClose: midPrice / (1 + price.percentageChange / 100),
            changePercent: Math.round(price.percentageChange * 100) / 100,
            high: price.high,
            low: price.low,
            volume: 0,
            updatedAt: new Date().toISOString(),
            marketOpen,
            igEpic: stock.igEpic,
            bid: price.bid,
            offer: price.offer,
          } as StockQuote & { igEpic: string; bid: number; offer: number };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) quotes.push(r.value);
      }
    }

    // 3. Get IG account balance
    const account = await igGetAccount();

    // 4. Get IG open positions
    const igPositions = await igGetPositions();

    // 5. Find triggered stocks
    const triggered = quotes.filter(q => Math.abs(q.changePercent) >= TRIGGER_PCT);

    return NextResponse.json({
      quotes,
      triggered: triggered.map(q => q.symbol),
      marketOpen,
      scannedAt: new Date().toISOString(),
      igAccount: account,
      igPositions,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    errors.push(String(err));
    return NextResponse.json({
      quotes,
      triggered: [],
      marketOpen,
      scannedAt: new Date().toISOString(),
      errors,
    });
  }
}
