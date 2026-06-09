import { NextResponse } from "next/server";
import { igLogin, igSearchMarket } from "@/lib/ig-client";
import { TRACKED_STOCKS } from "@/lib/stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Look up IG EPICs for all our tracked stocks */
export async function GET() {
  try {
    await igLogin();
    const results: Record<string, unknown> = {};

    for (const stock of TRACKED_STOCKS) {
      // Search by ticker symbol first, fall back to company name
      let market = await igSearchMarket(stock.symbol);
      if (!market || market.bid === 0) {
        market = await igSearchMarket(stock.name);
      }
      results[stock.symbol] = market ? {
        epic: market.epic,
        name: market.instrumentName,
        expiry: market.expiry,
        bid: market.bid,
        offer: market.offer,
        change: market.percentageChange,
      } : "NOT FOUND";

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    return NextResponse.json({ timestamp: new Date().toISOString(), markets: results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
