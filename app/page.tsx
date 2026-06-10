"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

interface MovementRecord {
  symbol: string;
  name: string;
  changePercent: number;
  direction: string;
  price: number;
  timestamp: string;
  reason: string;
  category: string;
  newsHeadlines: string[];
  confidence: number;
  pattern: string;
}

const STORAGE_KEY = "spreadsim_patterns";

function loadPatterns(): MovementRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePatterns(records: MovementRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 500)));
  } catch { /* storage full */ }
}

const CATEGORY_COLORS: Record<string, string> = {
  earnings: "bg-blue-500/20 text-blue-400",
  guidance: "bg-blue-500/20 text-blue-400",
  analyst: "bg-purple-500/20 text-purple-400",
  product: "bg-cyan-500/20 text-cyan-400",
  regulatory: "bg-orange-500/20 text-orange-400",
  macro: "bg-yellow-500/20 text-yellow-400",
  sector: "bg-indigo-500/20 text-indigo-400",
  geopolitical: "bg-red-500/20 text-red-400",
  crypto: "bg-amber-500/20 text-amber-400",
  technical: "bg-teal-500/20 text-teal-400",
  unknown: "bg-white/10 text-white/40",
};

export default function Dashboard() {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [igAccount, setIgAccount] = useState<IGAccount | null>(null);
  const [igPositions, setIgPositions] = useState<IGPosition[]>([]);
  const [reviews, setReviews] = useState<TradeReview[]>([]);
  const [patterns, setPatterns] = useState<MovementRecord[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "positions" | "patterns" | "reviews">("live");
  const [errors, setErrors] = useState<string[]>([]);
  const [closingDealId, setClosingDealId] = useState<string | null>(null);
  const recordedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loaded = loadPatterns();
    setPatterns(loaded);
    loaded.forEach(r => recordedRef.current.add(`${r.symbol}-${r.timestamp.slice(0, 10)}`));
  }, []);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`${new Date().toLocaleTimeString("en-GB")} ${msg}`, ...prev].slice(0, 80));
  }, []);

  const recordMovement = useCallback(async (quote: StockQuote) => {
    const dayKey = `${quote.symbol}-${new Date().toISOString().slice(0, 10)}`;
    if (recordedRef.current.has(dayKey)) return;
    recordedRef.current.add(dayKey);

    addLog(`Recording why ${quote.symbol} moved ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}%...`);

    try {
      const res = await fetch("/api/movement-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote }),
      });
      if (!res.ok) return;
      const record: MovementRecord = await res.json();
      setPatterns(prev => {
        const next = [record, ...prev].slice(0, 500);
        savePatterns(next);
        return next;
      });
      addLog(`Pattern: ${record.symbol} [${record.category}] — ${record.reason.slice(0, 80)}`);
    } catch {
      addLog(`Failed to record ${quote.symbol} movement`);
    }
  }, [addLog]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch("/api/scan", { cache: "no-store", signal: controller.signal });
      clearTimeout(timeout);
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

      if (data.marketOpen) {
        for (const symbol of triggered) {
          const quote = q.find(x => x.symbol === symbol);
          if (quote) recordMovement(quote);
        }

        // Also record any stock moving > 5% even if below trigger threshold
        for (const quote of q) {
          if (Math.abs(quote.changePercent) >= 5 && !triggered.includes(quote.symbol)) {
            recordMovement(quote);
          }
        }
      }

      // Log trade actions from the scan
      const tradeActions = data.trades ?? [];
      for (const t of tradeActions) {
        if (t.direction === "AVOID") {
          addLog(`AVOID ${t.symbol} — ${t.reasoning}`);
        } else if (t.dealId) {
          addLog(`${t.direction} ${t.symbol} on IG (deal: ${t.dealId}) — ${t.reasoning}`);
        } else if (t.error) {
          addLog(`FAILED ${t.direction} ${t.symbol}: ${t.error}`);
        }
      }

      // Log close actions
      const closeActions = data.closes ?? [];
      for (const c of closeActions) {
        const label = c.reason === "take_profit" ? "+4% TAKE PROFIT" : c.reason === "stop_loss" ? "-2% STOP LOSS" : "24H TIME STOP";
        if (c.success) {
          addLog(`CLOSED ${c.symbol} ${label} (${c.pnlPercent > 0 ? "+" : ""}${c.pnlPercent.toFixed(2)}%)`);
        } else {
          addLog(`CLOSE FAILED ${c.symbol}: ${c.error}`);
        }
      }

      if (data.igAccount) {
        addLog(`IG: £${data.igAccount.balance.toFixed(2)} bal | £${data.igAccount.profitLoss.toFixed(2)} P&L | ${data.igPositions?.length ?? 0} positions`);
      }
    } catch (err) {
      addLog(`${err instanceof Error ? err.message : "Scan failed"}`);
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, [addLog, recordMovement]);

  const closePosition = useCallback(async (pos: IGPosition) => {
    setClosingDealId(pos.dealId);
    try {
      const res = await fetch("/api/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: pos.dealId, direction: pos.direction, size: pos.size }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Manually closed ${pos.instrumentName} (${pos.dealId})`);
        setIgPositions(prev => prev.filter(p => p.dealId !== pos.dealId));
      } else {
        addLog(`Close failed: ${data.reason ?? "unknown error"}`);
      }
    } catch (err) {
      addLog(`Close error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClosingDealId(null);
    }
  }, [addLog]);

  const [nextOpen, setNextOpen] = useState<string | null>(null);

  // Initial scan on mount
  useEffect(() => {
    scan();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once we know market state, set up the right interval
  useEffect(() => {
    if (loading) return; // wait until first scan completes

    if (marketOpen) {
      setNextOpen(null);
      const id = setInterval(scan, 180_000);
      return () => clearInterval(id);
    } else {
      // Calculate ms until next NYSE open (9:30 AM ET)
      const now = new Date();
      const year = now.getUTCFullYear();
      const dstStart = new Date(Date.UTC(year, 2, 8));
      dstStart.setUTCDate(8 + (7 - dstStart.getUTCDay()) % 7);
      const dstEnd = new Date(Date.UTC(year, 10, 1));
      dstEnd.setUTCDate(1 + (7 - dstEnd.getUTCDay()) % 7);
      const offsetHours = now >= dstStart && now < dstEnd ? -4 : -5;
      const etNow = new Date(now.getTime() + offsetHours * 3_600_000);
      const day = etNow.getUTCDay();
      const mins = etNow.getUTCHours() * 60 + etNow.getUTCMinutes();

      let daysAhead = (day === 0 || day === 6 || mins >= 960) ? 1 : 0;
      let candidate = new Date(etNow.getTime() + daysAhead * 86_400_000);
      while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
        daysAhead++;
        candidate = new Date(etNow.getTime() + daysAhead * 86_400_000);
      }
      const nextOpenET = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(), 9, 30, 0));
      const nextOpenUTC = new Date(nextOpenET.getTime() - offsetHours * 3_600_000);
      const ms = Math.max(60_000, nextOpenUTC.getTime() - now.getTime());

      setNextOpen(nextOpenUTC.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }));
      addLog(`Market closed. Next open ${nextOpenUTC.toLocaleTimeString("en-GB")} (${Math.round(ms / 60_000)}min)`);

      const id = setTimeout(() => { scan(); }, ms);
      return () => clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketOpen, loading]);

  const liveQuotes = quotes;

  const totalOpenPnl = igPositions.reduce((s, p) => s + p.profitLoss, 0);

  // Pattern stats
  const categoryCount: Record<string, number> = {};
  patterns.forEach(p => { categoryCount[p.category] = (categoryCount[p.category] ?? 0) + 1; });
  const topCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);
  const stockCount: Record<string, number> = {};
  patterns.forEach(p => { stockCount[p.symbol] = (stockCount[p.symbol] ?? 0) + 1; });
  const mostVolatile = Object.entries(stockCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

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
            {marketOpen ? "NYSE Open" : nextOpen ? `Sleeping — opens ${nextOpen}` : "NYSE Closed"}
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
                <p className="text-[10px] text-white/20">{marketOpen ? "every 3 min" : nextOpen ? "sleeping" : "market closed"}</p>
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
            { key: "patterns" as const, label: `Patterns (${patterns.length})` },
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
                  {liveQuotes.map(q => {
                    const up = q.changePercent >= 0;
                    const trig = Math.abs(q.changePercent) >= TRIGGER_PCT;
                    const notable = Math.abs(q.changePercent) >= 3;
                    const openPos = igPositions.find(p => p.instrumentName.toLowerCase().includes(q.name.toLowerCase().split(" ")[0]));
                    const latestPattern = patterns.find(p => p.symbol === q.symbol);
                    return (
                      <div key={q.symbol} className={`rounded-xl border p-3 ${trig ? "border-yellow-500/60 bg-yellow-500/5" : notable ? "border-blue-500/30 bg-blue-500/5" : "border-white/10 bg-white/[0.03]"}`}>
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
                        {latestPattern && notable && (
                          <div className="mt-1.5">
                            <p className="text-[10px] text-white/50 leading-snug">{latestPattern.reason.slice(0, 100)}{latestPattern.reason.length > 100 ? "..." : ""}</p>
                            <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded mt-1 font-semibold ${CATEGORY_COLORS[latestPattern.category] ?? CATEGORY_COLORS.unknown}`}>
                              {latestPattern.category}
                            </span>
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
                      <div className="text-right shrink-0 flex flex-col items-end gap-2">
                        <p className={`text-2xl font-bold font-mono ${p.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {p.profitLoss >= 0 ? "+" : ""}£{p.profitLoss.toFixed(2)}
                        </p>
                        <button
                          onClick={() => closePosition(p)}
                          disabled={closingDealId !== null}
                          className="text-[11px] font-semibold px-3 py-1 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                        >
                          {closingDealId === p.dealId ? "Closing..." : "Close"}
                        </button>
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
              <p className="text-white/30 text-sm text-center py-8">No open positions on IG. Trades fire automatically when stocks move &gt;{TRIGGER_PCT}%.</p>
            )}

            {/* Test trade panel */}
            <TestTradePanel onTradeComplete={() => { scan(); setTab("positions"); }} addLog={addLog} />
          </div>
        )}

        {/* PATTERNS */}
        {tab === "patterns" && (
          <div className="flex flex-col gap-4">
            {/* Stats summary */}
            {patterns.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2">Movements Recorded</p>
                  <p className="text-3xl font-bold font-mono text-white">{patterns.length}</p>
                  <p className="text-[10px] text-white/30 mt-1">since {patterns[patterns.length - 1]?.timestamp.slice(0, 10)}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2">Top Catalysts</p>
                  <div className="flex flex-wrap gap-1">
                    {topCategories.slice(0, 5).map(([cat, count]) => (
                      <span key={cat} className={`text-[10px] px-2 py-0.5 rounded font-semibold ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.unknown}`}>
                        {cat} ({count})
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2">Most Volatile</p>
                  <div className="flex flex-wrap gap-1">
                    {mostVolatile.map(([sym, count]) => (
                      <span key={sym} className="text-[10px] px-2 py-0.5 rounded font-semibold bg-white/10 text-white/70">
                        {sym} ({count}x)
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Pattern list */}
            {patterns.length > 0 ? patterns.map((r, i) => (
              <div key={`${r.symbol}-${r.timestamp}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold">{r.symbol}</span>
                    <span className={`text-xs font-bold ${r.direction === "UP" ? "text-emerald-400" : "text-red-400"}`}>
                      {r.direction === "UP" ? "+" : ""}{r.changePercent.toFixed(2)}%
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${CATEGORY_COLORS[r.category] ?? CATEGORY_COLORS.unknown}`}>
                      {r.category}
                    </span>
                    {r.confidence > 0 && (
                      <span className="text-[10px] text-white/30">conf: {r.confidence}/10</span>
                    )}
                  </div>
                  <span className="text-[10px] text-white/30 shrink-0">{new Date(r.timestamp).toLocaleDateString("en-GB")} {new Date(r.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>

                <div className="rounded-lg bg-white/[0.03] p-3 mb-2">
                  <p className="text-[10px] text-white/40 uppercase mb-1">Why it moved</p>
                  <p className="text-xs text-white/70 leading-relaxed">{r.reason}</p>
                </div>

                {r.pattern && (
                  <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/10 p-2">
                    <p className="text-[10px] text-yellow-400/80 font-semibold">Pattern: {r.pattern}</p>
                  </div>
                )}

                {r.newsHeadlines.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] text-white/30 mb-1">Key Headlines</p>
                    {r.newsHeadlines.map((h, j) => (
                      <p key={j} className="text-[10px] text-white/50 leading-relaxed">• {h}</p>
                    ))}
                  </div>
                )}
              </div>
            )) : (
              <p className="text-white/30 text-sm text-center py-12">No patterns recorded yet. Movements &gt;3% are automatically analysed and stored here.</p>
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

function TestTradePanel({ onTradeComplete, addLog }: { onTradeComplete: () => void; addLog: (msg: string) => void }) {
  const [symbol, setSymbol] = useState("GOOGL");
  const [direction, setDirection] = useState<"BUY" | "SELL">("SELL");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function placeTrade() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/test-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, direction }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(`✓ ${direction} ${symbol} placed — deal: ${data.dealId ?? "pending"}`);
        addLog(`TEST TRADE: ${direction} ${symbol} (deal: ${data.dealId})`);
        onTradeComplete();
      } else {
        setResult(`✗ Failed: ${data.error}`);
      }
    } catch (err) {
      setResult(`✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 mt-4">
      <p className="text-[10px] text-yellow-400/70 uppercase tracking-widest mb-3">Test Trade (Demo Only)</p>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
        >
          {["TSLA","NVDA","AMD","META","AAPL","MSFT","AMZN","GOOGL","NFLX","PLTR","COIN","RIVN","MSTR","ARM","SMCI","ABNB","ZM","BABA","MARA","RIOT","AVGO"].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={() => setDirection("BUY")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${direction === "BUY" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "border-white/10 text-white/40 hover:text-white/70"}`}>
          BUY
        </button>
        <button onClick={() => setDirection("SELL")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${direction === "SELL" ? "bg-red-500/20 border-red-500/40 text-red-400" : "border-white/10 text-white/40 hover:text-white/70"}`}>
          SELL
        </button>
        <button onClick={placeTrade} disabled={loading}
          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/30 transition-colors disabled:opacity-40">
          {loading ? "Placing..." : "Place Test Trade"}
        </button>
      </div>
      {result && <p className={`text-xs mt-2 font-mono ${result.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{result}</p>}
    </div>
  );
}
