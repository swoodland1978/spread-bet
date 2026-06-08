/** Stock price fetching — Finnhub first (reliable), Yahoo v8 fallback */

export interface QuoteResult {
  symbol: string;
  regularMarketPrice: number;
  regularMarketPreviousClose: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketVolume: number;
  marketCap?: number;
}

// ── Finnhub (PRIMARY — fast, reliable from serverless) ───────────────────────

async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<QuoteResult | null> {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c || d.c === 0) return null;
    return {
      symbol,
      regularMarketPrice: d.c,
      regularMarketPreviousClose: d.pc,
      regularMarketDayHigh: d.h,
      regularMarketDayLow: d.l,
      regularMarketVolume: 0, // Finnhub free doesn't include volume in quote
      marketCap: undefined,
    };
  } catch {
    return null;
  }
}

// ── Yahoo v8 chart (FALLBACK) ────────────────────────────────────────────────

async function fetchYahooV8Quote(symbol: string): Promise<QuoteResult | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return {
      symbol,
      regularMarketPrice: meta.regularMarketPrice,
      regularMarketPreviousClose: meta.previousClose ?? meta.chartPreviousClose ?? 0,
      regularMarketDayHigh: meta.regularMarketDayHigh ?? meta.regularMarketPrice,
      regularMarketDayLow: meta.regularMarketDayLow ?? meta.regularMarketPrice,
      regularMarketVolume: meta.regularMarketVolume ?? 0,
      marketCap: undefined,
    };
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch quotes for all symbols. Strategy:
 * 1. Finnhub (if key set) — batch of 5 at a time to respect rate limit
 * 2. Yahoo v8 chart — individual calls for any symbols Finnhub missed
 */
export async function fetchAllQuotes(symbols: string[]): Promise<QuoteResult[]> {
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const results = new Map<string, QuoteResult>();

  // Strategy 1: Finnhub — fetch in batches of 5 (rate limit: 60/min)
  if (finnhubKey) {
    console.log(`[Finnhub] Fetching ${symbols.length} symbols...`);
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += 5) {
      batches.push(symbols.slice(i, i + 5));
    }
    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(s => fetchFinnhubQuote(s, finnhubKey))
      );
      for (const r of batchResults) {
        if (r.status === "fulfilled" && r.value) {
          results.set(r.value.symbol, r.value);
        }
      }
    }
    console.log(`[Finnhub] Got ${results.size}/${symbols.length} quotes`);
  }

  // Strategy 2: Yahoo v8 for any missing symbols
  const missing = symbols.filter(s => !results.has(s));
  if (missing.length > 0) {
    console.log(`[Yahoo v8] Fetching ${missing.length} missing symbols...`);
    const yahooResults = await Promise.allSettled(
      missing.map(s => fetchYahooV8Quote(s))
    );
    for (const r of yahooResults) {
      if (r.status === "fulfilled" && r.value) {
        results.set(r.value.symbol, r.value);
      }
    }
    console.log(`[Yahoo v8] Total now: ${results.size}/${symbols.length}`);
  }

  return symbols.map(s => results.get(s)).filter((q): q is QuoteResult => q !== null);
}

/** Fetch a single symbol's change percent (for indices/ETFs) */
export async function fetchChangePercent(symbol: string): Promise<number | null> {
  // Indices use ^ prefix which Finnhub doesn't support — go straight to Yahoo
  if (symbol.startsWith("^") || symbol.includes("-")) {
    const q = await fetchYahooV8Quote(symbol);
    if (!q || !q.regularMarketPreviousClose) return null;
    return Math.round(((q.regularMarketPrice - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 10000) / 100;
  }

  const results = await fetchAllQuotes([symbol]);
  if (results.length === 0) return null;
  const q = results[0];
  if (!q.regularMarketPrice || !q.regularMarketPreviousClose) return null;
  return Math.round(((q.regularMarketPrice - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 10000) / 100;
}
