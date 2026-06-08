/** Direct Yahoo Finance API calls via fetch — works on Vercel serverless */

interface YahooQuoteResult {
  symbol: string;
  regularMarketPrice: number;
  regularMarketPreviousClose: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketVolume: number;
  marketCap?: number;
}

/**
 * Fetch quotes for multiple symbols in one call using Yahoo Finance v7 API.
 * Falls back to v6 if v7 fails.
 */
export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuoteResult[]> {
  const symbolStr = symbols.join(",");

  // Try Yahoo Finance v8 API (current, no key needed)
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolStr}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (res.ok) {
      const data = await res.json();
      const results = data?.quoteResponse?.result ?? [];
      return results.map((q: Record<string, unknown>) => ({
        symbol: (q.symbol as string) ?? "",
        regularMarketPrice: (q.regularMarketPrice as number) ?? 0,
        regularMarketPreviousClose: (q.regularMarketPreviousClose as number) ?? 0,
        regularMarketDayHigh: (q.regularMarketDayHigh as number) ?? 0,
        regularMarketDayLow: (q.regularMarketDayLow as number) ?? 0,
        regularMarketVolume: (q.regularMarketVolume as number) ?? 0,
        marketCap: q.marketCap as number | undefined,
      }));
    }
  } catch (err) {
    console.error("Yahoo v7 failed:", err);
  }

  // Fallback: try v8 quote endpoint
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbols[0]}?interval=1d&range=1d`;
    // For multiple symbols, fetch individually
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        const res = await fetch(chartUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return null;
        return {
          symbol,
          regularMarketPrice: meta.regularMarketPrice ?? 0,
          regularMarketPreviousClose: meta.previousClose ?? meta.chartPreviousClose ?? 0,
          regularMarketDayHigh: meta.regularMarketDayHigh ?? meta.regularMarketPrice ?? 0,
          regularMarketDayLow: meta.regularMarketDayLow ?? meta.regularMarketPrice ?? 0,
          regularMarketVolume: meta.regularMarketVolume ?? 0,
          marketCap: undefined,
        } as YahooQuoteResult;
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<YahooQuoteResult | null> => r.status === "fulfilled")
      .map(r => r.value)
      .filter((q): q is YahooQuoteResult => q !== null);
  } catch (err) {
    console.error("Yahoo v8 chart fallback also failed:", err);
    return [];
  }
}

/** Fetch a single symbol's change percent (for indices/ETFs) */
export async function fetchChangePercent(symbol: string): Promise<number | null> {
  try {
    const results = await fetchYahooQuotes([symbol]);
    if (results.length === 0) return null;
    const q = results[0];
    if (!q.regularMarketPrice || !q.regularMarketPreviousClose) return null;
    return Math.round(((q.regularMarketPrice - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 10000) / 100;
  } catch {
    return null;
  }
}
