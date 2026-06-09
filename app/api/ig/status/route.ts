import { NextResponse } from "next/server";
import { igLogin, igGetAccount, igGetPositions, igSearchMarket } from "@/lib/ig-client";

export const dynamic = "force-dynamic";

/** Test IG connection: login, get account, list ALL accounts, get positions */
export async function GET() {
  const results: Record<string, unknown> = { timestamp: new Date().toISOString(), targetAccountId: process.env.IG_ACCOUNT_ID };

  // 1. Test login
  try {
    const session = await igLogin();
    results.login = { success: true, accountId: session.accountId };
  } catch (err) {
    results.login = { success: false, error: String(err) };
    return NextResponse.json(results);
  }

  // 2. List ALL accounts (to see if Z6BWKI exists)
  try {
    const session = await igLogin();
    const res = await fetch("https://demo-api.ig.com/gateway/deal/accounts", {
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
    results.allAccounts = (data.accounts ?? []).map((a: Record<string, unknown>) => ({
      accountId: a.accountId,
      accountName: a.accountName,
      accountType: a.accountType,
      preferred: a.preferred,
      balance: (a.balance as Record<string, unknown>)?.balance,
    }));
  } catch (err) {
    results.allAccounts = { error: String(err) };
  }

  // 3. Get account info (for current/switched account)
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
