"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StockQuote, Position, Portfolio, CloseReason, TradeReview } from "./types";
import { calcPnl, shouldClose, computePortfolio } from "./portfolio";
import { TRACKED_STOCKS, TRIGGER_PCT, STAKE_PER_POINT } from "./stocks";

export interface LogEntry {
  id: string;
  time: string;
  type: "scan" | "trigger" | "trade_open" | "trade_close" | "review" | "info" | "error";
  message: string;
}

interface AppState {
  quotes: StockQuote[];
  positions: Position[];
  reviews: TradeReview[];
  playbook: string;
  playbookGeneratedAt: string | null;
  portfolio: Portfolio;
  log: LogEntry[];
  lastScanAt: string | null;
  marketOpen: boolean;
  scanning: boolean;
  tradedToday: string[];

  // Actions
  runScan: () => Promise<void>;
  tickPositions: () => void;
  closePosition: (id: string, price: number, reason: CloseReason) => void;
  generatePlaybook: () => Promise<void>;
  addLog: (type: LogEntry["type"], message: string) => void;
  resetSimulation: () => void;
}

const INITIAL_PORTFOLIO: Portfolio = {
  cash: 10000, startingCash: 10000, totalPnl: 0, totalPnlPercent: 0,
  totalTrades: 0, winningTrades: 0, losingTrades: 0,
};

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

let logCounter = 0;

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      quotes: [],
      positions: [],
      reviews: [],
      playbook: "",
      playbookGeneratedAt: null,
      portfolio: INITIAL_PORTFOLIO,
      log: [],
      lastScanAt: null,
      marketOpen: false,
      scanning: false,
      tradedToday: [],

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
        if (get().scanning) return;
        set({ scanning: true });
        const { addLog } = get();

        try {
          const res = await fetch("/api/scan", { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          const newQuotes: StockQuote[] = data.quotes ?? [];
          const marketOpen: boolean = data.marketOpen ?? false;
          const triggered: string[] = data.triggered ?? [];

          // Keep last known quotes if this scan returned empty
          const quotes = newQuotes.length > 0 ? newQuotes : get().quotes;
          set({ quotes, marketOpen, lastScanAt: data.scannedAt });

          if (newQuotes.length > 0) {
            addLog("scan", `${newQuotes.length} stocks fetched. Market ${marketOpen ? "OPEN" : "CLOSED"}.`);
          }

          if (triggered.length > 0) {
            addLog("trigger", `⚡ ${triggered.length} stock${triggered.length !== 1 ? "s" : ""} moved >${TRIGGER_PCT}%: ${triggered.join(", ")}`);
          }

          // ── MECHANICAL TRADES — no AI, instant execution ──
          try {
            for (const symbol of triggered) {
              const currentState = get();
              if (currentState.tradedToday.includes(symbol)) continue;
              if (currentState.positions.some(p => p.symbol === symbol && p.status === "open")) continue;

              const quote = quotes.find(q => q.symbol === symbol);
              const stock = TRACKED_STOCKS.find(s => s.symbol === symbol);
              if (!quote || !stock) continue;

              const direction = quote.changePercent > 0 ? "SHORT" as const : "LONG" as const;
              const entryPrice = direction === "LONG"
                ? quote.price + stock.igSpread / 2
                : quote.price - stock.igSpread / 2;

              const pos: Position = {
                id: uid(),
                symbol,
                name: stock.name,
                direction,
                entryPrice,
                currentPrice: quote.price,
                stakePerPoint: STAKE_PER_POINT,
                pnl: 0,
                pnlPercent: 0,
                status: "open",
                entryTime: new Date().toISOString(),
                aiAnalysisId: "",
                aiReasoning: `Mechanical fade: ${stock.name} moved ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}% → ${direction}. Target +1%, stop -2%.`,
                igSpread: stock.igSpread,
                priceHistory: [{ time: new Date().toISOString(), price: quote.price, pnl: 0 }],
                peakPnl: 0,
                troughPnl: 0,
              };

              set(s => ({
                positions: [pos, ...s.positions],
                portfolio: computePortfolio([pos, ...s.positions]),
                tradedToday: [...s.tradedToday, symbol],
              }));

              addLog("trade_open", `${direction === "LONG" ? "📈" : "📉"} ${direction} ${symbol} at $${quote.price.toFixed(2)} — fading ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}% move`);
            }
          } catch (tradeErr) {
            addLog("error", `Trade execution error: ${tradeErr instanceof Error ? tradeErr.message : "unknown"}`);
          }

          // Tick open positions with new prices
          try { get().tickPositions(); } catch { /* non-critical */ }

        } catch (err) {
          get().addLog("error", `Scan failed: ${err instanceof Error ? err.message : "unknown"}`);
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

          // Record price snapshot
          const snapshot = { time: new Date().toISOString(), price: q.price, pnl };
          const history = [...(pos.priceHistory ?? []), snapshot].slice(-120);
          const peakPnl = Math.max(pos.peakPnl ?? 0, pnl);
          const troughPnl = Math.min(pos.troughPnl ?? 0, pnl);

          if (closeReason) {
            const isWin = closeReason === "take_profit";
            const label = isWin ? "✅ TAKE PROFIT +1%" : "🛑 STOP LOSS -2%";
            const holdMins = Math.round((Date.now() - new Date(pos.entryTime).getTime()) / 60000);
            addLog("trade_close", `${label} ${pos.symbol} ${pos.direction} — P&L: ${pnl >= 0 ? "+" : ""}£${pnl.toFixed(2)} — held ${holdMins}m`);

            // Fire post-trade AI review in background
            requestTradeReview({
              positionId: pos.id,
              symbol: pos.symbol,
              name: pos.name,
              direction: pos.direction,
              outcome: isWin ? "win" : "loss",
              pnl,
              pnlPercent,
              entryPrice: pos.entryPrice,
              exitPrice: q.price,
              holdingTimeMinutes: holdMins,
              triggerChangePercent: parseFloat(pos.aiReasoning?.match(/[+-]?\d+\.?\d*%/)?.[0] ?? "0"),
              closeReason,
              peakPnl,
              troughPnl,
            });

            return {
              ...pos, currentPrice: q.price, pnl, pnlPercent,
              status: "closed" as const, exitPrice: q.price,
              exitTime: new Date().toISOString(), closeReason,
              priceHistory: history, peakPnl, troughPnl,
            };
          }
          return { ...pos, currentPrice: q.price, pnl, pnlPercent, priceHistory: history, peakPnl, troughPnl };
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
            return {
              ...p, status: "closed" as const, exitPrice: price,
              exitTime: new Date().toISOString(), closeReason: reason,
              pnl, pnlPercent, currentPrice: price,
            };
          });
          return { positions: updated, portfolio: computePortfolio(updated) };
        });
      },

      generatePlaybook: async () => {
        const { reviews, playbook, addLog } = get();
        if (reviews.length === 0) {
          addLog("info", "No trades to generate playbook from yet.");
          return;
        }
        addLog("info", "📖 Generating playbook from all trade reviews…");
        try {
          const res = await fetch("/api/playbook", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reviews, currentPlaybook: playbook }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          set({ playbook: data.playbook, playbookGeneratedAt: data.generatedAt });
          addLog("info", `📖 Playbook updated (${reviews.length} trades analysed)`);
        } catch (err) {
          addLog("error", `Playbook generation failed: ${err instanceof Error ? err.message : "unknown"}`);
        }
      },

      resetSimulation: () => {
        set({
          positions: [], reviews: [], portfolio: INITIAL_PORTFOLIO,
          log: [], tradedToday: [],
          // Keep playbook — learnings persist across resets
        });
      },
    }),
    {
      name: "spreadbet-v5",
      partialize: (s) => ({
        quotes: s.quotes,
        positions: s.positions,
        reviews: s.reviews,
        playbook: s.playbook,
        playbookGeneratedAt: s.playbookGeneratedAt,
        portfolio: s.portfolio,
        tradedToday: s.tradedToday,
      }),
    }
  )
);

/** Fire-and-forget: send closed trade to AI for post-trade review */
async function requestTradeReview(trade: Record<string, unknown>) {
  try {
    // Include playbook context so the AI's reviews get smarter over time
    const playbook = useStore.getState().playbook;
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...trade, playbook }),
    });
    if (!res.ok) return;
    const review = await res.json();
    if (review.review) {
      useStore.getState().addLog("review", `🎓 ${trade.symbol} review: ${review.review}`);
      useStore.getState().addLog("review", `💡 ${trade.symbol} lesson: ${review.lessons}`);
      useStore.setState(s => ({ reviews: [review, ...s.reviews].slice(0, 50) }));

      // Auto-regenerate playbook every 5 trades
      const reviewCount = useStore.getState().reviews.length;
      if (reviewCount > 0 && reviewCount % 5 === 0) {
        useStore.getState().generatePlaybook();
      }
    }
  } catch {
    // Non-critical — don't block anything
  }
}
