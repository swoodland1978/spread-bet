"use client";

import type { StockQuote } from "@/lib/types";
import { useStore } from "@/lib/store";
import { TRIGGER_PCT } from "@/lib/stocks";

interface Props {
  quote: StockQuote;
  onAnalyse: (quote: StockQuote) => void;
}

export default function StockCard({ quote, onAnalyse }: Props) {
  const analysing = useStore(s => s.analysing.has(quote.symbol));
  const openPositions = useStore(s => s.positions.filter(p => p.symbol === quote.symbol && p.status === "open"));
  const triggered = Math.abs(quote.changePercent) >= TRIGGER_PCT;
  const up = quote.changePercent >= 0;

  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-1.5 transition-colors ${triggered ? "border-yellow-500/60 bg-yellow-500/5" : "border-white/10 bg-white/5"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-white">{quote.symbol}</p>
          <p className="text-[10px] text-white/50 truncate max-w-[80px]">{quote.name}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-mono font-semibold text-white">${quote.price.toFixed(2)}</p>
          <p className={`text-xs font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
            {up ? "▲" : "▼"} {Math.abs(quote.changePercent).toFixed(2)}%
          </p>
        </div>
      </div>

      {openPositions.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {openPositions.map(p => (
            <span key={p.id} className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${p.pnl >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
              {p.direction} {p.pnl >= 0 ? "+" : ""}£{p.pnl.toFixed(0)}
            </span>
          ))}
        </div>
      )}

      {triggered && (
        <button
          onClick={() => onAnalyse(quote)}
          disabled={analysing}
          className="mt-0.5 w-full py-1 rounded-lg text-[10px] font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
        >
          {analysing ? "Analysing…" : `🤖 Analyse ${quote.changePercent > 0 ? "▲" : "▼"}${Math.abs(quote.changePercent).toFixed(1)}%`}
        </button>
      )}
    </div>
  );
}
