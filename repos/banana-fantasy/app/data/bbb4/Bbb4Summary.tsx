'use client';

import React, { useEffect, useState } from 'react';

type Summary = {
  generatedAt: string;
  teamCount: number;
  stats: {
    byQbCount: Record<string, { teams: number; allStacked: number }>;
    fourPlusQb: number;
    fourPlusQbAllStacked: number;
  };
};

/**
 * Live counts for the dataset page. One fetch on mount, no dependencies, no
 * retries — the page is fully usable without it (download buttons are static).
 */
export default function Bbb4Summary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/data/bbb4?format=summary')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Summary) => { if (!cancelled) setSummary(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;

  const fmt = (n: number) => n.toLocaleString('en-US');
  const qbRows = summary
    ? Object.entries(summary.stats.byQbCount)
        .map(([k, v]) => ({ qb: Number(k), ...v }))
        .filter((r) => r.qb > 0)
        .sort((a, b) => a.qb - b.qb)
    : [];

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Teams drafted" value={summary ? fmt(summary.teamCount) : '…'} />
        <Stat label="Teams with 4+ QBs" value={summary ? fmt(summary.stats.fourPlusQb) : '…'} />
        <Stat label="4+ QBs, every QB stacked" value={summary ? fmt(summary.stats.fourPlusQbAllStacked) : '…'} />
        <Stat
          label="Updated"
          value={summary ? new Date(summary.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '…'}
        />
      </div>

      {qbRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-text-secondary">
              <tr>
                <th className="px-4 py-2">QBs on roster</th>
                <th className="px-4 py-2">Teams</th>
                <th className="px-4 py-2">Every QB stacked with a WR or TE</th>
              </tr>
            </thead>
            <tbody>
              {qbRows.map((r) => (
                <tr key={r.qb} className="border-t border-white/5">
                  <td className="px-4 py-2 text-text-primary font-medium">{r.qb}</td>
                  <td className="px-4 py-2 text-text-secondary">{fmt(r.teams)}</td>
                  <td className="px-4 py-2 text-text-secondary">
                    {fmt(r.allStacked)}{' '}
                    <span className="text-white/40">({r.teams ? ((r.allStacked / r.teams) * 100).toFixed(1) : '0'}%)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-semibold text-text-primary tabular-nums">{value}</p>
    </div>
  );
}
