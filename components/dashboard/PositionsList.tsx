"use client";

import { useStore } from "@/lib/store";

export default function PositionsList() {
  const { positions, closePosition, quotes } = useStore();
  const open = positions.filter(p => p.status === "open");
  const closed = positions.filter(p => p.status === "closed");

  return (
    <div className="flex flex-col gap-4">
      {/* Open positions */}
      {open.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
            Open Positions ({open.length})
          </h3>
          <div className="flex flex-col gap-3">
            {open.map(p => {
              const q = quotes.find(q => q.symbol === p.symbol);
              const elapsed = Math.round((Date.now() - new Date(p.entryTime).getTime()) / 60000);
              return (
                <div key={p.id} className={`rounded-xl border p-4 ${p.pnl >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-white">{p.symbol}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${p.direction === "LONG" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {p.direction}
                        </span>
                        <span className="text-[10px] text-white/30">£{p.stakePerPoint}/pt · {elapsed}m ago</span>
                      </div>
                      <p className="text-[10px] text-white/40">
                        Entry ${p.entryPrice.toFixed(2)} → Now ${p.currentPrice.toFixed(2)} (spread: ${p.igSpread.toFixed(2)})
                      </p>
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

                  {/* AI reasoning */}
                  {p.aiReasoning && (
                    <p className="text-[11px] text-white/40 mb-2 leading-relaxed">🤖 {p.aiReasoning}</p>
                  )}

                  {/* Mini P&L sparkline */}
                  {p.priceHistory && p.priceHistory.length > 1 && (
                    <div className="flex items-end gap-px h-6 mb-2">
                      {p.priceHistory.slice(-30).map((snap, i) => {
                        const max = Math.max(...p.priceHistory.slice(-30).map(s => Math.abs(s.pnl)), 1);
                        const height = Math.max(2, (Math.abs(snap.pnl) / max) * 24);
                        return (
                          <div key={i} className={`flex-1 rounded-sm ${snap.pnl >= 0 ? "bg-emerald-500/40" : "bg-red-500/40"}`}
                            style={{ height: `${height}px` }} />
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex gap-3 text-[10px] text-white/30">
                      <span>Peak: <span className="text-emerald-400/70">+£{(p.peakPnl ?? 0).toFixed(2)}</span></span>
                      <span>Trough: <span className="text-red-400/70">£{(p.troughPnl ?? 0).toFixed(2)}</span></span>
                      <span>Ticks: {p.priceHistory?.length ?? 0}</span>
                    </div>
                    <button
                      onClick={() => closePosition(p.id, q?.price ?? p.currentPrice, "manual")}
                      className="text-[10px] text-white/30 hover:text-white px-2 py-1 rounded border border-white/10 hover:border-white/30 transition-colors">
                      Close manually
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Closed positions */}
      {closed.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
            Closed Trades ({closed.length})
          </h3>
          <div className="flex flex-col gap-2">
            {closed.map(p => (
              <div key={p.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs font-bold text-white/60">{p.symbol}</span>
                    <span className={`text-[10px] font-bold ${p.direction === "LONG" ? "text-emerald-400/50" : "text-red-400/50"}`}>{p.direction}</span>
                    <span className="text-[10px] text-white/20">£{p.stakePerPoint}/pt</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      p.closeReason === "take_profit" ? "bg-emerald-500/10 text-emerald-400/60" :
                      p.closeReason === "stop_loss" ? "bg-red-500/10 text-red-400/60" :
                      "bg-white/5 text-white/30"
                    }`}>{(p.closeReason ?? "").replace("_", " ")}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold font-mono ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-white/20">
                      ${p.entryPrice.toFixed(2)} → ${(p.exitPrice ?? p.currentPrice).toFixed(2)}
                    </p>
                  </div>
                </div>
                {p.aiReasoning && (
                  <p className="text-[10px] text-white/20 mt-1 truncate">🤖 {p.aiReasoning}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {open.length === 0 && closed.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-white/30 text-sm">No positions yet. The AI will automatically trade when stocks trigger &gt;3% moves.</p>
        </div>
      )}
    </div>
  );
}
