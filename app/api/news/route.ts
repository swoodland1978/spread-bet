import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NEWS_API_KEY = process.env.NEWS_API_KEY;

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const name = req.nextUrl.searchParams.get("name") ?? symbol;
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    const query = encodeURIComponent(`${name} stock`);
    const url = `https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_API_KEY}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`);
    const data = await res.json();

    const articles = (data.articles ?? []).slice(0, 8).map((a: {
      title?: string;
      description?: string;
      source?: { name?: string };
      url?: string;
      publishedAt?: string;
    }) => ({
      symbol,
      headline: a.title ?? "",
      summary: a.description ?? "",
      source: a.source?.name ?? "",
      url: a.url ?? "",
      publishedAt: a.publishedAt ?? new Date().toISOString(),
    }));

    return NextResponse.json({ articles });
  } catch (err) {
    console.error("News fetch error:", err);
    return NextResponse.json({ articles: [] });
  }
}
