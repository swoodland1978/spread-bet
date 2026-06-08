/** Stock price fetching — multiple strategies with fallbacks */

export interface YahooQuoteResult {
  symbol: string;
  regularMarketPrice: number;
  regularMarketPreviousClose: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketVolume: number;
  marketCap?: number;
}

/**
 * Strategy 1: Yahoo Finance v8 chart API — most reliable, no auth needed.
 * Fetches each symbol individually via the chart endpoint.
 */
async function fetchViaChart(symbol: string): Promise<YahooQuoteResult | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    return {
      symbol,
      regularMarketPrice: meta.regularMarketPrice ?? 0,
      regularMarketPreviousClose: meta.previousClose ?? meta.chartPreviousClose ?? 0,
      regularMarketDayHigh: meta.regularMarketDayHigh ?? meta.regularMarketPrice ?? 0,
      regularMarketDayLow: meta.regularMarketDayLow ?? meta.regularMarketPrice ?? 0,
      regularMarketVolume: meta.regularMarketVolume ?? 0,
      marketCap: undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Strategy 2: Yahoo Finance v6 quote API via query2 subdomain
 */
async function fetchViaV6(symbols: string[]): Promise<YahooQuoteResult[]> {
  try {
    const symbolStr = symbols.join(",");
    const url = `https://query2.finance.yahoo.com/v6/finance/quote?symbols=${symbolStr}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.quoteResponse?.result ?? []).map((q: Record<string, unknown>) => ({
      symbol: (q.symbol as string) ?? "",
      regularMarketPrice: (q.regularMarketPrice as number) ?? 0,
      regularMarketPreviousClose: (q.regularMarketPreviousClose as number) ?? 0,
      regularMarketDayHigh: (q.regularMarketDayHigh as number) ?? 0,
      regularMarketDayLow: (q.regularMarketDayLow as number) ?? 0,
      regularMarketVolume: (q.regularMarketVolume as number) ?? 0,
      marketCap: q.marketCap as number | undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Strategy 3: Finnhub free API as last resort (needs FINNHUB_API_KEY env var)
 */
async function fetchViaFinnhub(symbol: string): Promise<YahooQuoteResult | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.c || data.c === 0) return null;
    return {
      symbol,
      regularMarketPrice: data.c, // current
      regularMarketPreviousClose: data.pc, // previous close
      regularMarketDayHigh: data.h,
      regularMarketDayLow: data.l,
      regularMarketVolume: 0,
      marketCap: undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Main entry point — tries strategies in order until one works.
 * Batch fetches all symbols with parallel requests.
 */
export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuoteResult[]> {
  console.log(`[Yahoo] Fetching ${symbols.length} symbols...`);

  // Strategy 1: Try v6 batch first (fastest if it works)
  const v6Results = await fetchViaV6(symbols);
  if (v6Results.length > 0) {
    console.log(`[Yahoo] v6 returned ${v6Results.length} quotes`);
    return v6Results;
  }

  // Strategy 2: v8 chart endpoint (individual calls, but very reliable)
  console.log("[Yahoo] v6 failed, trying v8 chart...");
  const chartResults = await Promise.allSettled(
    symbols.map(s => fetchViaChart(s))
  );
  const chartQuotes = chartResults
    .filter((r): r is PromiseFulfilledResult<YahooQuoteResult | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((q): q is YahooQuoteResult => q !== null);

  if (chartQuotes.length > 0) {
    console.log(`[Yahoo] v8 chart returned ${chartQuotes.length} quotes`);
    return chartQuotes;
  }

  // Strategy 3: Finnhub (if key is set)
  console.log("[Yahoo] v8 chart failed, trying Finnhub...");
  const finnhubResults = await Promise.allSettled(
    symbols.map(s => fetchViaFinnhub(s))
  );
  const finnhubQuotes = finnhubResults
    .filter((r): r is PromiseFulfilledResult<YahooQuoteResult | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((q): q is YahooQuoteResult => q !== null);

  if (finnhubQuotes.length > 0) {
    console.log(`[Finnhub] returned ${finnhubQuotes.length} quotes`);
    return finnhubQuotes;
  }

  console.error("[Quotes] All strategies failed");
  return [];
}

/** Fetch a single symbol's change percent */
export async function fetchChangePercent(symbol: string): Promise<number | null> {
  const results = await fetchYahooQuotes([symbol]);
  if (results.length === 0) return null;
  const q = results[0];
  if (!q.regularMarketPrice || !q.regularMarketPreviousClose) return null;
  return Math.round(((q.regularMarketPrice - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 10000) / 100;
}
