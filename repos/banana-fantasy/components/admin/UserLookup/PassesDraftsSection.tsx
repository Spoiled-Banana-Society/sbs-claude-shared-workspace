'use client';

/**
 * Drafts this user has actually played. Sourced from
 * v2_activity_events (draft_entered / draft_left / draft_won), folded
 * per-draftId in the user-lookup endpoint so each row carries its
 * latest status. Previous version queried v2_drafts.createdBy, which
 * always returned 0 because SBS doesn't write that doc shape — Boris
 * caught it: his wallet has 34 drafts but the card said "no drafts".
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

function draftTypeColor(t: unknown): string {
  const s = String(t ?? '').toLowerCase();
  if (s === 'jackpot') return 'text-red-300';
  if (s === 'hof') return 'text-[#D4AF37]';
  if (s === 'pro' || s === 'regular') return 'text-purple-300';
  return 'text-gray-400';
}

function statusPill(status: unknown): { label: string; cls: string } {
  const s = String(status ?? '').toLowerCase();
  if (s === 'won') return { label: 'WON', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' };
  if (s === 'left') return { label: 'LEFT', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' };
  return { label: 'ENTERED', cls: 'bg-blue-500/15 text-blue-300 ring-blue-500/30' };
}

export function PassesDraftsSection({ drafts }: Props) {
  const failed = isSectionFail(drafts);
  const list = failed ? [] : drafts;
  const total = list.length;
  const wins = list.filter((d) => String(d.status ?? '') === 'won').length;
  const lefts = list.filter((d) => String(d.status ?? '') === 'left').length;
  const totalWinningsUsd = list.reduce((sum, d) => {
    const v = Number(d.prizePaid);
    return Number.isFinite(v) ? sum + v : sum;
  }, 0);

  return (
    <Card>
      <Header>
        <span className="text-[11px] text-gray-400">
          {total.toLocaleString()} entered · {wins} won{totalWinningsUsd > 0 && ` · $${totalWinningsUsd.toLocaleString()}`}
        </span>
      </Header>

      {failed && (
        <p className="mt-2 text-sm text-red-300">Drafts unavailable: {(drafts as { reason: string }).reason}</p>
      )}

      {!failed && total === 0 && (
        <p className="mt-3 text-sm text-gray-500">
          No drafts entered yet.
        </p>
      )}

      {!failed && total > 0 && (
        <>
          {/* Quick stats row */}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label="Total entered" value={total} />
            <Stat label="Won" value={wins} accent={wins > 0 ? 'text-emerald-300' : undefined} />
            <Stat label="Left" value={lefts} accent={lefts > 0 ? 'text-amber-300' : undefined} />
            <Stat
              label="Winnings"
              value={`$${totalWinningsUsd.toLocaleString()}`}
              accent={totalWinningsUsd > 0 ? 'text-emerald-300' : undefined}
            />
          </dl>

          {/* Recent drafts table */}
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
              Recent · {Math.min(12, total)} of {total}
            </p>
            <ul className="space-y-1">
              {list.slice(0, 12).map((d, i) => {
                const id = String(d.id ?? `draft-${i}`);
                const pill = statusPill(d.status);
                const league = d.leagueNumber ? `#${d.leagueNumber}` : '';
                return (
                  <li
                    key={id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-xs"
                  >
                    <span className={`font-semibold ${draftTypeColor(d.draftType)}`}>
                      {String(d.draftType ?? 'PRO').toUpperCase()}
                    </span>
                    <span className="text-gray-300">{String(league || id.slice(0, 8))}</span>
                    {typeof d.draftSpeed === 'string' && d.draftSpeed && (
                      <span className="text-[10px] uppercase tracking-wider text-gray-500">
                        {d.draftSpeed}
                      </span>
                    )}
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider ring-1 ${pill.cls}`}>
                      {pill.label}
                    </span>
                    {typeof d.prizePaid === 'number' && d.prizePaid > 0 && (
                      <span className="text-emerald-300 tabular-nums">+${d.prizePaid}</span>
                    )}
                    <span className="ml-auto text-gray-500 text-[10px]">
                      {fmtDate(d.lastEventAt ?? d.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${accent ?? 'text-white'}`}>{value}</dd>
    </div>
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
