"use client";

import { useStore } from "@/lib/store";

export default function PositionsList() {
  const { positions, closePosition, quotes } = useStore();
  const open = positions.filter(p => p.status === "open");
  const recent = positions.filter(p => p.status === "closed").slice(0, 10);

  if (open.length === 0 && recent.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-white/30 text-sm">No positions yet. AI will open trades when stocks trigger.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {open.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">Open Positions</h3>
          <div className="flex flex-col gap-2">
            {open.map(p => {
              const q = quotes.find(q => q.symbol === p.symbol);
              return (
                <div key={p.id} className={`rounded-xl border p-3 flex items-center gap-3 ${p.pnl >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{p.symbol}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.direction === "LONG" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{p.direction}</span>
                      <span className="text-[10px] text-white/40">£{p.stakePerPoint}/pt</span>
                    </div>
                    <p className="text-[10px] text-white/40 mt-0.5">Entry ${p.entryPrice.toFixed(2)} → Now ${p.currentPrice.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold font-mono ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(2)}
                    </p>
                    <p className={`text-[10px] ${p.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(2)}%
                    </p>
                  </div>
                  <button
                    onClick={() => closePosition(p.id, q?.price ?? p.currentPrice, "manual")}
                    className="text-[10px] text-white/40 hover:text-white px-2 py-1 rounded border border-white/10 hover:border-white/30 transition-colors"
                  >
                    Close
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">Recent Closed</h3>
          <div className="flex flex-col gap-1.5">
            {recent.map(p => (
              <div key={p.id} className="rounded-xl border border-white/5 bg-white/3 p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white/70">{p.symbol}</span>
                    <span className={`text-[10px] font-bold px-1 rounded ${p.direction === "LONG" ? "text-emerald-400/70" : "text-red-400/70"}`}>{p.direction}</span>
                    <span className="text-[10px] text-white/20">{p.closeReason?.replace("_", " ")}</span>
                  </div>
                </div>
                <p className={`text-sm font-bold font-mono ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
