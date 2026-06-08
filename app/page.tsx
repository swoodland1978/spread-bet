"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { LogEntry } from "@/lib/store";
import StockCard from "@/components/dashboard/StockCard";
import PortfolioBar from "@/components/dashboard/PortfolioBar";
import PositionsList from "@/components/dashboard/PositionsList";
import ReviewsFeed from "@/components/dashboard/ReviewsFeed";
import Playbook from "@/components/dashboard/Playbook";

const SCAN_INTERVAL_MS = 90_000;

export default function Dashboard() {
  // Hydration guard — wait for client-side mount before rendering store data
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] text-white flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-sm text-white/40">Starting SpreadSim…</p>
        </div>
      </div>
    );
  }

  return <DashboardInner />;
}

function DashboardInner() {
  const runScan = useStore(s => s.runScan);
  const scanning = useStore(s => s.scanning);
  const quotes = useStore(s => s.quotes);
  const marketOpen = useStore(s => s.marketOpen);
  const lastScanAt = useStore(s => s.lastScanAt);
  const log = useStore(s => s.log);
  const resetSimulation = useStore(s => s.resetSimulation);
  const openCount = useStore(s => s.positions.filter(p => p.status === "open").length);
  const [tab, setTab] = useState<"live" | "positions" | "reviews" | "playbook">("live");
  const reviewCount = useStore(s => s.reviews.length);

  // Auto-scan on mount + interval
  useEffect(() => {
    runScan();
    const id = setInterval(runScan, SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [runScan]);

  return (
    <div className="min-h-dvh bg-[#0A0A0F] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between sticky top-0 bg-[#0A0A0F]/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-bold tracking-tight">SpreadSim</h1>
          <p className="text-[10px] text-white/30">Automated AI paper trading · £10k starting · Spread bet style</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${marketOpen ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/30"}`}>
            {marketOpen ? "● NYSE Open" : "○ NYSE Closed"}
          </span>
          {scanning && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
              <span className="text-[10px] text-emerald-400">Scanning…</span>
            </div>
          )}
          <button onClick={() => runScan()} disabled={scanning}
            className="text-[10px] text-white/30 hover:text-white px-2 py-1 rounded border border-white/10 hover:border-white/30 transition-colors disabled:opacity-30">
            ↻ Scan now
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-4 pb-20">
        {/* Portfolio summary */}
        <PortfolioBar />

        {/* Tabs */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {([
              { key: "live" as const, label: "Live Feed" },
              { key: "positions" as const, label: `Positions (${openCount})` },
              { key: "reviews" as const, label: `Reviews (${reviewCount})` },
              { key: "playbook" as const, label: "Playbook" },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === t.key ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={resetSimulation}
            className="text-[10px] text-red-400/50 hover:text-red-400 px-2 py-1 rounded border border-red-500/20 hover:border-red-500/40 transition-colors">
            Reset £10k
          </button>
        </div>

        {/* Live Feed — stock grid + activity log side by side */}
        {tab === "live" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Stock grid — 3 cols on desktop */}
            <div className="lg:col-span-3">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">
                Watchlist · {quotes.length} stocks
                {lastScanAt && <span className="text-white/20 ml-2">· updated {new Date(lastScanAt).toLocaleTimeString("en-GB")}</span>}
              </h3>
              {quotes.length === 0 ? (
                <div className="flex items-center justify-center gap-3 py-16">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-sm text-white/40">Loading prices…</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {quotes.map(q => (
                    <StockCard key={q.symbol} quote={q} />
                  ))}
                </div>
              )}
            </div>

            {/* Activity log — 2 cols on desktop */}
            <div className="lg:col-span-2">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Activity Log</h3>
              <div className="rounded-xl border border-white/10 bg-white/3 p-3 max-h-[600px] overflow-y-auto flex flex-col gap-1">
                {log.length === 0 ? (
                  <p className="text-white/20 text-xs text-center py-8">Waiting for first scan…</p>
                ) : (
                  log.slice(0, 50).map(entry => (
                    <LogLine key={entry.id} entry={entry} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "positions" && <PositionsList />}
        {tab === "reviews" && <ReviewsFeed />}
        {tab === "playbook" && <Playbook />}
      </main>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const colorMap: Record<LogEntry["type"], string> = {
    scan: "text-white/30",
    trigger: "text-yellow-400",
    review: "text-blue-400",
    trade_open: "text-emerald-400",
    trade_close: "text-orange-400",
    info: "text-white/40",
    error: "text-red-400",
  };

  return (
    <div className="flex gap-2 items-start text-[11px] leading-tight py-0.5">
      <span className="text-white/20 shrink-0 font-mono">{new Date(entry.time).toLocaleTimeString("en-GB")}</span>
      <span className={colorMap[entry.type]}>{entry.message}</span>
    </div>
  );
}
