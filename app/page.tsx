"use client";

import { useEffect, useState, useCallback } from "react";
import type { StockQuote, TradeReview } from "@/lib/types";
import { TRIGGER_PCT, TAKE_PROFIT_PCT, STOP_LOSS_PCT } from "@/lib/stocks";

interface IGAccount {
  accountId: string;
  accountName: string;
  balance: number;
  deposit: number;
  profitLoss: number;
  available: number;
}

interface IGPosition {
  dealId: string;
  epic: string;
  direction: string;
  size: number;
  level: number;
  profitLoss: number;
  currency: string;
  instrumentName: string;
}

export default function Dashboard() {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [igAccount, setIgAccount] = useState<IGAccount | null>(null);
  const [igPositions, setIgPositions] = useState<IGPosition[]>([]);
  const [reviews, setReviews] = useState<TradeReview[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "positions" | "reviews">("live");
  const [errors, setErrors] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`${new Date().toLocaleTimeString("en-GB")} ${msg}`, ...prev].slice(0, 80));
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { cache: "no-store" });
      if (!res.ok) { addLog(`Scan error: HTTP ${res.status}`); return; }
      const data = await res.json();

      const q: StockQuote[] = data.quotes ?? [];
      if (q.length > 0) setQuotes(q);
      setMarketOpen(data.marketOpen ?? false);
      setLastScan(new Date().toLocaleTimeString("en-GB"));
      setErrors(data.errors ?? []);

      if (data.igAccount) setIgAccount(data.igAccount);
      if (data.igPositions) setIgPositions(data.igPositions);

      addLog(`${q.length} stocks fetched. Market ${data.marketOpen ? "OPEN" : "CLOSED"}.`);

      const triggered: string[] = data.triggered ?? [];
      if (triggered.length > 0) addLog(`Triggered: ${triggered.join(", ")}`);

      if (data.igAccount) {
        addLog(`IG Balance: £${data.igAccount.balance.toFixed(2)} | P&L: £${data.igAccount.profitLoss.toFixed(2)}`);
      }
      if (data.igPositions?.length > 0) {
        addLog(`IG Positions: ${data.igPositions.length} open`);
      }
    } catch (err) {
      addLog(`${err instanceof Error ? err.message : "Scan failed"}`);
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, [addLog]);

  useEffect(() => {
    scan();
    const id = setInterval(scan, 90_000);
    return () => clearInterval(id);
  }, [scan]);

  const totalOpenPnl = igPositions.reduce((s, p) => s + p.profitLoss, 0);

  return (
    <div className="min-h-dvh bg-[#0A0A0F] text-white">
      {/* HEADER */}
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between sticky top-0 bg-[#0A0A0F]/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-bold tracking-tight">SpreadSim</h1>
          <p className="text-[10px] text-white/30">IG Demo Account | Auto-fade &gt;{TRIGGER_PCT}% moves | +{TAKE_PROFIT_PCT}% TP | -{STOP_LOSS_PCT}% SL</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${marketOpen ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/30"}`}>
            {marketOpen ? "NYSE Open" : "NYSE Closed"}
          </span>
          {scanning && <div className="w-3 h-3 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />}
          <button onClick={scan} disabled={scanning}
            className="text-[10px] text-white/40 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/30 transition-colors disabled:opacity-30 font-semibold">
            Scan Now
          </button>
        </div>
      </header>

      {/* IG ACCOUNT BAR */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
          {igAccount ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">IG Balance</p>
                <p className="text-2xl font-bold font-mono text-white">
                  £{igAccount.balance.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Available</p>
                <p className="text-xl font-bold font-mono text-white/80">
                  £{igAccount.available.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">IG P&L</p>
                <p className={`text-xl font-bold font-mono ${igAccount.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {igAccount.profitLoss >= 0 ? "+" : ""}£{igAccount.profitLoss.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Open P&L</p>
                <p className={`text-xl font-bold font-mono ${totalOpenPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {totalOpenPnl >= 0 ? "+" : ""}£{totalOpenPnl.toFixed(2)}
                </p>
                <p className="text-[10px] text-white/30">{igPositions.length} position{igPositions.length !== 1 ? "s" : ""}</p>
              </div>
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Margin Used</p>
                <p className="text-xl font-bold font-mono text-white/80">
                  £{igAccount.deposit.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Last Scan</p>
                <p className="text-lg font-mono text-white/60">{lastScan ?? "—"}</p>
                <p className="text-[10px] text-white/20">every 90s</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 justify-center py-4">
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-sm text-white/40">Connecting to IG...</p>
                </>
              ) : (
                <p className="text-sm text-red-400">Failed to connect to IG account</p>
              )}
            </div>
          )}
        </div>
        {errors.length > 0 && (
          <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-[10px] text-red-400 uppercase tracking-widest mb-1">Errors</p>
            {errors.map((e, i) => <p key={i} className="text-xs text-red-400/70">{e}</p>)}
          </div>
        )}
      </div>

      {/* TABS */}
      <div className="max-w-6xl mx-auto px-4 mb-4">
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
          {([
            { key: "live" as const, label: `Live Feed (${quotes.length})` },
            { key: "positions" as const, label: `IG Positions (${igPositions.length})` },
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

        {/* LIVE FEED */}
        {tab === "live" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              {loading && quotes.length === 0 ? (
                <div className="flex items-center gap-3 py-16 justify-center">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-sm text-white/40">Loading IG prices...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {quotes.map(q => {
                    const up = q.changePercent >= 0;
                    const trig = Math.abs(q.changePercent) >= TRIGGER_PCT;
                    const openPos = igPositions.find(p => p.instrumentName.toLowerCase().includes(q.name.toLowerCase().split(" ")[0]));
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
                              {up ? "+" : ""}{q.changePercent.toFixed(2)}%
                            </p>
                          </div>
                        </div>
                        {openPos && (
                          <div className={`mt-1.5 rounded-lg px-2 py-1 ${openPos.profitLoss >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                            <p className={`text-[10px] font-bold ${openPos.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {openPos.direction} {openPos.size}u | {openPos.profitLoss >= 0 ? "+" : ""}£{openPos.profitLoss.toFixed(2)}
                            </p>
                          </div>
                        )}
                        {trig && !openPos && (
                          <p className="text-[10px] text-yellow-400 mt-1.5 font-semibold">Will auto {up ? "SHORT" : "LONG"}</p>
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
                  <p className="text-white/20 text-xs text-center py-8">Waiting for first scan...</p>
                ) : log.map((entry, i) => (
                  <p key={i} className="text-[11px] text-white/50 py-0.5 font-mono leading-relaxed">{entry}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* IG POSITIONS */}
        {tab === "positions" && (
          <div className="flex flex-col gap-4">
            {igPositions.length > 0 ? (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Open Positions on IG ({igPositions.length})</p>
                {igPositions.map(p => (
                  <div key={p.dealId} className={`rounded-xl border p-4 mb-2 ${p.profitLoss >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base font-bold">{p.instrumentName}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.direction === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{p.direction}</span>
                          <span className="text-[10px] text-white/30">{p.size} units</span>
                        </div>
                        <p className="text-xs text-white/40">
                          Entry: <span className="text-white/60 font-mono">${p.level.toFixed(2)}</span>
                        </p>
                        <p className="text-[10px] text-white/20 mt-0.5">Deal: {p.dealId} | {p.currency}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-2xl font-bold font-mono ${p.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {p.profitLoss >= 0 ? "+" : ""}£{p.profitLoss.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/40">Total Open P&L</span>
                    <span className={`text-lg font-bold font-mono ${totalOpenPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {totalOpenPnl >= 0 ? "+" : ""}£{totalOpenPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-white/30 text-sm text-center py-12">No open positions on IG. Trades fire automatically when stocks move &gt;{TRIGGER_PCT}%.</p>
            )}
          </div>
        )}

        {/* REVIEWS */}
        {tab === "reviews" && (
          <div className="flex flex-col gap-3">
            {reviews.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-12">No reviews yet. AI analyses every trade after it closes.</p>
            ) : reviews.map(r => (
              <div key={r.positionId} className={`rounded-xl border p-4 ${r.outcome === "win" ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold">{r.outcome === "win" ? "W" : "L"} {r.symbol} {r.direction}</span>
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
                  <p className="text-[10px] text-yellow-400/70 uppercase mb-1">Lesson</p>
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
