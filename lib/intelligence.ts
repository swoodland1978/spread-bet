import { fetchChangePercent } from "./yahoo";
import { fetchStockNews, fetchMacroNews } from "./news-feeds";
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
  stockNews: NewsItem[];
  sectorEtf: string | null;
  sectorName: string | null;
  sectorChangePercent: number | null;
  indices: IndexSnapshot[];
  macroNews: NewsItem[];
  peerMoves: { symbol: string; name: string; changePercent: number }[];
  briefing: string;
}

/** Fetch news from NewsAPI (optional, enhances RSS feeds) */
async function fetchNewsApi(query: string, pageSize: number = 8): Promise<NewsItem[]> {
  if (!NEWS_API_KEY) return [];
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=${pageSize}&language=en&apiKey=${NEWS_API_KEY}`
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

  // Fire ALL data fetches in parallel — RSS feeds + NewsAPI + indices + sector
  const [
    rssStockNews,
    rssMacroNews,
    apiStockNews,
    apiMacroNews,
    sectorChange,
    ...indexResults
  ] = await Promise.all([
    // 1. Stock news from FREE RSS feeds (BBC, Sky, CNBC, Reuters, Yahoo, etc.)
    fetchStockNews(quote.symbol, quote.name),
    // 2. Macro news from FREE RSS feeds
    fetchMacroNews(),
    // 3. Stock news from NewsAPI (if key set — supplements RSS)
    fetchNewsApi(`"${quote.name}" OR "${quote.symbol}" stock`, 8),
    // 4. Macro news from NewsAPI (if key set)
    fetchNewsApi("US economy OR Federal Reserve OR inflation OR interest rates OR tariffs", 5),
    // 5. Sector ETF performance
    sector ? fetchChangePercent(sector.etf) : Promise.resolve(null),
    // 6. All major indices
    ...INDICES.map(async (idx) => {
      const pct = await fetchChangePercent(idx.symbol);
      return { symbol: idx.symbol, name: idx.name, price: 0, changePercent: pct ?? 0 } as IndexSnapshot;
    }),
  ]);

  // Merge and deduplicate stock news (RSS + API)
  const allStockNews = deduplicateNews([...rssStockNews, ...apiStockNews]);
  const allMacroNews = deduplicateNews([...rssMacroNews, ...apiMacroNews]);

  const peerSymbols = Object.entries(SECTOR_MAP)
    .filter(([sym, s]) => s.etf === sector?.etf && sym !== quote.symbol)
    .map(([sym]) => sym);

  const indices = indexResults as IndexSnapshot[];

  // Build the comprehensive briefing for the AI
  const lines: string[] = [];

  lines.push("=== STOCK-SPECIFIC NEWS ===");
  lines.push(`Sources: BBC, Sky News, CNBC, Reuters, Yahoo Finance, MarketWatch, The Guardian${NEWS_API_KEY ? ", NewsAPI" : ""}`);
  if (allStockNews.length > 0) {
    allStockNews.slice(0, 10).forEach(n => lines.push(`• ${n.headline} (${n.source}, ${timeAgo(n.publishedAt)})`));
  } else {
    lines.push("No recent stock-specific news found across any source.");
  }

  lines.push("\n=== GLOBAL MARKET INDICES ===");
  indices.forEach(idx => {
    const dir = idx.changePercent >= 0 ? "▲" : "▼";
    lines.push(`  ${idx.name}: ${dir} ${Math.abs(idx.changePercent).toFixed(2)}%`);
  });

  lines.push("\n=== MACRO/ECONOMIC/POLITICAL NEWS ===");
  lines.push("Sources: BBC Business, Sky News, Reuters, CNBC Economy, FT, The Guardian");
  if (allMacroNews.length > 0) {
    allMacroNews.slice(0, 12).forEach(n => lines.push(`• ${n.headline} (${n.source}, ${timeAgo(n.publishedAt)})`));
  } else {
    lines.push("No recent macro headlines found.");
  }

  if (sector) {
    lines.push(`\n=== SECTOR: ${sector.name} ===`);
    lines.push(`Sector ETF (${sector.etf}): ${sectorChange !== null ? `${sectorChange >= 0 ? "▲" : "▼"} ${Math.abs(sectorChange).toFixed(2)}%` : "data unavailable"}`);
    if (peerSymbols.length > 0) {
      lines.push(`Peer stocks in our watchlist: ${peerSymbols.join(", ")}`);
    }
  }

  return {
    stockNews: allStockNews,
    sectorEtf: sector?.etf ?? null,
    sectorName: sector?.name ?? null,
    sectorChangePercent: sectorChange,
    indices,
    macroNews: allMacroNews,
    peerMoves: [],
    briefing: lines.join("\n"),
  };
}

/** Deduplicate news by headline similarity */
function deduplicateNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(item => {
      const key = item.headline.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
