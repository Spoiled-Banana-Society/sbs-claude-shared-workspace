'use client';

/**
 * Compact summary of the user's passes + recent draft activity.
 * Counters live in IdentityCard; this section focuses on the *drafts*
 * themselves — what they've joined, who's still in flight.
 */

import { isSectionFail } from '@/hooks/admin/useUserLookup';

interface Props {
  drafts: Record<string, unknown>[] | { ok: false; reason: string };
}

function fmtDate(v: unknown) {
  if (typeof v !== 'string' || !v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PassesDraftsSection({ drafts }: Props) {
  return (
    <Card>
      <Header>
        <span className="text-[10px] text-gray-500">Last {drafts && !isSectionFail(drafts) ? drafts.length : 0}</span>
      </Header>
      {isSectionFail(drafts) ? (
        <p className="mt-2 text-sm text-red-300">Drafts unavailable: {drafts.reason}</p>
      ) : drafts.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          No drafts found where this wallet is recorded as creator. (The page can&apos;t
          query participant arrays without a composite Firestore index — Phase 2 adds
          the per-participant query.)
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {drafts.slice(0, 10).map((d, i) => (
            <li
              key={String(d.id ?? i)}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-gray-800 bg-gray-950/40 px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium text-gray-100">
                {String(d.name ?? d.draftName ?? d.id ?? 'Draft')}
              </span>
              {typeof d.status === 'string' && d.status ? (
                <span className="rounded bg-gray-700/40 px-1.5 text-[10px] uppercase tracking-wider text-gray-300">
                  {d.status}
                </span>
              ) : null}
              {typeof d.entryFee === 'number' && d.entryFee > 0 ? (
                <span className="text-gray-500">${d.entryFee}</span>
              ) : null}
              <span className="ml-auto text-gray-500">
                {fmtDate(d.createdAt ?? d.created_at)}
              </span>
            </li>
          ))}
        </ul>
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
function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
        Drafts
      </h3>
      {children}
    </div>
  );
}
