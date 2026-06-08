import type { Position, Portfolio, AIAnalysis } from "./types";
import { TAKE_PROFIT_PCT, STOP_LOSS_PCT, STARTING_BANKROLL } from "./stocks";
function nanoid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export function calcPnl(pos: Position, currentPrice: number): { pnl: number; pnlPercent: number } {
  const points = pos.direction === "LONG"
    ? currentPrice - pos.entryPrice
    : pos.entryPrice - currentPrice;
  const pnl = points * pos.stakePerPoint;
  const pnlPercent = (points / pos.entryPrice) * 100;
  return { pnl: Math.round(pnl * 100) / 100, pnlPercent: Math.round(pnlPercent * 100) / 100 };
}

export function shouldClose(pos: Position, currentPrice: number): "take_profit" | "stop_loss" | null {
  const { pnlPercent } = calcPnl(pos, currentPrice);
  if (pnlPercent >= TAKE_PROFIT_PCT) return "take_profit";
  if (pnlPercent <= -STOP_LOSS_PCT) return "stop_loss";
  return null;
}

export function openPosition(analysis: AIAnalysis, currentPrice: number, igSpread: number): Position | null {
  if (analysis.direction === "AVOID") return null;

  const entryPrice = analysis.direction === "LONG"
    ? currentPrice + igSpread / 2
    : currentPrice - igSpread / 2;

  return {
    id: nanoid(),
    symbol: analysis.symbol,
    name: analysis.name,
    direction: analysis.direction,
    entryPrice,
    currentPrice,
    stakePerPoint: analysis.stakePerPoint,
    pnl: 0,
    pnlPercent: 0,
    status: "open",
    entryTime: new Date().toISOString(),
    aiAnalysisId: analysis.id,
    aiReasoning: analysis.reasoning,
    igSpread,
    priceHistory: [{ time: new Date().toISOString(), price: currentPrice, pnl: 0 }],
    peakPnl: 0,
    troughPnl: 0,
  };
}

export function computePortfolio(positions: Position[]): Portfolio {
  const closed = positions.filter(p => p.status === "closed");
  const totalPnl = closed.reduce((sum, p) => sum + p.pnl, 0);
  const cash = STARTING_BANKROLL + totalPnl;
  const winning = closed.filter(p => p.pnl > 0).length;
  const losing = closed.filter(p => p.pnl < 0).length;

  return {
    cash: Math.round(cash * 100) / 100,
    startingCash: STARTING_BANKROLL,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPercent: Math.round((totalPnl / STARTING_BANKROLL) * 10000) / 100,
    totalTrades: closed.length,
    winningTrades: winning,
    losingTrades: losing,
  };
}
