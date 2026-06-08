"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StockQuote, Position, AIAnalysis, Portfolio, CloseReason } from "./types";
import { calcPnl, shouldClose, openPosition, computePortfolio } from "./portfolio";
import { TRACKED_STOCKS, TRIGGER_PCT } from "./stocks";

export interface LogEntry {
  id: string;
  time: string;
  type: "scan" | "trigger" | "analysis" | "trade_open" | "trade_close" | "info" | "error";
  message: string;
}

interface AppState {
  quotes: StockQuote[];
  positions: Position[];
  analyses: AIAnalysis[];
  portfolio: Portfolio;
  log: LogEntry[];
  lastScanAt: string | null;
  marketOpen: boolean;
  scanning: boolean;
  alreadyAnalysed: string[]; // symbols analysed this session to avoid repeats

  // Actions
  runScan: () => Promise<void>;
  tickPositions: () => void;
  closePosition: (id: string, price: number, reason: CloseReason) => void;
  addLog: (type: LogEntry["type"], message: string) => void;
  resetSimulation: () => void;
}

const INITIAL_PORTFOLIO: Portfolio = {
  cash: 10000, startingCash: 10000, totalPnl: 0, totalPnlPercent: 0,
  totalTrades: 0, winningTrades: 0, losingTrades: 0,
};

let logCounter = 0;

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      quotes: [],
      positions: [],
      analyses: [],
      portfolio: INITIAL_PORTFOLIO,
      log: [],
      lastScanAt: null,
      marketOpen: false,
      scanning: false,
      alreadyAnalysed: [],

      addLog: (type, message) => {
        const entry: LogEntry = {
          id: `log-${Date.now()}-${logCounter++}`,
          time: new Date().toISOString(),
          type,
          message,
        };
        set(s => ({ log: [entry, ...s.log].slice(0, 200) }));
      },

      runScan: async () => {
        const { scanning, addLog, alreadyAnalysed, positions } = get();
        if (scanning) return;
        set({ scanning: true });
        addLog("scan", "Scanning all 25 stocks…");

        try {
          const res = await fetch("/api/scan");
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          const quotes: StockQuote[] = data.quotes ?? [];
          const marketOpen: boolean = data.marketOpen ?? false;
          const analyses: AIAnalysis[] = data.analyses ?? [];
          const triggered: string[] = data.triggered ?? [];

          set({ quotes, marketOpen, lastScanAt: data.scannedAt });
          addLog("scan", `${quotes.length} stocks fetched. Market ${marketOpen ? "OPEN" : "CLOSED"}.`);

          if (triggered.length > 0) {
            addLog("trigger", `⚡ ${triggered.length} stock${triggered.length !== 1 ? "s" : ""} moved >${TRIGGER_PCT}%: ${triggered.join(", ")}`);
          }

          // Process AI analyses — open positions automatically
          for (const analysis of analyses) {
            // Skip if already analysed this session
            if (alreadyAnalysed.includes(analysis.symbol)) {
              addLog("info", `${analysis.symbol} already analysed today — skipping.`);
              continue;
            }

            // Skip if we already have an open position on this stock
            const hasOpen = positions.some(p => p.symbol === analysis.symbol && p.status === "open");
            if (hasOpen) {
              addLog("info", `${analysis.symbol} already has an open position — skipping.`);
              continue;
            }

            set(s => ({
              analyses: [analysis, ...s.analyses].slice(0, 100),
              alreadyAnalysed: [...s.alreadyAnalysed, analysis.symbol],
            }));

            if (analysis.direction === "AVOID") {
              addLog("analysis", `🤖 ${analysis.symbol}: AVOID (${analysis.confidence}% confidence) — ${analysis.reasoning}`);
            } else {
              addLog("analysis", `🤖 ${analysis.symbol}: ${analysis.direction} (${analysis.confidence}%) — ${analysis.reasoning}`);

              // Auto-open position
              const stock = TRACKED_STOCKS.find(s => s.symbol === analysis.symbol);
              const quote = quotes.find(q => q.symbol === analysis.symbol);
              if (stock && quote) {
                const pos = openPosition(analysis, quote.price, stock.igSpread);
                if (pos) {
                  set(s => ({
                    positions: [pos, ...s.positions],
                    portfolio: computePortfolio([pos, ...s.positions]),
                  }));
                  addLog("trade_open", `📈 OPENED ${analysis.direction} on ${analysis.symbol} at $${quote.price.toFixed(2)} — £${analysis.stakePerPoint}/pt`);
                }
              }
            }
          }

          // Tick open positions with new prices
          get().tickPositions();

        } catch (err) {
          get().addLog("error", `Scan failed: ${err instanceof Error ? err.message : "unknown error"}`);
        } finally {
          set({ scanning: false });
        }
      },

      tickPositions: () => {
        const { positions, quotes, addLog } = get();
        let changed = false;
        const updated = positions.map(pos => {
          if (pos.status === "closed") return pos;
          const q = quotes.find(q => q.symbol === pos.symbol);
          if (!q) return pos;

          const { pnl, pnlPercent } = calcPnl(pos, q.price);
          const closeReason = shouldClose(pos, q.price);
          changed = true;

          if (closeReason) {
            const label = closeReason === "take_profit" ? "✅ TAKE PROFIT" : "🛑 STOP LOSS";
            addLog("trade_close", `${label} ${pos.symbol} ${pos.direction} — P&L: ${pnl >= 0 ? "+" : ""}£${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%)`);
            return {
              ...pos, currentPrice: q.price, pnl, pnlPercent,
              status: "closed" as const, exitPrice: q.price,
              exitTime: new Date().toISOString(), closeReason,
            };
          }
          return { ...pos, currentPrice: q.price, pnl, pnlPercent };
        });

        if (changed) {
          set({ positions: updated, portfolio: computePortfolio(updated) });
        }
      },

      closePosition: (id, price, reason) => {
        const { addLog } = get();
        set(s => {
          const updated = s.positions.map(p => {
            if (p.id !== id || p.status === "closed") return p;
            const { pnl, pnlPercent } = calcPnl(p, price);
            addLog("trade_close", `Manual close ${p.symbol} ${p.direction} — P&L: ${pnl >= 0 ? "+" : ""}£${pnl.toFixed(2)}`);
            return {
              ...p, status: "closed" as const, exitPrice: price,
              exitTime: new Date().toISOString(), closeReason: reason,
              pnl, pnlPercent, currentPrice: price,
            };
          });
          return { positions: updated, portfolio: computePortfolio(updated) };
        });
      },

      resetSimulation: () => {
        set({
          positions: [], analyses: [], portfolio: INITIAL_PORTFOLIO,
          log: [], alreadyAnalysed: [],
        });
      },
    }),
    {
      name: "spreadbet-v2",
      partialize: (s) => ({
        positions: s.positions,
        analyses: s.analyses,
        portfolio: s.portfolio,
        alreadyAnalysed: s.alreadyAnalysed,
      }),
    }
  )
);
