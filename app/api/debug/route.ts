import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      FINNHUB_API_KEY: process.env.FINNHUB_API_KEY ? `${process.env.FINNHUB_API_KEY.slice(0, 6)}...set` : "NOT SET",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.slice(0, 10)}...set` : "NOT SET",
      NEWS_API_KEY: process.env.NEWS_API_KEY ? "set" : "NOT SET",
    },
  };

  // Test Finnhub
  try {
    const key = process.env.FINNHUB_API_KEY;
    if (key) {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=TSLA&token=${key}`);
      const data = await res.json();
      debug.finnhub = { status: res.status, data };
    } else {
      debug.finnhub = "no key";
    }
  } catch (err) {
    debug.finnhub = { error: String(err) };
  }

  // Test Yahoo v8 chart
  try {
    const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=1d", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    const text = await res.text();
    debug.yahoo_v8 = { status: res.status, bodyLength: text.length, snippet: text.slice(0, 200) };
  } catch (err) {
    debug.yahoo_v8 = { error: String(err) };
  }

  // Test Yahoo v6
  try {
    const res = await fetch("https://query2.finance.yahoo.com/v6/finance/quote?symbols=TSLA", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const text = await res.text();
    debug.yahoo_v6 = { status: res.status, bodyLength: text.length, snippet: text.slice(0, 200) };
  } catch (err) {
    debug.yahoo_v6 = { error: String(err) };
  }

  return NextResponse.json(debug);
}
