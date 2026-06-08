"use client";

import { useEffect, useCallback, useState } from "react";
import { useStore, getTriggeredStocks } from "@/lib/store";
import StockCard from "@/components/dashboard/StockCard";
import PortfolioBar from "@/components/dashboard/PortfolioBar";
import PositionsList from "@/components/dashboard/PositionsList";
import AnalysisFeed from "@/components/dashboard/AnalysisFeed";
import type { StockQuote, AIAnalysis } from "@/lib/types";

const POLL_MS = 60_000;

export default function Dashboard() {
  const { updateQuotes, addAnalysis, openPositionFromAnalysis, setAnalysing, quotes } = useStore();
  const [tab, setTab] = useState<"watchlist" | "positions" | "analysis">("watchlist");
  const [marketOpen, setMarketOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch("/api/prices");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      updateQuotes(data.quotes ?? []);
      setMarketOpen(data.marketOpen ?? false);
      setError(null);
    } catch {
      setError("Failed to fetch prices — check your connection");
    } finally {
      setLoading(false);
    }
  }, [updateQuotes]);

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPrices]);

  const handleAnalyse = useCallback(async (quote: StockQuote) => {
    setAnalysing(quote.symbol, true);
    try {
      const newsRes = await fetch(`/api/news?symbol=${quote.symbol}&name=${encodeURIComponent(quote.name)}`);
      const newsData = await newsRes.json();

      const analysisRes = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: quote.symbol,
          name: quote.name,
          triggerPrice: quote.price,
          triggerChangePercent: quote.changePercent,
          news: newsData.articles ?? [],
        }),
      });
      if (!analysisRes.ok) throw new Error("Analysis failed");
      const analysis: AIAnalysis = await analysisRes.json();

      addAnalysis(analysis);
      if (analysis.direction !== "AVOID") {
        openPositionFromAnalysis(analysis, quote.price);
      }
    } catch (e) {
      console.error("Analyse error:", e);
    } finally {
      setAnalysing(quote.symbol, false);
    }
  }, [addAnalysis, openPositionFromAnalysis, setAnalysing]);

  const triggered = getTriggeredStocks(quotes);
  const openCount = useStore(s => s.positions.filter(p => p.status === "open").length);

  return (
    <div className="min-h-dvh bg-[#0A0A0F] text-white">
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between sticky top-0 bg-[#0A0A0F]/95 backdrop-blur z-10">
        <div>
          <h1 className="text-base font-bold tracking-tight">SpreadSim <span className="text-white/30 font-normal text-sm">by GuidGuide AI</span></h1>
          <p className="text-[10px] text-white/30">Paper trading · AI-driven · Spread bet style · £10k starting</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${marketOpen ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/30"}`}>
            {marketOpen ? "● Market Open" : "○ Market Closed"}
          </span>
          <button onClick={fetchPrices} className="text-[10px] text-white/30 hover:text-white px-2 py-1 rounded border border-white/10 hover:border-white/30 transition-colors">
            ↻ Refresh
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4 pb-20">
        <PortfolioBar />

        {triggered.length > 0 && (
          <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/5 px-4 py-2.5 flex items-center gap-2">
            <span className="text-yellow-400">⚡</span>
            <p className="text-xs text-yellow-300">
              <strong>{triggered.length} stock{triggered.length !== 1 ? "s" : ""}</strong> moved {">"}3% — AI analysis available below
            </p>
          </div>
        )}

        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
          {(["watchlist", "positions", "analysis"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${tab === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
              {t === "positions" ? `Positions (${openCount})` : t}
            </button>
          ))}
        </div>

        {tab === "watchlist" && (
          loading ? (
            <div className="flex items-center justify-center gap-3 py-16">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <p className="text-sm text-white/40">Fetching live prices…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
              <p className="text-sm text-red-400 mb-2">{error}</p>
              <button onClick={fetchPrices} className="text-xs text-white/50 hover:text-white border border-white/20 px-3 py-1 rounded-lg">Retry</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {quotes.map(q => (
                <StockCard key={q.symbol} quote={q} onAnalyse={handleAnalyse} />
              ))}
            </div>
          )
        )}

        {tab === "positions" && <PositionsList />}
        {tab === "analysis" && <AnalysisFeed />}
      </main>
    </div>
  );
}
