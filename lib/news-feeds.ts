/**
 * Free RSS news feeds — no API keys, no rate limits.
 * Parsed server-side for stock-specific and macro news.
 */

import type { NewsItem } from "./types";

// ── RSS Feed Sources ─────────────────────────────────────────────────────────

const MACRO_FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", source: "BBC Business" },
  { url: "https://feeds.skynews.com/feeds/rss/business.xml", source: "Sky News Business" },
  { url: "https://www.cnbc.com/id/10001147/device/rss/rss.html", source: "CNBC" },
  { url: "https://feeds.reuters.com/reuters/businessNews", source: "Reuters" },
  { url: "https://www.theguardian.com/uk/business/rss", source: "The Guardian" },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch" },
  { url: "https://feeds.marketwatch.com/marketwatch/marketpulse/", source: "MarketWatch Pulse" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664", source: "CNBC Finance" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910", source: "CNBC Economy" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US", source: "Yahoo Finance" },
  { url: "https://www.ft.com/?format=rss", source: "Financial Times" },
];

const STOCK_NEWS_FEEDS = [
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?region=US&lang=en-US", source: "Yahoo Finance" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069", source: "CNBC Tech" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", source: "CNBC Crypto" },
  { url: "https://www.investing.com/rss/news.rss", source: "Investing.com" },
];

// Per-stock Yahoo Finance RSS — symbol-specific news
function stockFeedUrl(symbol: string): string {
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`;
}

// ── RSS Parser ───────────────────────────────────────────────────────────────

interface RssItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

/** Simple XML RSS parser — no dependencies needed */
function parseRss(xml: string, source: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title");
    const description = extractTag(itemXml, "description");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");

    if (title) {
      items.push({ title, description: description ?? "", link: link ?? "", pubDate: pubDate ?? "", source });
    }
  }
  return items;
}

function extractTag(xml: string, tag: string): string | null {
  // Handle CDATA
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = regex.exec(xml);
  if (match) return match[1].trim().replace(/<[^>]+>/g, ""); // strip inner HTML
  return null;
}

/** Fetch and parse a single RSS feed with timeout */
async function fetchFeed(url: string, source: string, timeoutMs: number = 5000): Promise<RssItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SpreadSim/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, source);
  } catch {
    return [];
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Fetch macro/economic news from all RSS feeds */
export async function fetchMacroNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    MACRO_FEEDS.map(f => fetchFeed(f.url, f.source))
  );

  const items: NewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const item of r.value.slice(0, 5)) { // max 5 per feed
        items.push({
          symbol: "MACRO",
          headline: item.title,
          summary: item.description.slice(0, 200),
          source: item.source,
          url: item.link,
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        });
      }
    }
  }

  // Sort by date, most recent first, deduplicate by headline
  const seen = new Set<string>();
  return items
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(item => {
      const key = item.headline.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30); // top 30 most recent
}

/** Fetch news for a specific stock from Yahoo Finance RSS + general stock feeds */
export async function fetchStockNews(symbol: string, name: string): Promise<NewsItem[]> {
  const feeds = [
    { url: stockFeedUrl(symbol), source: `Yahoo Finance (${symbol})` },
    ...STOCK_NEWS_FEEDS,
  ];

  const results = await Promise.allSettled(
    feeds.map(f => fetchFeed(f.url, f.source))
  );

  const items: NewsItem[] = [];
  const symbolLower = symbol.toLowerCase();
  const nameLower = name.toLowerCase();
  const nameWords = nameLower.split(" ").filter(w => w.length > 3);

  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        const text = (item.title + " " + item.description).toLowerCase();
        // Only include items that mention the stock symbol or company name
        const isRelevant =
          text.includes(symbolLower) ||
          text.includes(nameLower) ||
          nameWords.some(w => text.includes(w));

        if (isRelevant) {
          items.push({
            symbol,
            headline: item.title,
            summary: item.description.slice(0, 200),
            source: item.source,
            url: item.link,
            publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          });
        }
      }
    }
  }

  // Deduplicate and sort
  const seen = new Set<string>();
  return items
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(item => {
      const key = item.headline.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 15);
}
