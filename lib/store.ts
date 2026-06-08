"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StockQuote, Position, AIAnalysis, Portfolio } from "./types";
import { calcPnl, shouldClose, openPosition, computePortfolio } from "./portfolio";
import { TRACKED_STOCKS, TRIGGER_PCT } from "./stocks";

interface AppState {
  quotes: StockQuote[];
  positions: Position[];
  analyses: AIAnalysis[];
  portfolio: Portfolio;
  lastPollAt: string | null;
  analysing: Set<string>; // symbols currently being analysed

  // Actions
  updateQuotes: (quotes: StockQuote[]) => void;
  addAnalysis: (analysis: AIAnalysis) => void;
  openPositionFromAnalysis: (analysis: AIAnalysis, currentPrice: number) => void;
  tickPositions: (quotes: StockQuote[]) => void;
  closePosition: (id: string, price: number, reason: import("./types").CloseReason) => void;
  setAnalysing: (symbol: string, on: boolean) => void;
}

const INITIAL_PORTFOLIO: Portfolio = {
  cash: 10000,
  startingCash: 10000,
  totalPnl: 0,
  totalPnlPercent: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      quotes: [],
      positions: [],
      analyses: [],
      portfolio: INITIAL_PORTFOLIO,
      lastPollAt: null,
      analysing: new Set(),

      updateQuotes: (quotes) => {
        set({ quotes, lastPollAt: new Date().toISOString() });
        // Tick open positions with new prices
        get().tickPositions(quotes);
      },

      addAnalysis: (analysis) => {
        set(s => ({ analyses: [analysis, ...s.analyses].slice(0, 100) }));
      },

      openPositionFromAnalysis: (analysis, currentPrice) => {
        const stock = TRACKED_STOCKS.find(s => s.symbol === analysis.symbol);
        if (!stock) return;
        const pos = openPosition(analysis, currentPrice, stock.igSpread);
        if (!pos) return;
        set(s => ({
          positions: [pos, ...s.positions],
          portfolio: computePortfolio([pos, ...s.positions]),
        }));
      },

      tickPositions: (quotes) => {
        const { positions } = get();
        let changed = false;
        const updated = positions.map(pos => {
          if (pos.status === "closed") return pos;
          const q = quotes.find(q => q.symbol === pos.symbol);
          if (!q) return pos;
          const { pnl, pnlPercent } = calcPnl(pos, q.price);
          const closeReason = shouldClose(pos, q.price);
          changed = true;
          if (closeReason) {
            return { ...pos, currentPrice: q.price, pnl, pnlPercent, status: "closed" as const, exitPrice: q.price, exitTime: new Date().toISOString(), closeReason };
          }
          return { ...pos, currentPrice: q.price, pnl, pnlPercent };
        });
        if (changed) {
          set({ positions: updated, portfolio: computePortfolio(updated) });
        }
      },

      closePosition: (id, price, reason) => {
        set(s => {
          const updated = s.positions.map(p => {
            if (p.id !== id || p.status === "closed") return p;
            const { pnl, pnlPercent } = calcPnl(p, price);
            return { ...p, status: "closed" as const, exitPrice: price, exitTime: new Date().toISOString(), closeReason: reason, pnl, pnlPercent, currentPrice: price };
          });
          return { positions: updated, portfolio: computePortfolio(updated) };
        });
      },

      setAnalysing: (symbol, on) => {
        set(s => {
          const next = new Set(s.analysing);
          on ? next.add(symbol) : next.delete(symbol);
          return { analysing: next };
        });
      },
    }),
    {
      name: "spreadbet-store",
      partialize: (s) => ({ positions: s.positions, analyses: s.analyses, portfolio: s.portfolio }),
    }
  )
);

/** Return quotes that have moved more than TRIGGER_PCT% since previous close */
export function getTriggeredStocks(quotes: StockQuote[]): StockQuote[] {
  return quotes.filter(q => Math.abs(q.changePercent) >= TRIGGER_PCT);
}
