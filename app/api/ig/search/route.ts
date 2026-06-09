import { NextRequest, NextResponse } from "next/server";
import { igLogin } from "@/lib/ig-client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const term = req.nextUrl.searchParams.get("q") ?? "Tesla";
  try {
    const session = await igLogin();
    const res = await fetch(`https://demo-api.ig.com/gateway/deal/markets?searchTerm=${encodeURIComponent(term)}`, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json; charset=UTF-8",
        "X-IG-API-KEY": process.env.IG_API_KEY!,
        "CST": session.cst,
        "X-SECURITY-TOKEN": session.securityToken,
        "VERSION": "1",
      },
    });
    const data = await res.json();
    // Return all matches so we can pick the right one
    const markets = (data.markets ?? []).map((m: Record<string, unknown>) => ({
      epic: m.epic,
      name: m.instrumentName,
      type: m.instrumentType,
      expiry: m.expiry,
      bid: m.bid,
      offer: m.offer,
    }));
    return NextResponse.json({ term, count: markets.length, markets });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
