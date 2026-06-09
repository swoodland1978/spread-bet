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
  const [scanning, setScanning] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "positions" | "reviews">("live");
  const tradedRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`${new Date().toLocaleTimeString("en-GB")} ${msg}`, ...prev].slice(0, 80));
  }, []);

  const tickPositions = useCallback((currentQuotes: StockQuote[], currentPositions: Position[]) => {
    let changed = false;
    const updated = currentPositions.map(pos => {
      if (pos.status === "closed") return pos;
      const q = currentQuotes.find(q => q.symbol === pos.symbol);
      if (!q) return pos;
      const { pnl, pnlPercent } = calcPnl(pos, q.price);
      changed = true;
      if (pnlPercent >= TAKE_PROFIT_PCT) {
        return { ...pos, currentPrice: q.price, pnl, pnlPercent, status: "closed" as const, exitPrice: q.price, exitTime: new Date().toISOString(), closeReason: "take_profit" as const, peakPnl: Math.max(pos.peakPnl ?? 0, pnl), troughPnl: Math.min(pos.troughPnl ?? 0, pnl) };
      }
      if (pnlPercent <= -STOP_LOSS_PCT) {
        return { ...pos, currentPrice: q.price, pnl, pnlPercent, status: "closed" as const, exitPrice: q.price, exitTime: new Date().toISOString(), closeReason: "stop_loss" as const, peakPnl: Math.max(pos.peakPnl ?? 0, pnl), troughPnl: Math.min(pos.troughPnl ?? 0, pnl) };
      }
      return { ...pos, currentPrice: q.price, pnl, pnlPercent, peakPnl: Math.max(pos.peakPnl ?? 0, pnl), troughPnl: Math.min(pos.troughPnl ?? 0, pnl) };
    });
    if (changed) return updated;
    return null;
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { cache: "no-store" });
      if (!res.ok) { addLog(`❌ Scan error: HTTP ${res.status}`); return; }
      const data = await res.json();
      const q: StockQuote[] = data.quotes ?? [];
      if (q.length > 0) setQuotes(q);
      setMarketOpen(data.marketOpen ?? false);
      setLastScan(new Date().toLocaleTimeString("en-GB"));
      addLog(`${q.length} stocks. Market ${data.marketOpen ? "OPEN" : "CLOSED"}.`);
      const triggered: string[] = data.triggered ?? [];
      if (triggered.length > 0) addLog(`⚡ Triggered: ${triggered.join(", ")}`);

      // Mechanical trades
      setPositions(prev => {
        const next = [...prev];
        for (const symbol of triggered) {
          if (tradedRef.current.has(symbol)) continue;
          if (prev.some(p => p.symbol === symbol && p.status === "open")) continue;
          const quote = q.find(x => x.symbol === symbol);
          const stock = TRACKED_STOCKS.find(s => s.symbol === symbol);
          if (!quote || !stock) continue;
          const direction = quote.changePercent > 0 ? "SHORT" as const : "LONG" as const;
          const entryPrice = direction === "LONG" ? quote.price + stock.igSpread / 2 : quote.price - stock.igSpread / 2;
          next.unshift({
            id: uid(), symbol, name: stock.name, direction, entryPrice,
            currentPrice: quote.price, stakePerPoint: STAKE_PER_POINT,
            pnl: 0, pnlPercent: 0, status: "open", entryTime: new Date().toISOString(),
            aiAnalysisId: "", aiReasoning: `Fade ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}%`,
            igSpread: stock.igSpread, priceHistory: [], peakPnl: 0, troughPnl: 0,
          });
          tradedRef.current.add(symbol);
          addLog(`${direction === "LONG" ? "📈 LONG" : "📉 SHORT"} ${symbol} @ $${quote.price.toFixed(2)} — £${STAKE_PER_POINT}/pt`);
        }
        return next;
      });

      // Tick positions
      setPositions(prev => {
        const ticked = tickPositions(q, prev);
        if (ticked) {
          ticked.forEach(p => {
            if (p.status === "closed" && prev.find(x => x.id === p.id)?.status === "open") {
              const label = p.closeReason === "take_profit" ? "✅ +1% TAKE PROFIT" : "🛑 -2% STOP LOSS";
              addLog(`${label} ${p.symbol} ${p.direction} → ${p.pnl >= 0 ? "+" : ""}£${p.pnl.toFixed(2)}`);
              requestReview(p, setReviews, addLog);
            }
          });
          return ticked;
        }
        return prev;
      });
    } catch (err) {
      addLog(`❌ ${err instanceof Error ? err.message : "Scan failed"}`);
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, [addLog, tickPositions]);

  useEffect(() => {
    scan();
    const id = setInterval(scan, 90_000);
    return () => clearInterval(id);
  }, [scan]);

  const resetAll = () => {
    setPositions([]);
    setReviews([]);
    tradedRef.current.clear();
    setLog([]);
    addLog("🔄 Simulation reset to £10,000");
  };

  // Stats
  const open = positions.filter(p => p.status === "open");
  const closed = positions.filter(p => p.status === "closed");
  const unrealised = open.reduce((s, p) => s + p.pnl, 0);
  const realised = closed.reduce((s, p) => s + p.pnl, 0);
  const cash = STARTING_BANKROLL + realised;
  const equity = cash + unrealised;
  const wins = closed.filter(p => p.pnl > 0).length;
  const losses = closed.filter(p => p.pnl < 0).length;
  const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : null;

  return (
    <div className="min-h-dvh bg-[#0A0A0F] text-white">
      {/* ── HEADER ── */}
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between sticky top-0 bg-[#0A0A0F]/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-bold tracking-tight">SpreadSim</h1>
          <p className="text-[10px] text-white/30">Auto-fade &gt;{TRIGGER_PCT}% moves · +{TAKE_PROFIT_PCT}% take profit · -{STOP_LOSS_PCT}% stop loss</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${marketOpen ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/30"}`}>
            {marketOpen ? "● NYSE Open" : "○ NYSE Closed"}
          </span>
          {scanning && <div className="w-3 h-3 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />}
          <button onClick={scan} disabled={scanning}
            className="text-[10px] text-white/40 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/30 transition-colors disabled:opacity-30 font-semibold">
            ↻ Scan Now
          </button>
          <button onClick={resetAll}
            className="text-[10px] text-red-400/50 hover:text-red-400 px-3 py-1.5 rounded-lg border border-red-500/20 hover:border-red-500/40 transition-colors font-semibold">
            Reset £10k
          </button>
        </div>
      </header>

      {/* ── PORTFOLIO BAR — BIG AND CLEAR ── */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Equity</p>
              <p className={`text-2xl font-bold font-mono ${equity >= STARTING_BANKROLL ? "text-white" : "text-red-400"}`}>
                £{equity.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Cash</p>
              <p className="text-xl font-bold font-mono text-white/80">
                £{cash.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Realised P&L</p>
              <p className={`text-xl font-bold font-mono ${realised >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {realised >= 0 ? "+" : ""}£{realised.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Open P&L</p>
              <p className={`text-xl font-bold font-mono ${unrealised >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {unrealised >= 0 ? "+" : ""}£{unrealised.toFixed(2)}
              </p>
              <p className="text-[10px] text-white/30">{open.length} position{open.length !== 1 ? "s" : ""}</p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Win / Loss</p>
              <p className="text-xl font-bold font-mono text-white">{wins}W {losses}L</p>
              <p className={`text-[10px] font-semibold ${winRate !== null && winRate >= 67 ? "text-emerald-400" : winRate !== null ? "text-red-400" : "text-white/30"}`}>
                {winRate !== null ? `${winRate}% win rate ${winRate >= 67 ? "✓" : "⚠ need 67%"}` : "No trades"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Last Scan</p>
              <p className="text-lg font-mono text-white/60">{lastScan ?? "—"}</p>
              <p className="text-[10px] text-white/20">every 90s</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="max-w-6xl mx-auto px-4 mb-4">
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
          {([
            { key: "live" as const, label: `Live Feed (${quotes.length})` },
            { key: "positions" as const, label: `Positions (${open.length} open · ${closed.length} closed)` },
            { key: "reviews" as const, label: `AI Reviews (${reviews.length})` },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === t.key ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-20">

        {/* ── LIVE FEED ── */}
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
                    const openPos = open.find(p => p.symbol === q.symbol);
                    const wasTrade = tradedRef.current.has(q.symbol);
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
                          <div className={`mt-1.5 rounded-lg px-2 py-1 ${openPos.pnl >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                            <p className={`text-[10px] font-bold ${openPos.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {openPos.direction} · {openPos.pnl >= 0 ? "+" : ""}£{openPos.pnl.toFixed(2)} ({openPos.pnlPercent >= 0 ? "+" : ""}{openPos.pnlPercent.toFixed(2)}%)
                            </p>
                          </div>
                        )}
                        {trig && !openPos && !wasTrade && (
                          <p className="text-[10px] text-yellow-400 mt-1.5 font-semibold">⚡ Will auto {up ? "SHORT" : "LONG"}</p>
                        )}
                        {wasTrade && !openPos && (
                          <p className="text-[10px] text-white/20 mt-1">✓ Traded</p>
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
                {log.length === 0 ? (
                  <p className="text-white/20 text-xs text-center py-8">Waiting for first scan…</p>
                ) : log.map((entry, i) => (
                  <p key={i} className="text-[11px] text-white/50 py-0.5 font-mono leading-relaxed">{entry}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── POSITIONS ── */}
        {tab === "positions" && (
          <div className="flex flex-col gap-4">
            {open.length > 0 && (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Open Positions ({open.length})</p>
                {open.map(p => (
                  <div key={p.id} className={`rounded-xl border p-4 mb-2 ${p.pnl >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base font-bold">{p.symbol}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.direction === "LONG" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{p.direction}</span>
                          <span className="text-[10px] text-white/30">£{p.stakePerPoint}/pt</span>
                        </div>
                        <p className="text-xs text-white/40">
                          Entry: <span className="text-white/60 font-mono">${p.entryPrice.toFixed(2)}</span> → Now: <span className="text-white/60 font-mono">${p.currentPrice.toFixed(2)}</span>
                        </p>
                        <p className="text-[10px] text-white/30 mt-1">{p.aiReasoning}</p>
                        <p className="text-[10px] text-white/20 mt-0.5">
                          TP at {p.pnlPercent >= 0 ? "+" : ""}{TAKE_PROFIT_PCT}% · SL at -{STOP_LOSS_PCT}% · Spread: ${p.igSpread.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-2xl font-bold font-mono ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(2)}
                        </p>
                        <p className={`text-sm font-mono ${p.pnlPercent >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                          {p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(2)}%
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {closed.length > 0 && (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Closed Trades ({closed.length})</p>
                {closed.map(p => {
                  const holdMins = p.exitTime ? Math.round((new Date(p.exitTime).getTime() - new Date(p.entryTime).getTime()) / 60000) : 0;
                  return (
                    <div key={p.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 mb-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white/70">{p.symbol}</span>
                          <span className={`text-[10px] font-bold ${p.direction === "LONG" ? "text-emerald-400/60" : "text-red-400/60"}`}>{p.direction}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${p.closeReason === "take_profit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                            {p.closeReason === "take_profit" ? "✅ +1% Profit" : "🛑 -2% Stop"}
                          </span>
                          <span className="text-[10px] text-white/20">${p.entryPrice.toFixed(2)} → ${(p.exitPrice ?? p.currentPrice).toFixed(2)} · {holdMins}m</span>
                        </div>
                        <p className={`text-base font-bold font-mono ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {positions.length === 0 && (
              <p className="text-white/30 text-sm text-center py-12">No positions yet. Trades fire automatically when stocks move &gt;{TRIGGER_PCT}%.</p>
            )}
          </div>
        )}

        {/* ── REVIEWS ── */}
        {tab === "reviews" && (
          <div className="flex flex-col gap-3">
            {reviews.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-12">No reviews yet. AI analyses every trade after it closes.</p>
            ) : reviews.map(r => (
              <div key={r.positionId} className={`rounded-xl border p-4 ${r.outcome === "win" ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold">{r.outcome === "win" ? "✅" : "❌"} {r.symbol} {r.direction}</span>
                  <span className={`text-sm font-bold font-mono ${r.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {r.pnl >= 0 ? "+" : ""}£{r.pnl.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-white/20">{r.holdingTimeMinutes}m hold</span>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-3 mb-2">
                  <p className="text-[10px] text-white/40 uppercase mb-1">What happened</p>
                  <p className="text-xs text-white/70 leading-relaxed">{r.review}</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] p-3">
                  <p className="text-[10px] text-yellow-400/70 uppercase mb-1">💡 Lesson</p>
                  <p className="text-xs text-white/70 leading-relaxed">{r.lessons}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
      addLog(`💡 ${review.lessons}`);
      setReviews(prev => [review, ...prev].slice(0, 50));
    }
  } catch { /* non-critical */ }
}
