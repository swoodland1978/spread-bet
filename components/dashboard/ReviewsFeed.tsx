"use client";

import { useStore } from "@/lib/store";

export default function ReviewsFeed() {
  const reviews = useStore(s => s.reviews);
  const portfolio = useStore(s => s.portfolio);

  if (reviews.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
        <p className="text-white/30 text-sm">No trade reviews yet. Reviews are generated after each trade closes.</p>
        <p className="text-white/20 text-xs mt-2">The AI analyses every win and loss to find patterns and improvements.</p>
      </div>
    );
  }

  const wins = reviews.filter(r => r.outcome === "win").length;
  const losses = reviews.filter(r => r.outcome === "loss").length;
  const winRate = reviews.length > 0 ? Math.round((wins / reviews.length) * 100) : 0;
  const avgWin = wins > 0 ? reviews.filter(r => r.outcome === "win").reduce((s, r) => s + r.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? reviews.filter(r => r.outcome === "loss").reduce((s, r) => s + r.pnl, 0) / losses : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Stats summary */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Win Rate</p>
          <p className={`text-xl font-bold font-mono ${winRate >= 67 ? "text-emerald-400" : winRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>{winRate}%</p>
          <p className="text-[10px] text-white/30">Need 67%+ to profit</p>
        </div>
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Record</p>
          <p className="text-xl font-bold font-mono text-white">{wins}W / {losses}L</p>
          <p className="text-[10px] text-white/30">{reviews.length} total trades</p>
        </div>
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Avg Win</p>
          <p className="text-xl font-bold font-mono text-emerald-400">+£{avgWin.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Avg Loss</p>
          <p className="text-xl font-bold font-mono text-red-400">£{avgLoss.toFixed(2)}</p>
        </div>
      </div>

      {/* Individual reviews */}
      <div className="flex flex-col gap-3">
        {reviews.map(r => (
          <div key={r.positionId} className={`rounded-xl border p-4 ${r.outcome === "win" ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${r.outcome === "win" ? "text-emerald-400" : "text-red-400"}`}>
                    {r.outcome === "win" ? "✅" : "❌"} {r.symbol}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${r.direction === "LONG" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                    {r.direction}
                  </span>
                  <span className={`text-sm font-bold font-mono ${r.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {r.pnl >= 0 ? "+" : ""}£{r.pnl.toFixed(2)}
                  </span>
                </div>
                <p className="text-[10px] text-white/30 mt-0.5">
                  ${r.entryPrice.toFixed(2)} → ${r.exitPrice.toFixed(2)} · {r.holdingTimeMinutes}m hold · triggered at {r.triggerChangePercent > 0 ? "+" : ""}{r.triggerChangePercent.toFixed(1)}%
                </p>
              </div>
              <p className="text-[10px] text-white/20 shrink-0">{new Date(r.timestamp).toLocaleTimeString("en-GB")}</p>
            </div>

            {/* AI Review */}
            <div className="flex flex-col gap-2 mt-2">
              <div className="rounded-lg bg-white/[0.03] p-3">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">What happened</p>
                <p className="text-xs text-white/70 leading-relaxed">{r.review}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] p-3">
                <p className="text-[10px] text-yellow-400/70 uppercase tracking-widest mb-1">💡 Lesson</p>
                <p className="text-xs text-white/70 leading-relaxed">{r.lessons}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
