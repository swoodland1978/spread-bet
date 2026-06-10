import { NextRequest, NextResponse } from "next/server";
import { igOpenPosition } from "@/lib/ig-client";
import { TRACKED_STOCKS, STAKE_PER_POINT } from "@/lib/stocks";

export const dynamic = "force-dynamic";

// Test-only endpoint — forces a trade bypassing all trigger logic
export async function POST(req: NextRequest) {
  const { symbol, direction } = await req.json() as { symbol: string; direction: "BUY" | "SELL" };

  const stock = TRACKED_STOCKS.find(s => s.symbol === symbol.toUpperCase());
  if (!stock) {
    return NextResponse.json({ error: `Unknown symbol: ${symbol}` }, { status: 400 });
  }
  if (direction !== "BUY" && direction !== "SELL") {
    return NextResponse.json({ error: "direction must be BUY or SELL" }, { status: 400 });
  }

  try {
    const result = await igOpenPosition({
      epic: stock.igEpic,
      direction,
      size: STAKE_PER_POINT,
      expiry: "-",
    });
    return NextResponse.json({ success: true, symbol, direction, ...result });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
