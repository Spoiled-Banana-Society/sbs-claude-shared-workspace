'use client';

/**
 * Errors filtered by `actor == wallet` from v2_error_events. Grouped by
 * source so frequency is obvious; click into the dedicated Logs tab for
 * full context including stack traces + breadcrumbs.
 */

import { useState } from 'react';
import Link from 'next/link';
import { isSectionFail } from '@/hooks/admin/useUserLookup';
import { explainError } from '@/lib/logSources';

function fmtAgo(v: unknown): string {
  if (typeof v !== 'string' || !v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

interface ErrorGroup {
  source: string;
  count: number;
  latest: string | null;
  message: string;
}

function groupBySource(rows: Record<string, unknown>[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const source = String(r.source ?? 'unknown');
    const message = typeof r.message === 'string' ? r.message : '';
    const timestamp = typeof r.timestamp === 'string' ? r.timestamp : null;
    const existing = map.get(source);
    if (existing) {
      existing.count += 1;
      if (
        timestamp &&
        (!existing.latest || timestamp > existing.latest)
      ) {
        existing.latest = timestamp;
        if (message) existing.message = message;
      }
    } else {
      map.set(source, { source, count: 1, latest: timestamp, message });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.latest ?? '').localeCompare(a.latest ?? ''),
  );
}

interface Props {
  errors: Record<string, unknown>[] | { ok: false; reason: string };
  wallet: string;
}

export function ErrorsSection({ errors, wallet }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Errors{' '}
          <span className="font-normal opacity-60">(last 7 days)</span>
        </h3>
        <Link
          href={`/admin?tab=logs&actor=${encodeURIComponent(wallet)}`}
          className="text-[11px] text-gray-400 hover:text-[#F3E216]"
        >
          Open in Logs →
        </Link>
      </div>

      {isSectionFail(errors) ? (
        <p className="mt-2 text-sm text-red-300">Errors unavailable: {errors.reason}</p>
      ) : errors.length === 0 ? (
        <p className="mt-2 text-sm text-emerald-300/90">
          ✅ No errors recorded for this wallet in the last 7 days.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {groupBySource(errors)
              .slice(0, expanded ? undefined : 5)
              .map((g) => {
                const expl = explainError(g.source, g.message);
                return (
                  <li
                    key={g.source}
                    className="rounded-md border border-red-500/20 bg-red-500/[0.04] p-2.5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <code className="font-mono text-[11px] text-red-200">{g.source}</code>
                      <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-semibold text-red-200">
                        ×{g.count}
                      </span>
                      <span className="ml-auto text-[10px] text-gray-500">
                        {fmtAgo(g.latest)}
                      </span>
                    </div>
                    {expl && (
                      <p className="mt-1 text-[12px] text-gray-300">{expl}</p>
                    )}
                    {!expl && g.message && (
                      <p className="mt-1 truncate text-[11px] text-gray-400" title={g.message}>
                        {g.message}
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>

          {groupBySource(errors).length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[11px] text-gray-400 hover:text-[#F3E216]"
            >
              {expanded
                ? 'Show less'
                : `Show all ${groupBySource(errors).length} error types →`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {children}
    </section>
  );
}
