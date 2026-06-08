import yahooFinance from "yahoo-finance2";
import type { StockQuote, NewsItem } from "./types";

const NEWS_API_KEY = process.env.NEWS_API_KEY;

// ── Major indices we always check for macro context ──────────────────────────
const INDICES = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^IXIC", name: "NASDAQ" },
  { symbol: "^DJI",  name: "Dow Jones" },
  { symbol: "^VIX",  name: "VIX (Fear Index)" },
  { symbol: "^TNX",  name: "10Y Treasury Yield" },
  { symbol: "DX-Y.NYB", name: "US Dollar Index" },
];

// ── Sector ETFs to gauge sector health ───────────────────────────────────────
const SECTOR_MAP: Record<string, { etf: string; name: string }> = {
  TSLA:  { etf: "CARZ", name: "EV/Auto" },
  NVDA:  { etf: "SMH",  name: "Semiconductors" },
  AMD:   { etf: "SMH",  name: "Semiconductors" },
  ARM:   { etf: "SMH",  name: "Semiconductors" },
  SMCI:  { etf: "SMH",  name: "Semiconductors" },
  META:  { etf: "XLC",  name: "Communication Services" },
  GOOGL: { etf: "XLC",  name: "Communication Services" },
  NFLX:  { etf: "XLC",  name: "Communication Services" },
  SNAP:  { etf: "XLC",  name: "Communication Services" },
  RDDT:  { etf: "XLC",  name: "Communication Services" },
  SPOT:  { etf: "XLC",  name: "Communication Services" },
  AAPL:  { etf: "XLK",  name: "Technology" },
  MSFT:  { etf: "XLK",  name: "Technology" },
  ZM:    { etf: "XLK",  name: "Technology" },
  AMZN:  { etf: "XLY",  name: "Consumer Discretionary" },
  ABNB:  { etf: "XLY",  name: "Consumer Discretionary" },
  DASH:  { etf: "XLY",  name: "Consumer Discretionary" },
  RBLX:  { etf: "XLY",  name: "Consumer Discretionary" },
  SHOP:  { etf: "XLY",  name: "Consumer Discretionary" },
  COIN:  { etf: "BITO", name: "Crypto/Blockchain" },
  MSTR:  { etf: "BITO", name: "Crypto/Blockchain" },
  SQ:    { etf: "ARKF", name: "Fintech" },
  PLTR:  { etf: "ARKK", name: "Innovation/Growth" },
  RIVN:  { etf: "CARZ", name: "EV/Auto" },
  BABA:  { etf: "FXI",  name: "China" },
};

export interface IndexSnapshot {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
}

export interface IntelligencePacket {
  // Stock-specific
  stockNews: NewsItem[];
  // Sector
  sectorEtf: string | null;
  sectorName: string | null;
  sectorChangePercent: number | null;
  // Macro indices
  indices: IndexSnapshot[];
  // Macro/economic news
  macroNews: NewsItem[];
  // Related peers
  peerMoves: { symbol: string; name: string; changePercent: number }[];
  // Compiled into a single briefing string for the AI
  briefing: string;
}

/** Fetch a quote and return change % */
async function getChangePercent(symbol: string): Promise<number | null> {
  try {
    const q = await yahooFinance.quote(symbol);
    const data = q as Record<string, unknown>;
    const price = data.regularMarketPrice as number;
    const prev = data.regularMarketPreviousClose as number;
    if (!price || !prev) return null;
    return Math.round(((price - prev) / prev) * 10000) / 100;
  } catch {
    return null;
  }
}

/** Fetch news from NewsAPI */
async function fetchNewsApi(query: string, pageSize: number = 8): Promise<NewsItem[]> {
  if (!NEWS_API_KEY) return [];
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=${pageSize}&language=en&apiKey=${NEWS_API_KEY}`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles ?? []).map((a: { title?: string; description?: string; source?: { name?: string }; url?: string; publishedAt?: string }) => ({
      symbol: "",
      headline: a.title ?? "",
      summary: a.description ?? "",
      source: a.source?.name ?? "",
      url: a.url ?? "",
      publishedAt: a.publishedAt ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

/** Build a full intelligence packet for a triggered stock */
export async function gatherIntelligence(quote: StockQuote): Promise<IntelligencePacket> {
  const sector = SECTOR_MAP[quote.symbol];

  // Fire all data fetches in parallel
  const [stockNews, macroNews, sectorChange, ...indexResults] = await Promise.all([
    // 1. Stock-specific news
    fetchNewsApi(`"${quote.name}" OR "${quote.symbol}" stock`, 10),
    // 2. Macro/economic news
    fetchNewsApi("US economy OR Federal Reserve OR inflation OR interest rates OR tariffs OR trade war", 6),
    // 3. Sector ETF performance
    sector ? getChangePercent(sector.etf) : Promise.resolve(null),
    // 4. All major indices
    ...INDICES.map(async (idx) => {
      const pct = await getChangePercent(idx.symbol);
      return { symbol: idx.symbol, name: idx.name, price: 0, changePercent: pct ?? 0 } as IndexSnapshot;
    }),
  ]);

  // 5. Peer stock moves (same sector stocks from our watchlist)
  const peerSymbols = Object.entries(SECTOR_MAP)
    .filter(([sym, s]) => s.etf === sector?.etf && sym !== quote.symbol)
    .map(([sym]) => sym);

  const peerMoves: { symbol: string; name: string; changePercent: number }[] = [];
  // We already have quotes from the scan — but we can note peers for the briefing

  const indices = indexResults as IndexSnapshot[];

  // Build the comprehensive briefing
  const lines: string[] = [];

  lines.push("=== STOCK-SPECIFIC NEWS ===");
  if (stockNews.length > 0) {
    stockNews.slice(0, 8).forEach(n => lines.push(`• ${n.headline} (${n.source}, ${timeAgo(n.publishedAt)})`));
  } else {
    lines.push("No recent stock-specific news found.");
  }

  lines.push("\n=== MACRO/ECONOMIC CONTEXT ===");
  lines.push("Major Indices Today:");
  indices.forEach(idx => {
    const dir = idx.changePercent >= 0 ? "▲" : "▼";
    lines.push(`  ${idx.name}: ${dir} ${Math.abs(idx.changePercent).toFixed(2)}%`);
  });

  if (macroNews.length > 0) {
    lines.push("\nRecent Macro Headlines:");
    macroNews.slice(0, 5).forEach(n => lines.push(`• ${n.headline} (${n.source})`));
  }

  if (sector) {
    lines.push(`\n=== SECTOR: ${sector.name} ===`);
    lines.push(`Sector ETF (${sector.etf}): ${sectorChange !== null ? `${sectorChange >= 0 ? "▲" : "▼"} ${Math.abs(sectorChange).toFixed(2)}%` : "unavailable"}`);
    if (peerSymbols.length > 0) {
      lines.push(`Peer stocks in watchlist: ${peerSymbols.join(", ")}`);
    }
  }

  return {
    stockNews,
    sectorEtf: sector?.etf ?? null,
    sectorName: sector?.name ?? null,
    sectorChangePercent: sectorChange,
    indices,
    macroNews,
    peerMoves,
    briefing: lines.join("\n"),
  };
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
