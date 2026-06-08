import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { TradeReview } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No API key" }, { status: 500 });
  }

  const trade = await req.json();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a trading coach reviewing a completed spread bet trade. Give a brief, honest post-trade analysis.

TRADE DETAILS:
Stock: ${trade.symbol} (${trade.name})
Direction: ${trade.direction} (we ${trade.direction === "LONG" ? "bought the dip" : "shorted the rip"})
Entry: $${trade.entryPrice.toFixed(2)} | Exit: $${trade.exitPrice.toFixed(2)}
P&L: ${trade.pnl >= 0 ? "+" : ""}£${trade.pnl.toFixed(2)} (${trade.pnlPercent >= 0 ? "+" : ""}${trade.pnlPercent.toFixed(2)}%)
Outcome: ${trade.outcome.toUpperCase()}
Close reason: ${trade.closeReason}
Holding time: ${trade.holdingTimeMinutes} minutes
Original trigger: stock had moved ${trade.triggerChangePercent > 0 ? "+" : ""}${trade.triggerChangePercent.toFixed(2)}% when we entered
Peak P&L during trade: £${trade.peakPnl?.toFixed(2) ?? "0.00"}
Worst P&L during trade: £${trade.troughPnl?.toFixed(2) ?? "0.00"}

STRATEGY: We mechanically fade >4% moves. Buy dips, short rips. Take profit at +1%, stop loss at -2%.

Respond with ONLY this JSON:
{
  "review": "2-3 sentences: What happened? Why did this trade win/lose? Was the entry timing good?",
  "lessons": "1-2 sentences: What should we watch for next time? Any pattern we should note?"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as { type: string; text: string }).text
      .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(text);

    const review: TradeReview = {
      positionId: trade.positionId,
      symbol: trade.symbol,
      direction: trade.direction,
      outcome: trade.outcome,
      pnl: trade.pnl,
      pnlPercent: trade.pnlPercent,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      holdingTimeMinutes: trade.holdingTimeMinutes,
      triggerChangePercent: trade.triggerChangePercent,
      review: parsed.review ?? "",
      lessons: parsed.lessons ?? "",
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(review);
  } catch (err) {
    console.error("Review error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
