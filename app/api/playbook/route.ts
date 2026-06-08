import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

/** POST: Generate/update playbook from accumulated trade reviews */
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No API key" }, { status: 500 });
  }

  const { reviews, currentPlaybook } = await req.json();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const reviewsSummary = (reviews ?? []).map((r: {
    symbol: string; direction: string; outcome: string; pnl: number;
    holdingTimeMinutes: number; triggerChangePercent: number;
    review: string; lessons: string;
  }, i: number) => {
    return `Trade ${i + 1}: ${r.symbol} ${r.direction} — ${r.outcome.toUpperCase()} (${r.pnl >= 0 ? "+" : ""}£${r.pnl.toFixed(2)}) — held ${r.holdingTimeMinutes}m — trigger ${r.triggerChangePercent > 0 ? "+" : ""}${r.triggerChangePercent.toFixed(1)}%
  Review: ${r.review}
  Lesson: ${r.lessons}`;
  }).join("\n\n");

  const wins = (reviews ?? []).filter((r: { outcome: string }) => r.outcome === "win").length;
  const losses = (reviews ?? []).filter((r: { outcome: string }) => r.outcome === "loss").length;
  const totalPnl = (reviews ?? []).reduce((s: number, r: { pnl: number }) => s + r.pnl, 0);

  const prompt = `You are a trading strategy analyst. Review ALL completed trades below and produce an updated PLAYBOOK — a set of rules, patterns, and insights that should guide future trading decisions.

═══ CURRENT STRATEGY ═══
- Mechanical mean reversion: fade any stock that moves >4% intraday
- Stock UP 4%+ → SHORT | Stock DOWN 4%+ → LONG
- Take profit at +1% | Stop loss at -2%
- No AI in trade decisions — purely mechanical entry
- AI reviews each trade after it closes

═══ PERFORMANCE ═══
Total trades: ${(reviews ?? []).length}
Wins: ${wins} | Losses: ${losses} | Win rate: ${(reviews ?? []).length > 0 ? Math.round((wins / (reviews ?? []).length) * 100) : 0}%
Total P&L: ${totalPnl >= 0 ? "+" : ""}£${totalPnl.toFixed(2)}

═══ PREVIOUS PLAYBOOK ═══
${currentPlaybook || "No playbook yet — this is the first synthesis."}

═══ ALL TRADE REVIEWS ═══
${reviewsSummary || "No trades reviewed yet."}

═══ YOUR TASK ═══
Synthesise everything above into an updated PLAYBOOK. Structure it as:

1. WHAT'S WORKING — patterns in our winning trades
2. WHAT'S NOT WORKING — patterns in our losses
3. STOCKS TO WATCH — any stocks that consistently behave well/badly for our strategy
4. TIME PATTERNS — are there better/worse times to trade?
5. ENTRY RULES — should we add any filters? (e.g. "don't fade moves over 8%", "avoid trading in the first 30 min")
6. EXIT RULES — should we adjust take profit or stop loss?
7. RISK MANAGEMENT — position sizing observations
8. KEY LESSONS — the top 3-5 most important takeaways

Be specific and data-driven. Reference actual trades. This playbook will be saved and fed back into future trade reviews so the AI improves over time.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const playbook = (msg.content[0] as { type: string; text: string }).text.trim();
    return NextResponse.json({ playbook, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Playbook error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
