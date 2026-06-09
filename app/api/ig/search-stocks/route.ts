import { NextResponse } from "next/server";
import { igLogin, igSearchMarket } from "@/lib/ig-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NEW_STOCKS = [
  { symbol: "SOFI", name: "SoFi Technologies" },
  { symbol: "MARA", name: "Marathon Digital" },
  { symbol: "RIOT", name: "Riot Platforms" },
  { symbol: "DDOG", name: "Datadog" },
  { symbol: "SNOW", name: "Snowflake" },
  { symbol: "AVGO", name: "Broadcom" },
];

export async function GET() {
  try {
    await igLogin();
    const results: Record<string, any> = {};

    for (const stock of NEW_STOCKS) {
      let market = await igSearchMarket(stock.symbol);
      if (!market || market.bid === 0) {
        market = await igSearchMarket(stock.name);
      }
      results[stock.symbol] = market ? {
        epic: market.epic,
        name: market.instrumentName,
        bid: market.bid,
        offer: market.offer,
        percentageChange: market.percentageChange,
      } : "NOT FOUND";

      await new Promise(r => setTimeout(r, 300));
    }

    return NextResponse.json({ timestamp: new Date().toISOString(), results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
