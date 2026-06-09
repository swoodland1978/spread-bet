import { NextResponse } from "next/server";
import { igLogin, igGetAccount, igGetPositions, igSearchMarket } from "@/lib/ig-client";

export const dynamic = "force-dynamic";

/** Test IG connection: login, get account, get positions, search a market */
export async function GET() {
  const results: Record<string, unknown> = { timestamp: new Date().toISOString() };

  // 1. Test login
  try {
    const session = await igLogin();
    results.login = { success: true, accountId: session.accountId };
  } catch (err) {
    results.login = { success: false, error: String(err) };
    return NextResponse.json(results);
  }

  // 2. Get account info
  try {
    const account = await igGetAccount();
    results.account = account;
  } catch (err) {
    results.account = { error: String(err) };
  }

  // 3. Get open positions
  try {
    const positions = await igGetPositions();
    results.positions = { count: positions.length, positions };
  } catch (err) {
    results.positions = { error: String(err) };
  }

  // 4. Test market search (Tesla)
  try {
    const market = await igSearchMarket("Tesla");
    results.marketSearch = market;
  } catch (err) {
    results.marketSearch = { error: String(err) };
  }

  return NextResponse.json(results);
}
