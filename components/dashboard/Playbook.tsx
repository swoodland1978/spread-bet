"use client";

import { useStore } from "@/lib/store";

export default function Playbook() {
  const playbook = useStore(s => s.playbook);
  const playbookGeneratedAt = useStore(s => s.playbookGeneratedAt);
  const reviewCount = useStore(s => s.reviews.length);
  const generatePlaybook = useStore(s => s.generatePlaybook);

  return (
    <div className="flex flex-col gap-4">
      {/* Header + generate button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white">Strategy Playbook</h3>
          <p className="text-[10px] text-white/30 mt-0.5">
            AI-generated from {reviewCount} trade review{reviewCount !== 1 ? "s" : ""}.
            {playbookGeneratedAt && ` Last updated ${new Date(playbookGeneratedAt).toLocaleString("en-GB")}.`}
          </p>
          <p className="text-[10px] text-white/20 mt-1">
            This playbook is fed back into the AI on every trade review, creating a learning loop.
            The more trades we make, the smarter the reviews get.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={generatePlaybook} disabled={reviewCount === 0}
            className="text-[10px] text-white/50 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/30 transition-colors disabled:opacity-30">
            {playbook ? "↻ Regenerate" : "Generate"} Playbook
          </button>
          {playbook && (
            <button onClick={() => downloadPlaybook(playbook, playbookGeneratedAt)}
              className="text-[10px] text-emerald-400/70 hover:text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:border-emerald-500/40 transition-colors">
              ↓ Download .txt
            </button>
          )}
        </div>
      </div>

      {/* Playbook content */}
      {playbook ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <pre className="text-xs text-white/70 leading-relaxed whitespace-pre-wrap font-sans">{playbook}</pre>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-white/30 text-sm mb-2">No playbook yet.</p>
          <p className="text-white/20 text-xs">
            Complete a few trades, then hit &quot;Generate Playbook&quot; — the AI will analyse all your
            wins and losses and produce a strategy document with patterns, rules, and lessons.
          </p>
        </div>
      )}
    </div>
  );
}

function downloadPlaybook(playbook: string, generatedAt: string | null) {
  const header = `SPREADSIM STRATEGY PLAYBOOK
Generated: ${generatedAt ? new Date(generatedAt).toLocaleString("en-GB") : "unknown"}
Strategy: Mechanical mean reversion — fade >4% moves, +1% TP, -2% SL
${"=".repeat(60)}

`;
  const blob = new Blob([header + playbook], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spreadsim-playbook-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
