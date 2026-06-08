"use client";

import { useStore } from "@/lib/store";

export default function PortfolioBar() {
  const { portfolio, positions, lastPollAt } = useStore();
  const open = positions.filter(p => p.status === "open");
  const unrealisedPnl = open.reduce((s, p) => s + p.pnl, 0);
  const winRate = portfolio.totalTrades > 0
    ? Math.round((portfolio.winningTrades / portfolio.totalTrades) * 100)
    : null;

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-wrap gap-6 items-center">
      <Stat label="Portfolio" value={`£${(portfolio.cash + unrealisedPnl).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        sub={`${portfolio.totalPnl >= 0 ? "+" : ""}£${portfolio.totalPnl.toFixed(2)} (${portfolio.totalPnlPercent >= 0 ? "+" : ""}${portfolio.totalPnlPercent.toFixed(2)}%)`}
        subColor={portfolio.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
      <Stat label="Open P&L" value={`${unrealisedPnl >= 0 ? "+" : ""}£${unrealisedPnl.toFixed(2)}`}
        valueColor={unrealisedPnl >= 0 ? "text-emerald-400" : "text-red-400"}
        sub={`${open.length} open position${open.length !== 1 ? "s" : ""}`} />
      <Stat label="Trades" value={portfolio.totalTrades.toString()}
        sub={winRate !== null ? `${winRate}% win rate` : "No trades yet"} />
      <Stat label="W / L" value={`${portfolio.winningTrades} / ${portfolio.losingTrades}`}
        sub="Closed trades" />
      {lastPollAt && (
        <div className="ml-auto text-right">
          <p className="text-[10px] text-white/30">Last updated</p>
          <p className="text-[10px] text-white/50">{new Date(lastPollAt).toLocaleTimeString("en-GB")}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, valueColor = "text-white", subColor = "text-white/40" }: {
  label: string; value: string; sub?: string; valueColor?: string; subColor?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-white/40 uppercase tracking-widest mb-0.5">{label}</p>
      <p className={`text-lg font-bold font-mono ${valueColor}`}>{value}</p>
      {sub && <p className={`text-[11px] ${subColor}`}>{sub}</p>}
    </div>
  );
}
