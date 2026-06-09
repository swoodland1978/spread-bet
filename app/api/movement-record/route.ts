import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { gatherIntelligence } from "@/lib/intelligence";
import type { StockQuote } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { quote } = (await req.json()) as { quote: StockQuote };
  if (!quote?.symbol) {
    return NextResponse.json({ error: "Missing quote" }, { status: 400 });
  }

  let briefing = "";
  try {
    const intel = await gatherIntelligence(quote);
    briefing = intel.briefing;
  } catch {
    briefing = "Intelligence gathering failed — no news data available.";
  }

  const direction = quote.changePercent >= 0 ? "UP" : "DOWN";
  const magnitude = Math.abs(quote.changePercent).toFixed(2);

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      symbol: quote.symbol,
      name: quote.name,
      changePercent: quote.changePercent,
      direction,
      price: quote.price,
      timestamp: new Date().toISOString(),
      reason: "AI unavailable — raw intelligence below:\n" + briefing,
      category: "unknown",
      newsHeadlines: [],
      confidence: 0,
    });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a financial analyst. A stock just made a significant move and we need to record WHY for our pattern database.

STOCK: ${quote.symbol} (${quote.name})
MOVE: ${direction} ${magnitude}% today (price: $${quote.price.toFixed(2)})
TIME: ${new Date().toISOString()}

MARKET INTELLIGENCE:
${briefing}

Analyse the intelligence above and determine the most likely reason for this move. Respond with ONLY this JSON:
{
  "reason": "1-2 sentence clear explanation of WHY this stock moved. Be specific — name the catalyst (earnings, FDA decision, analyst upgrade, sector rotation, macro fear, etc.)",
  "category": "one of: earnings | guidance | analyst | product | regulatory | macro | sector | geopolitical | crypto | technical | unknown",
  "newsHeadlines": ["up to 3 most relevant headlines that explain the move"],
  "confidence": 1-10,
  "pattern": "1 sentence: what pattern does this fit? e.g. 'Post-earnings drift after beat' or 'Sector-wide selloff on rate fears' or 'Overreaction to headline risk'"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as { type: string; text: string }).text
      .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(text);

    return NextResponse.json({
      symbol: quote.symbol,
      name: quote.name,
      changePercent: quote.changePercent,
      direction,
      price: quote.price,
      timestamp: new Date().toISOString(),
      reason: parsed.reason ?? "Unknown",
      category: parsed.category ?? "unknown",
      newsHeadlines: parsed.newsHeadlines ?? [],
      confidence: parsed.confidence ?? 0,
      pattern: parsed.pattern ?? "",
    });
  } catch (err) {
    return NextResponse.json({
      symbol: quote.symbol,
      name: quote.name,
      changePercent: quote.changePercent,
      direction,
      price: quote.price,
      timestamp: new Date().toISOString(),
      reason: "AI analysis failed: " + String(err),
      category: "unknown",
      newsHeadlines: [],
      confidence: 0,
      pattern: "",
    });
  }
}
