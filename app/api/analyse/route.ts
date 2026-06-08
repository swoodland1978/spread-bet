import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AIAnalysis, NewsItem } from "@/lib/types";
import { STAKE_PER_POINT, TAKE_PROFIT_PCT, STOP_LOSS_PCT } from "@/lib/stocks";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { symbol, name, triggerPrice, triggerChangePercent, news } = await req.json() as {
    symbol: string;
    name: string;
    triggerPrice: number;
    triggerChangePercent: number;
    news: NewsItem[];
  };

  const headlines = news.map(n => `• ${n.headline} (${n.source})`).join("\n");
  const direction = triggerChangePercent > 0 ? "UP" : "DOWN";

  const prompt = `You are an expert intraday spread bet trader. Analyse this stock move and decide whether to trade it.

STOCK: ${name} (${symbol})
CURRENT PRICE: $${triggerPrice.toFixed(2)}
TODAY'S MOVE: ${triggerChangePercent > 0 ? "+" : ""}${triggerChangePercent.toFixed(2)}% (${direction})
TIME: ${new Date().toUTCString()}

RECENT NEWS:
${headlines || "No recent news available."}

RULES:
- We are intraday ONLY — position closes at market close or when ${TAKE_PROFIT_PCT}% profit or ${STOP_LOSS_PCT}% loss is hit
- We can go LONG (bet it continues up) or SHORT (bet it reverses or continues down)
- Only trade if there is a clear signal — otherwise AVOID
- Consider: is this move news-driven (likely to sustain) or technical/random (likely to reverse)?
- Large cap stocks (AAPL, MSFT, NVDA) reverse more often; small/mid caps can trend

Respond ONLY with valid JSON:
{
  "direction": "LONG" | "SHORT" | "AVOID",
  "confidence": 0-100,
  "stakePerPoint": 0.5 | 1 | 2 | 3 (£/point — higher = more confident),
  "reasoning": "2-3 sentence explanation"
}`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (msg.content[0] as { type: string; text: string }).text
      .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(text);

    const analysis: AIAnalysis = {
      id: nanoid(),
      symbol,
      name,
      direction: parsed.direction,
      confidence: Math.min(100, Math.max(0, parsed.confidence ?? 50)),
      reasoning: parsed.reasoning ?? "",
      triggerPrice,
      triggerChangePercent,
      stakePerPoint: parsed.stakePerPoint ?? STAKE_PER_POINT,
      newsHeadlines: news.slice(0, 5).map(n => n.headline),
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("Analysis error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
