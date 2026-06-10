import { NextResponse } from "next/server";
import { igLogin, igGetAccount, igGetPositions, igOpenPosition, igClosePosition } from "@/lib/ig-client";
import { TRACKED_STOCKS, TRIGGER_PCT, TAKE_PROFIT_PCT, STOP_LOSS_PCT, TIME_STOP_HOURS, STAKE_PER_POINT } from "@/lib/stocks";
import { gatherIntelligence } from "@/lib/intelligence";
import Anthropic from "@anthropic-ai/sdk";
import type { StockQuote } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IG_DEMO_URL = "https://demo-api.ig.com/gateway/deal";

// Track which stocks we already traded today (survives within same serverless instance)
const tradedToday = new Set<string>();
let lastTradedDate = "";

// Track when each position was opened (dealId → timestamp ms)
const positionOpenedAt = new Map<string, number>();

function resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastTradedDate) {
    tradedToday.clear();
    lastTradedDate = today;
  }
}

function isMarketOpen(): boolean {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const etOffset = -5 * 60 * 60000;
  const etTime = new Date(utc + etOffset);
  const day = etTime.getDay();
  const totalMins = etTime.getHours() * 60 + etTime.getMinutes();
  if (day === 0 || day === 6) return false;
  return totalMins >= 570 && totalMins < 960;
}

async function fetchIGPrice(epic: string, session: { cst: string; securityToken: string }): Promise<{ bid: number; offer: number; percentageChange: number; high: number; low: number } | null> {
  try {
    const res = await fetch(`${IG_DEMO_URL}/markets/${epic}`, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json; charset=UTF-8",
        "X-IG-API-KEY": process.env.IG_API_KEY!,
        "CST": session.cst,
        "X-SECURITY-TOKEN": session.securityToken,
        "VERSION": "3",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const snap = data.snapshot ?? {};
    return {
      bid: snap.bid ?? 0,
      offer: snap.offer ?? 0,
      percentageChange: snap.percentageChange ?? 0,
      high: snap.high ?? 0,
      low: snap.low ?? 0,
    };
  } catch {
    return null;
  }
}

interface TechnicalContext {
  atrPct: number;        // day range as % of price — proxy for daily ATR
  zScore: number;        // how many ATRs the move represents
  moveVsRange: number;   // move as % of day's high-low range (0-1)
  spread: number;        // current spread in points
  spreadBaseline: number; // normal spread from stock config
  spreadMultiple: number; // how wide the spread is vs normal
}

function buildTechnicalContext(
  quote: StockQuote & { bid: number; offer: number },
  igSpread: number
): TechnicalContext {
  const mid = quote.price;
  const dayRange = quote.high - quote.low;
  const atrPct = mid > 0 ? (dayRange / mid) * 100 : 0;
  // Z-score: how many ATR units is this move?
  const zScore = atrPct > 0 ? Math.abs(quote.changePercent) / atrPct : 0;
  // How much of the day's range does the move represent?
  const moveVsRange = dayRange > 0 ? Math.abs(quote.changePercent) / atrPct : 0;
  const spread = quote.offer - quote.bid;
  const spreadMultiple = igSpread > 0 ? spread / igSpread : 1;

  return { atrPct, zScore, moveVsRange, spread, spreadBaseline: igSpread, spreadMultiple };
}

/** Ask Claude Haiku whether to trade */
async function aiDecide(
  quote: StockQuote & { bid: number; offer: number },
  briefing: string,
  tech: TechnicalContext
): Promise<{ direction: "BUY" | "SELL" | "AVOID"; reasoning: string; confidence: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    const dir = quote.changePercent > 0 ? "SELL" : "BUY";
    return { direction: dir, reasoning: `Mechanical fade: ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}% move`, confidence: 5 };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Structured payload — forces AI to reason analytically, not emotionally
  const payload = {
    ticker: quote.symbol,
    name: quote.name,
    price_move_pct: quote.changePercent.toFixed(2),
    direction: quote.changePercent > 0 ? "UP" : "DOWN",
    current_price: quote.price.toFixed(2),
    day_range_pct: tech.atrPct.toFixed(2),
    z_score: tech.zScore.toFixed(2),
    spread_multiple: `${tech.spreadMultiple.toFixed(1)}x normal`,
    matching_news_headlines: briefing,
  };

  const prompt = `You are a quantitative spread-betting AI. Evaluate whether this price move is a LIQUIDITY EVENT (temporary overreaction that will mean-revert) or a FUNDAMENTAL EVENT (justified repricing that will continue).

TRADE DATA:
${JSON.stringify(payload, null, 2)}

CLASSIFICATION GUIDE:
- LIQUIDITY EVENT (trade the reversal): Heavy volume flush, no concrete news, technical stop-hunt, sector sympathy move, market-wide risk-off with no stock-specific catalyst. Z-score > 2 suggests anomalous move for this stock.
- FUNDAMENTAL EVENT (avoid): Earnings miss/beat, FDA decision, regulatory action, CEO departure, short seller report, bankruptcy risk, genuine paradigm shift. The asset is repricing permanently.

DECISION RULES:
- If LIQUIDITY EVENT and move is DOWN → BUY (fade the drop, expect bounce)
- If LIQUIDITY EVENT and move is UP → SELL (fade the rally, expect pullback)
- If FUNDAMENTAL EVENT → AVOID regardless of direction
- If Z-score < 1.5, the move is within normal daily noise → AVOID
- If spread_multiple > 3x, execution cost is too high → AVOID

We take profit at +4% and stop loss at -2% with a 24h time stop.

Respond with ONLY this JSON:
{
  "direction": "BUY" or "SELL" or "AVOID",
  "reasoning": "1-2 sentences: liquidity or fundamental event, and why it will/won't revert",
  "confidence": 1-10
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as { type: string; text: string }).text
      .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(text);
  } catch {
    const dir = quote.changePercent > 0 ? "SELL" : "BUY";
    return { direction: dir, reasoning: "AI unavailable, mechanical fade", confidence: 3 };
  }
}

interface TradeAction {
  symbol: string;
  epic: string;
  direction: "BUY" | "SELL" | "AVOID";
  reasoning: string;
  confidence: number;
  dealId?: string;
  dealStatus?: string;
  error?: string;
}

interface CloseAction {
  symbol: string;
  dealId: string;
  reason: "take_profit" | "stop_loss" | "time_stop";
  pnlPercent: number;
  success: boolean;
  error?: string;
}

export async function GET() {
  const errors: string[] = [];
  const marketOpen = isMarketOpen();
  const quotes: (StockQuote & { igEpic: string; bid: number; offer: number })[] = [];
  const trades: TradeAction[] = [];
  const closes: CloseAction[] = [];

  resetIfNewDay();

  try {
    // 1. Login to IG
    const session = await igLogin();

    // 2. Fetch prices for all stocks from IG (2 at a time with 500ms delay to respect rate limits)
    const batches: typeof TRACKED_STOCKS[number][][] = [];
    for (let i = 0; i < TRACKED_STOCKS.length; i += 2) {
      batches.push(TRACKED_STOCKS.slice(i, i + 2));
    }

    for (let i = 0; i < batches.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 500));
      const results = await Promise.allSettled(
        batches[i].map(async (stock) => {
          const price = await fetchIGPrice(stock.igEpic, session);
          if (!price || (price.bid === 0 && price.offer === 0)) return null;
          const midPrice = (price.bid + price.offer) / 2;
          return {
            symbol: stock.symbol,
            name: stock.name,
            price: midPrice,
            previousClose: midPrice / (1 + price.percentageChange / 100),
            changePercent: Math.round(price.percentageChange * 100) / 100,
            high: price.high,
            low: price.low,
            volume: 0,
            updatedAt: new Date().toISOString(),
            marketOpen,
            igEpic: stock.igEpic,
            bid: price.bid,
            offer: price.offer,
          };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) quotes.push(r.value);
      }
    }

    // 3. Get IG account balance + open positions
    const account = await igGetAccount();
    const igPositions = await igGetPositions();

    // 4. Find triggered stocks — dynamic threshold: move must be >= TRIGGER_PCT AND >= 1.5x the day's ATR
    const triggered = quotes.filter(q => {
      if (Math.abs(q.changePercent) < TRIGGER_PCT) return false;
      const stock = TRACKED_STOCKS.find(s => s.symbol === q.symbol);
      const tech = buildTechnicalContext(q as StockQuote & { bid: number; offer: number }, stock?.igSpread ?? 0.25);
      // Reject if the move is within normal daily noise (Z < 1.5)
      if (tech.zScore < 1.5) return false;
      // Reject if spread is more than 3x normal (too expensive to enter)
      if (tech.spreadMultiple > 3) return false;
      return true;
    });

    // 5. CHECK OPEN POSITIONS — auto-close at TP/SL
    for (const pos of igPositions) {
      // Find matching quote by epic
      const quote = quotes.find(q => q.igEpic === pos.epic);
      if (!quote) continue;

      // Calculate P&L percent from entry
      const entryPrice = pos.level;
      const currentPrice = pos.direction === "BUY" ? quote.bid : quote.offer;
      const pnlPct = pos.direction === "BUY"
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;

      const openedAt = positionOpenedAt.get(pos.dealId);
      const ageHours = openedAt ? (Date.now() - openedAt) / 3_600_000 : null;

      let closeReason: "take_profit" | "stop_loss" | "time_stop" | null = null;
      if (pnlPct >= TAKE_PROFIT_PCT) closeReason = "take_profit";
      else if (pnlPct <= -STOP_LOSS_PCT) closeReason = "stop_loss";
      else if (ageHours !== null && ageHours >= TIME_STOP_HOURS) closeReason = "time_stop";

      if (closeReason) {
        try {
          const result = await igClosePosition(pos.dealId, pos.direction as "BUY" | "SELL", pos.size);
          if (result.success) positionOpenedAt.delete(pos.dealId);
          closes.push({
            symbol: quote.symbol,
            dealId: pos.dealId,
            reason: closeReason,
            pnlPercent: Math.round(pnlPct * 100) / 100,
            success: result.success,
            error: result.success ? undefined : result.reason,
          });
        } catch (err) {
          closes.push({
            symbol: quote.symbol,
            dealId: pos.dealId,
            reason: closeReason,
            pnlPercent: Math.round(pnlPct * 100) / 100,
            success: false,
            error: String(err),
          });
        }
      }
    }

    // 6. OPEN NEW POSITIONS for triggered stocks (only when market is open)
    if (!marketOpen) return NextResponse.json({
      quotes,
      triggered: [],
      trades: [],
      closes,
      marketOpen,
      scannedAt: new Date().toISOString(),
      igAccount: account,
      igPositions,
      errors: errors.length > 0 ? errors : undefined,
    });

    for (const quote of triggered) {
      const stock = TRACKED_STOCKS.find(s => s.symbol === quote.symbol);
      if (!stock) continue;

      // Skip if already traded today
      if (tradedToday.has(quote.symbol)) continue;

      // Skip if we already have an open position on this stock
      if (igPositions.some(p => p.epic === stock.igEpic)) continue;

      // Only use AI if IG is actually connected (saves tokens when running without IG)
      let decision: { direction: "BUY" | "SELL" | "AVOID"; reasoning: string; confidence: number };
      if (!account) {
        // No IG connection — skip AI entirely, use mechanical fade
        const dir = quote.changePercent > 0 ? "SELL" as const : "BUY" as const;
        decision = { direction: dir, reasoning: "AI skipped (no IG connection), mechanical fade", confidence: 3 };
      } else {
        // IG connected — gather intelligence and ask AI
        let briefing = "";
        try {
          const intel = await gatherIntelligence(quote);
          briefing = intel.briefing;
        } catch {
          briefing = "Intelligence gathering failed.";
        }
        const tech = buildTechnicalContext(quote as StockQuote & { bid: number; offer: number }, stock.igSpread);
        decision = await aiDecide(quote as StockQuote & { bid: number; offer: number }, briefing, tech);
      }

      if (decision.direction === "AVOID") {
        trades.push({
          symbol: quote.symbol,
          epic: stock.igEpic,
          direction: "AVOID",
          reasoning: decision.reasoning,
          confidence: decision.confidence,
        });
        tradedToday.add(quote.symbol); // Don't re-analyse today
        continue;
      }

      // Place the trade on IG
      try {
        const result = await igOpenPosition({
          epic: stock.igEpic,
          direction: decision.direction,
          size: STAKE_PER_POINT,
          expiry: "-", // Cash/24-hour markets use "-" not "DFB"
        });

        if (result.dealId) positionOpenedAt.set(result.dealId, Date.now());
        trades.push({
          symbol: quote.symbol,
          epic: stock.igEpic,
          direction: decision.direction,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          dealId: result.dealId,
          dealStatus: result.dealStatus,
        });
        tradedToday.add(quote.symbol);
      } catch (err) {
        trades.push({
          symbol: quote.symbol,
          epic: stock.igEpic,
          direction: decision.direction,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          error: String(err),
        });
      }
    }

    // 7. Re-fetch positions after trades/closes
    const updatedPositions = (trades.length > 0 || closes.length > 0) ? await igGetPositions() : igPositions;
    const updatedAccount = (trades.length > 0 || closes.length > 0) ? await igGetAccount() : account;

    return NextResponse.json({
      quotes,
      triggered: triggered.map(q => q.symbol),
      trades,
      closes,
      marketOpen,
      scannedAt: new Date().toISOString(),
      igAccount: updatedAccount,
      igPositions: updatedPositions,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    errors.push(String(err));
    return NextResponse.json({
      quotes,
      triggered: [],
      trades: [],
      closes: [],
      marketOpen,
      scannedAt: new Date().toISOString(),
      errors,
    });
  }
}
