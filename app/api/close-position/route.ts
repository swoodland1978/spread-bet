import { NextRequest, NextResponse } from "next/server";
import { igClosePosition } from "@/lib/ig-client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { dealId, direction, size } = await req.json();
  if (!dealId || !direction || !size) {
    return NextResponse.json({ error: "Missing dealId, direction, or size" }, { status: 400 });
  }
  const result = await igClosePosition(dealId, direction as "BUY" | "SELL", size);
  return NextResponse.json(result);
}
