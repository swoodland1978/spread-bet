"use client";

import { useEffect, useState, useCallback } from "react";
import type { StockQuote } from "@/lib/types";
import { TRIGGER_PCT, STARTING_BANKROLL } from "@/lib/stocks";

export default function Dashboard() {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`${new Date().toLocaleTimeString("en-GB")} ${msg}`, ...prev].slice(0, 50));
  }, []);

  const scan = useCallback(async () => {
    try {
      addLog("Scanning…");
      const res = await fetch("/api/scan", { cache: "no-store" });
      if (!res.ok) { addLog(`Error: HTTP ${res.status}`); return; }
      const data = await res.json();
      const q: StockQuote[] = data.quotes ?? [];
      if (q.length > 0) setQuotes(q);
      addLog(`${q.length} stocks fetched. Market ${data.marketOpen ? "OPEN" : "CLOSED"}.`);
      const triggered: string[] = data.triggered ?? [];
      if (triggered.length > 0) addLog(`⚡ Triggered: ${triggered.join(", ")}`);
    } catch (err) {
      addLog(`Failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  useEffect(() => {
    scan();
    const id = setInterval(scan, 90_000);
    return () => clearInterval(id);
  }, [scan]);

  const triggered = quotes.filter(q => Math.abs(q.changePercent) >= TRIGGER_PCT);

  return (
    <div className="min-h-dvh bg-[#0A0A0F] text-white">
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between sticky top-0 bg-[#0A0A0F]/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-bold">SpreadSim</h1>
          <p className="text-[10px] text-white/30">Mechanical mean reversion · £{STARTING_BANKROLL.toLocaleString()} paper trading · +1% TP / -2% SL</p>
        </div>
        <button onClick={scan} className="text-[10px] text-white/30 hover:text-white px-2 py-1 rounded border border-white/10">↻ Scan</button>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Stock grid */}
          <div className="lg:col-span-3">
            <p className="text-xs text-white/40 uppercase tracking-widest mb-2">
              Watchlist · {quotes.length} stocks {triggered.length > 0 && `· ${triggered.length} triggered`}
            </p>
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
                      {trig && (
                        <p className="text-[10px] text-yellow-400 mt-1 font-semibold">
                          ⚡ Auto {up ? "SHORT" : "LONG"} · target +1%
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activity log */}
          <div className="lg:col-span-2">
            <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Activity Log</p>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 max-h-[600px] overflow-y-auto">
              {log.length === 0 ? (
                <p className="text-white/20 text-xs text-center py-8">Waiting for first scan…</p>
              ) : (
                log.map((entry, i) => (
                  <p key={i} className="text-[11px] text-white/50 py-0.5 font-mono">{entry}</p>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
