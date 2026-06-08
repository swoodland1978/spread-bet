"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { StockQuote, Position, TradeReview } from "@/lib/types";
import { TRIGGER_PCT, TAKE_PROFIT_PCT, STOP_LOSS_PCT, STARTING_BANKROLL, STAKE_PER_POINT, TRACKED_STOCKS } from "@/lib/stocks";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function calcPnl(pos: Position, price: number) {
  const pts = pos.direction === "LONG" ? price - pos.entryPrice : pos.entryPrice - price;
  const pnl = pts * pos.stakePerPoint;
  const pnlPct = (pts / pos.entryPrice) * 100;
  return { pnl: Math.round(pnl * 100) / 100, pnlPercent: Math.round(pnlPct * 100) / 100 };
}

export default function Dashboard() {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [reviews, setReviews] = useState<TradeReview[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"live" | "positions" | "reviews">("live");
  const tradedRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`${new Date().toLocaleTimeString("en-GB")} ${msg}`, ...prev].slice(0, 80));
  }, []);

  // ── Tick positions with new prices ──
  const tickPositions = useCallback((currentQuotes: StockQuote[], currentPositions: Position[]) => {
    let changed = false;
    const updated = currentPositions.map(pos => {
      if (pos.status === "closed") return pos;
      const q = currentQuotes.find(q => q.symbol === pos.symbol);
      if (!q) return pos;
      const { pnl, pnlPercent } = calcPnl(pos, q.price);
      changed = true;

      if (pnlPercent >= TAKE_PROFIT_PCT) {
        const holdMins = Math.round((Date.now() - new Date(pos.entryTime).getTime()) / 60000);
        return { ...pos, currentPrice: q.price, pnl, pnlPercent, status: "closed" as const, exitPrice: q.price, exitTime: new Date().toISOString(), closeReason: "take_profit" as const };
      }
      if (pnlPercent <= -STOP_LOSS_PCT) {
        return { ...pos, currentPrice: q.price, pnl, pnlPercent, status: "closed" as const, exitPrice: q.price, exitTime: new Date().toISOString(), closeReason: "stop_loss" as const };
      }
      return { ...pos, currentPrice: q.price, pnl, pnlPercent };
    });
    if (changed) return updated;
    return null;
  }, []);

  // ── Scan ──
  const scan = useCallback(async () => {
    try {
      const res = await fetch("/api/scan", { cache: "no-store" });
      if (!res.ok) { addLog(`Error: HTTP ${res.status}`); return; }
      const data = await res.json();
      const q: StockQuote[] = data.quotes ?? [];
      if (q.length > 0) setQuotes(q);
      addLog(`${q.length} stocks. Market ${data.marketOpen ? "OPEN" : "CLOSED"}.`);

      const triggered: string[] = data.triggered ?? [];
      if (triggered.length > 0) addLog(`⚡ ${triggered.join(", ")} moved >${TRIGGER_PCT}%`);

      // Open mechanical trades
      setPositions(prev => {
        const newPositions = [...prev];
        for (const symbol of triggered) {
          if (tradedRef.current.has(symbol)) continue;
          if (prev.some(p => p.symbol === symbol && p.status === "open")) continue;
          const quote = q.find(x => x.symbol === symbol);
          const stock = TRACKED_STOCKS.find(s => s.symbol === symbol);
          if (!quote || !stock) continue;

          const direction = quote.changePercent > 0 ? "SHORT" as const : "LONG" as const;
          const entryPrice = direction === "LONG"
            ? quote.price + stock.igSpread / 2
            : quote.price - stock.igSpread / 2;

          newPositions.unshift({
            id: uid(), symbol, name: stock.name, direction, entryPrice,
            currentPrice: quote.price, stakePerPoint: STAKE_PER_POINT,
            pnl: 0, pnlPercent: 0, status: "open", entryTime: new Date().toISOString(),
            aiAnalysisId: "", aiReasoning: `Fade ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}% → ${direction}`,
            igSpread: stock.igSpread, priceHistory: [], peakPnl: 0, troughPnl: 0,
          });
          tradedRef.current.add(symbol);
          addLog(`${direction === "LONG" ? "📈" : "📉"} ${direction} ${symbol} @ $${quote.price.toFixed(2)}`);
        }
        return newPositions;
      });

      // Tick existing positions
      setPositions(prev => {
        const ticked = tickPositions(q, prev);
        if (ticked) {
          // Log any closes
          ticked.forEach(p => {
            if (p.status === "closed" && prev.find(x => x.id === p.id)?.status === "open") {
              const label = p.closeReason === "take_profit" ? "✅ +1% PROFIT" : "🛑 -2% STOP";
              addLog(`${label} ${p.symbol} ${p.direction} → ${p.pnl >= 0 ? "+" : ""}£${p.pnl.toFixed(2)}`);
              // Request AI review
              requestReview(p, setReviews, addLog);
            }
          });
          return ticked;
        }
        return prev;
      });

    } catch (err) {
      addLog(`Failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setLoading(false);
    }
  }, [addLog, tickPositions]);

  useEffect(() => {
    scan();
    const id = setInterval(scan, 90_000);
    return () => clearInterval(id);
  }, [scan]);

  // ── Derived stats ──
  const openPositions = positions.filter(p => p.status === "open");
  const closedPositions = positions.filter(p => p.status === "closed");
  const unrealisedPnl = openPositions.reduce((s, p) => s + p.pnl, 0);
  const realisedPnl = closedPositions.reduce((s, p) => s + p.pnl, 0);
  const totalPnl = realisedPnl;
  const cash = STARTING_BANKROLL + totalPnl;
  const wins = closedPositions.filter(p => p.pnl > 0).length;
  const losses = closedPositions.filter(p => p.pnl < 0).length;
  const winRate = closedPositions.length > 0 ? Math.round((wins / closedPositions.length) * 100) : null;

  return (
    <div className="min-h-dvh bg-[#0A0A0F] text-white">
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between sticky top-0 bg-[#0A0A0F]/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-bold">SpreadSim</h1>
          <p className="text-[10px] text-white/30">Fade &gt;{TRIGGER_PCT}% moves · +{TAKE_PROFIT_PCT}% TP / -{STOP_LOSS_PCT}% SL · £{STARTING_BANKROLL.toLocaleString()}</p>
        </div>
        <button onClick={scan} className="text-[10px] text-white/30 hover:text-white px-2 py-1 rounded border border-white/10">↻ Scan</button>
      </header>

      {/* Portfolio bar */}
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-wrap gap-6 items-center">
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">Portfolio</p>
            <p className="text-lg font-bold font-mono">£{(cash + unrealisedPnl).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className={`text-[11px] ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              Realised: {totalPnl >= 0 ? "+" : ""}£{totalPnl.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">Open P&L</p>
            <p className={`text-lg font-bold font-mono ${unrealisedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {unrealisedPnl >= 0 ? "+" : ""}£{unrealisedPnl.toFixed(2)}
            </p>
            <p className="text-[11px] text-white/30">{openPositions.length} open</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">W / L</p>
            <p className="text-lg font-bold font-mono">{wins} / {losses}</p>
            <p className={`text-[11px] ${winRate !== null && winRate >= 67 ? "text-emerald-400" : winRate !== null && winRate < 50 ? "text-red-400" : "text-white/30"}`}>
              {winRate !== null ? `${winRate}% win rate` : "No trades yet"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit mb-4">
          {([
            { key: "live" as const, label: "Live Feed" },
            { key: "positions" as const, label: `Positions (${openPositions.length})` },
            { key: "reviews" as const, label: `Reviews (${reviews.length})` },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === t.key ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-20">
        {/* Live Feed */}
        {tab === "live" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              {loading && quotes.length === 0 ? (
                <div className="flex items-center gap-3 py-16 justify-center">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-sm text-white/40">Loading prices…</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {quotes.map(q => {
                    const up = q.changePercent >= 0;
                    const trig = Math.abs(q.changePercent) >= TRIGGER_PCT;
                    const openPos = openPositions.find(p => p.symbol === q.symbol);
                    return (
                      <div key={q.symbol} className={`rounded-xl border p-3 ${trig ? "border-yellow-500/60 bg-yellow-500/5" : "border-white/10 bg-white/[0.03]"}`}>
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-xs font-bold">{q.symbol}</p>
                            <p className="text-[10px] text-white/40">{q.name}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-mono font-semibold">${q.price.toFixed(2)}</p>
                            <p className={`text-xs font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
                              {up ? "▲" : "▼"} {Math.abs(q.changePercent).toFixed(2)}%
                            </p>
                          </div>
                        </div>
                        {openPos && (
                          <p className={`text-[10px] mt-1 font-semibold ${openPos.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {openPos.direction} {openPos.pnl >= 0 ? "+" : ""}£{openPos.pnl.toFixed(2)}
                          </p>
                        )}
                        {trig && !openPos && !tradedRef.current.has(q.symbol) && (
                          <p className="text-[10px] text-yellow-400 mt-1 font-semibold">⚡ Auto {up ? "SHORT" : "LONG"}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="lg:col-span-2">
              <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Activity Log</p>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 max-h-[600px] overflow-y-auto">
                {log.map((entry, i) => (
                  <p key={i} className="text-[11px] text-white/50 py-0.5 font-mono">{entry}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Positions */}
        {tab === "positions" && (
          <div className="flex flex-col gap-4">
            {openPositions.length > 0 && (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Open ({openPositions.length})</p>
                {openPositions.map(p => (
                  <div key={p.id} className={`rounded-xl border p-3 mb-2 ${p.pnl >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-bold">{p.symbol}</span>
                        <span className={`text-[10px] ml-2 font-bold ${p.direction === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{p.direction}</span>
                        <p className="text-[10px] text-white/40">Entry ${p.entryPrice.toFixed(2)} → ${p.currentPrice.toFixed(2)}</p>
                        <p className="text-[10px] text-white/30">{p.aiReasoning}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold font-mono ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(2)}
                        </p>
                        <p className={`text-xs ${p.pnlPercent >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                          {p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(2)}%
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {closedPositions.length > 0 && (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Closed ({closedPositions.length})</p>
                {closedPositions.map(p => (
                  <div key={p.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white/60">{p.symbol}</span>
                      <span className={`text-[10px] font-bold ${p.direction === "LONG" ? "text-emerald-400/60" : "text-red-400/60"}`}>{p.direction}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.closeReason === "take_profit" ? "bg-emerald-500/10 text-emerald-400/60" : "bg-red-500/10 text-red-400/60"}`}>
                        {p.closeReason === "take_profit" ? "+1% profit" : "-2% stop"}
                      </span>
                    </div>
                    <p className={`text-sm font-bold font-mono ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {positions.length === 0 && (
              <p className="text-white/30 text-sm text-center py-8">No positions yet. Trades open automatically when stocks move &gt;{TRIGGER_PCT}%.</p>
            )}
          </div>
        )}

        {/* Reviews */}
        {tab === "reviews" && (
          <div className="flex flex-col gap-3">
            {reviews.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-8">No reviews yet. AI reviews each trade after it closes.</p>
            ) : reviews.map(r => (
              <div key={r.positionId} className={`rounded-xl border p-4 ${r.outcome === "win" ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold">{r.outcome === "win" ? "✅" : "❌"} {r.symbol}</span>
                  <span className={`text-sm font-bold font-mono ${r.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {r.pnl >= 0 ? "+" : ""}£{r.pnl.toFixed(2)}
                  </span>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-3 mb-2">
                  <p className="text-[10px] text-white/40 uppercase mb-1">What happened</p>
                  <p className="text-xs text-white/70">{r.review}</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-3">
                  <p className="text-[10px] text-yellow-400/70 uppercase mb-1">💡 Lesson</p>
                  <p className="text-xs text-white/70">{r.lessons}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Fire-and-forget AI review of a closed trade */
async function requestReview(
  pos: Position,
  setReviews: React.Dispatch<React.SetStateAction<TradeReview[]>>,
  addLog: (msg: string) => void,
) {
  try {
    const holdMins = Math.round((Date.now() - new Date(pos.entryTime).getTime()) / 60000);
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positionId: pos.id, symbol: pos.symbol, name: pos.name,
        direction: pos.direction, outcome: pos.pnl >= 0 ? "win" : "loss",
        pnl: pos.pnl, pnlPercent: pos.pnlPercent,
        entryPrice: pos.entryPrice, exitPrice: pos.exitPrice ?? pos.currentPrice,
        holdingTimeMinutes: holdMins,
        triggerChangePercent: parseFloat(pos.aiReasoning?.match(/[+-]?\d+\.?\d*/)?.[0] ?? "0"),
        closeReason: pos.closeReason, peakPnl: pos.peakPnl, troughPnl: pos.troughPnl,
      }),
    });
    if (!res.ok) return;
    const review = await res.json();
    if (review.review) {
      addLog(`🎓 ${pos.symbol}: ${review.review}`);
      addLog(`💡 Lesson: ${review.lessons}`);
      setReviews(prev => [review, ...prev].slice(0, 50));
    }
  } catch { /* non-critical */ }
}
