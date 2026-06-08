"use client";

import { useStore } from "@/lib/store";

export default function AnalysisFeed() {
  const analyses = useStore(s => s.analyses);

  if (analyses.length === 0) {
    return <p className="text-white/30 text-sm text-center py-8">No AI analyses yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {analyses.map(a => (
        <div key={a.id} className={`rounded-xl border p-4 ${
          a.direction === "AVOID" ? "border-white/10 bg-white/3" :
          a.direction === "LONG" ? "border-emerald-500/30 bg-emerald-500/5" :
          "border-red-500/30 bg-red-500/5"
        }`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{a.symbol}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  a.direction === "LONG" ? "bg-emerald-500/20 text-emerald-400" :
                  a.direction === "SHORT" ? "bg-red-500/20 text-red-400" :
                  "bg-white/10 text-white/50"
                }`}>{a.direction}</span>
                <span className="text-xs text-white/40">{a.confidence}% confidence</span>
              </div>
              <p className="text-[10px] text-white/40 mt-0.5">
                Triggered at ${a.triggerPrice.toFixed(2)} ({a.triggerChangePercent > 0 ? "+" : ""}{a.triggerChangePercent.toFixed(2)}%)
                · £{a.stakePerPoint}/pt stake
              </p>
            </div>
            <p className="text-[10px] text-white/30 shrink-0">{new Date(a.timestamp).toLocaleTimeString("en-GB")}</p>
          </div>
          <p className="text-xs text-white/70 leading-relaxed">{a.reasoning}</p>
          {a.newsHeadlines.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5">
              {a.newsHeadlines.slice(0, 3).map((h, i) => (
                <p key={i} className="text-[10px] text-white/30 truncate">· {h}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
