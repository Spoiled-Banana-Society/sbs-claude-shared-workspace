'use client';

/**
 * Dashboard — simple.
 *
 * Boris's spec (May 2026, "i just want it simple man"):
 *   How many [X] today and overall, where X is each of:
 *     · new users + logins
 *     · drafts entered
 *     · mints (paid passes)
 *     · spins
 *     · promos
 *     · specific prizes won on the wheel
 *
 * Each domain = one box. Each row inside a box = one metric with two
 * right-aligned columns: TODAY and TOTAL. That's the whole pattern.
 * Hairline dividers between rows. No graphs, no bars, no sparklines.
 *
 * Every number is live (polled by react-query at 10–60s intervals).
 * The Vercel build, Firestore reads, and dashboard renderer all share
 * the same data — what you see is what's actually in production.
 */

import React from 'react';
import Link from 'next/link';
import {
  useAdminMetrics,
  useRecentErrors,
  useHeaviestUsers,
  usePromoProgress,
  type ErrorEventEntry,
  type MetricsResponse,
  type PromoProgressResponse,
  AdminApiError,
} from '@/hooks/admin/useAdminApi';
import { WalletLink } from '@/components/admin/WalletLink';
import { GlobalSearch } from '@/components/admin/TopBar/GlobalSearch';
import { UsersTableBox } from '@/components/admin/Dashboard/UsersTableBox';
import { explainError } from '@/lib/logSources';
import { VISIBLE_PROMO_TYPES_ORDER } from '@/lib/promoFilter';

/* ─────────────────────────────────────────────────────────  Page  */

export function DashboardPanel({ enabled }: { enabled: boolean }) {
  const metricsQ = useAdminMetrics(enabled);
  const errorsQ = useRecentErrors(enabled);
  const heaviestQ = useHeaviestUsers(enabled);
  const promoProgressQ = usePromoProgress(enabled);
  const m = metricsQ.data;

  const health = computeHealth(errorsQ.data?.errors, m?.withdrawals.pending);
  const ageSec = m?.generatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(m.generatedAt).getTime()) / 1000))
    : null;

  return (
    <div className="space-y-4">
      <HealthBar
        health={health}
        ageSec={ageSec}
        fetching={metricsQ.isFetching}
        onRefresh={() => metricsQ.refetch()}
      />

      {metricsQ.isError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/[0.06] px-5 py-4 text-sm text-red-200">
          {(metricsQ.error as AdminApiError)?.message || 'Failed to load metrics'}
        </div>
      )}

      {/* Search bar — Boris's ask: 'you also took away the thing where
          we can search all the different things in the dashboard'. */}
      <GlobalSearch enabled={enabled} />

      {m && (
        <>
          {/* TOP — 3 small boxes: Users · Drafts · Mints */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <UsersBox m={m} />
            <DraftsBox m={m} />
            <MintsBox m={m} />
          </div>

          {/* BOTTOM — Promos · Spins+Wheel (combined per Boris) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PromosBox m={m} progress={promoProgressQ.data} />
            <SpinsAndWheelBox m={m} />
          </div>
        </>
      )}

      {/* Footer: top users + errors (smaller secondary panels) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopUsersBox q={heaviestQ.data} loading={heaviestQ.isLoading} />
        <ErrorsBox errors={errorsQ.data?.errors ?? []} loading={errorsQ.isLoading} />
      </div>

      {/* Every-user database. Filterable, sortable, paginated. Boris's
          ask: "this is how many users we have these are all the users
          let me filter to see oh ok heres the users who drafted a lot
          but never completed or done a promo." */}
      <UsersTableBox enabled={enabled} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────  Primitives  */

function Box({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * The one table pattern used inside every box. Three columns: Metric ·
 * Today · Total. Right-aligned numerics, tabular-nums, hairline
 * dividers. Optional sub-line per row. Optional row accent.
 */
function StatTable({
  rows,
}: {
  rows: Array<{
    label: string;
    sub?: string;
    today?: string | number;
    total?: string | number;
    accent?: string;
    dim?: boolean;
  }>;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
        <tr>
          <th className="px-5 pt-3 pb-1.5 text-left font-medium">Metric</th>
          <th className="pt-3 pb-1.5 text-right font-medium">Today</th>
          <th className="px-5 pt-3 pb-1.5 text-right font-medium">Total</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r) => {
          const todayHasValue = r.today !== undefined && r.today !== '' && r.today !== '—';
          const totalHasValue = r.total !== undefined && r.total !== '' && r.total !== '—';
          return (
            <tr key={r.label} className="border-t border-white/[0.06]">
              <td className="px-5 py-2 align-top">
                <p className={`text-sm ${r.dim ? 'text-gray-500' : (r.accent ?? 'text-gray-200')}`}>
                  {r.label}
                </p>
                {r.sub && <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{r.sub}</p>}
              </td>
              <td className={`py-2 text-right ${todayHasValue ? (r.dim ? 'text-gray-500' : 'text-white') : 'text-gray-600'}`}>
                {r.today ?? '—'}
              </td>
              <td className={`px-5 py-2 text-right ${totalHasValue ? (r.dim ? 'text-gray-500' : 'text-gray-200') : 'text-gray-600'}`}>
                {r.total ?? '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────  Boxes  */

function UsersBox({ m }: { m: MetricsResponse }) {
  const retention = m.users.total > 0 ? (m.lifetime.logins / m.users.total).toFixed(1) : '0';
  return (
    <Box title="Users">
      <StatTable
        rows={[
          { label: 'New users', today: m.users.newToday, total: m.users.total, sub: `+${m.users.newThisWeek} this week` },
          { label: 'Logins', today: m.engagement.loginsToday, total: m.lifetime.logins, sub: `${m.engagement.loginsThisWeek} this week · ${retention}× per user`, accent: 'text-blue-300' },
        ]}
      />
    </Box>
  );
}

function DraftsBox({ m }: { m: MetricsResponse }) {
  return (
    <Box title="Drafts">
      <StatTable
        rows={[
          { label: 'Drafts entered', today: m.draftsEnteredToday, total: m.draftsEnteredTotal, sub: 'every join — JP / HOF / Pro', accent: 'text-amber-300' },
        ]}
      />
    </Box>
  );
}

function MintsBox({ m }: { m: MetricsResponse }) {
  return (
    <Box title="Mints (paid passes)">
      <StatTable
        rows={[
          { label: 'Passes purchased', today: '—', total: m.lifetime.passesPurchased, sub: 'card + USDC', accent: 'text-emerald-300' },
          { label: 'Revenue', today: `$${m.revenueTodayUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, total: `$${m.totalRevenueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: 'sum of pass-purchase prices', accent: 'text-emerald-300' },
        ]}
      />
    </Box>
  );
}

// Promo label overrides — the canonical set comes from lib/promoFilter
// (VISIBLE_PROMO_TYPES_ORDER), and these are just nicer display names
// than the kebab-case keys.
const PROMO_LABEL: Record<string, string> = {
  'new-user': 'New user',
  'mint': 'Mint (buy 10)',
  'daily-drafts': 'Daily drafts',
  'pick-10': 'Pick 10',
  'jackpot': 'Jackpot',
  'referral': 'Referral',
  'founder-draft': 'Founder draft',
};

function PromosBox({ m, progress }: { m: MetricsResponse; progress?: PromoProgressResponse }) {
  // Source of truth: lib/promoFilter.VISIBLE_PROMO_TYPES_ORDER — the
  // exact same 6 the /promos page renders. Avoids drift between the
  // admin view and what the user sees ("Boris is showing me promos
  // that aren't live").
  const liveKeys = VISIBLE_PROMO_TYPES_ORDER as readonly string[];

  const perType = progress?.perType ?? {};

  // Build rows for each live promo, then sort by lifetime claims desc
  // so the most-popular one tops the list. Boris's ask: "which ones
  // are the most popular to the least ones."
  const liveRows = liveKeys.map((key) => {
    const claims = m.promoBreakdown[key] ?? { claimsToday: 0, claimsTotal: 0 };
    const prog = perType[key] ?? { started: 0, completed: 0, pending: 0, conversionRate: 0 };
    return {
      key,
      label: PROMO_LABEL[key] ?? key.replace(/-/g, ' '),
      today: claims.claimsToday,
      total: claims.claimsTotal,
      // For single-step promos (claim button only), 'started' equals
      // 'completed'. For multi-step (like daily-drafts, pick-10), this
      // is "did at least one step but hasn't claimed reward yet."
      inProgress: Math.max(0, prog.started - prog.completed),
    };
  }).sort((a, b) => b.total - a.total);

  // Note: there's no "Other / internal" rollup. Boris's explicit
  // direction is that ONLY the six live promos (lib/promoFilter
  // .VISIBLE_PROMO_TYPES_ORDER) ever appear here — internal/legacy
  // promo types like "buy-bonus" are filtered out at the render layer.
  // If we ever need to debug a legacy type, query metrics JSON directly
  // (`.promoBreakdown`) — it still includes every type seen.

  const stalePending = progress?.stalePending ?? [];

  return (
    <Box
      title="Promos"
      sub={`${m.promos.promoClaimsToday} today · ${m.lifetime.promosClaimed} lifetime`}
    >
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
          <tr>
            <th className="px-5 pt-3 pb-1.5 text-left font-medium">Promo</th>
            <th className="pt-3 pb-1.5 text-right font-medium">Today</th>
            <th className="pt-3 pb-1.5 text-right font-medium">Total</th>
            <th className="px-5 pt-3 pb-1.5 text-right font-medium">In&nbsp;progress</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {liveRows.map((r) => {
            const dim = r.total === 0 && r.inProgress === 0;
            return (
              <tr key={r.key} className="border-t border-white/[0.06]">
                <td className={`px-5 py-2 capitalize ${dim ? 'text-gray-500' : 'text-white'}`}>{r.label}</td>
                <td className={`py-2 text-right ${r.today > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{r.today.toLocaleString()}</td>
                <td className={`py-2 text-right ${r.total > 0 ? 'text-pink-300' : 'text-gray-600'}`}>{r.total.toLocaleString()}</td>
                <td className={`px-5 py-2 text-right ${r.inProgress > 0 ? 'text-amber-300' : 'text-gray-600'}`} title="Users who started a multi-step promo but haven't claimed the reward yet">{r.inProgress.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Stale starters — users who started a multi-step promo and stopped.
          Top 5 with clickable wallets so Boris can DM them directly. */}
      {stalePending.length > 0 && (
        <div className="border-t border-white/[0.06] px-5 py-3 bg-amber-500/[0.03]">
          <p className="text-[10px] uppercase tracking-[0.1em] text-amber-300/80 mb-2">
            Stale starters · 48h+ no progress
          </p>
          <ul className="space-y-1">
            {stalePending.slice(0, 5).map((p) => (
              <li
                key={`${p.wallet}-${p.promoId}`}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <WalletLink wallet={p.wallet} bare className="!text-[11px] !text-gray-300 hover:!text-banana" />
                <span className="text-[11px] text-gray-400 capitalize">
                  {p.promoType.replace(/-/g, ' ')} · {p.progress}/{p.progressMax}
                </span>
                <span className="text-[10px] text-amber-300 tabular-nums shrink-0">
                  {p.hoursStale !== null ? `${p.hoursStale}h` : '—'}
                </span>
              </li>
            ))}
          </ul>
          {stalePending.length > 5 && (
            <p className="mt-1.5 text-[10px] text-gray-500">+{stalePending.length - 5} more</p>
          )}
        </div>
      )}
    </Box>
  );
}

// Canonical wheel prizes Boris wants on the dashboard. NO "Unknown",
// no "Nothing" — only the 6 prize types from wheelConfig (1/5/10/20
// drafts + JP + HOF). If a prize ever appears outside this list, it
// means a bad spin doc was written and should be investigated, but
// the dashboard ignores it to stay clean.
const CANONICAL_PRIZES = [
  '1 free draft',
  '5 free drafts',
  '10 free drafts',
  '20 free drafts',
  'Jackpot entry',
  'HOF entry',
] as const;

function SpinsAndWheelBox({ m }: { m: MetricsResponse }) {
  const prizeRows = CANONICAL_PRIZES.map((label) => ({
    label,
    counts: m.wheelPrizeBreakdown[label] ?? { today: 0, total: 0 },
  }));
  const prizeTotal = prizeRows.reduce((s, r) => s + r.counts.total, 0);
  // The gap between the count() headline total and the sum of canonical
  // prize buckets is real spin docs with a legacy / unrecognized shape
  // (Boris caught the original "424 total but 169 in breakdown" gap).
  // Surface it explicitly so the breakdown ALWAYS adds up to the
  // headline — no silent missing rows.
  const legacyCount = m.wheelPrizeBreakdown['Legacy / unknown']?.total ?? 0;
  const legacyToday = m.wheelPrizeBreakdown['Legacy / unknown']?.today ?? 0;
  const denomTotal = prizeTotal + legacyCount;
  const accentFor = (label: string) =>
    /jackpot/i.test(label) ? 'text-red-300'
    : /hof/i.test(label) ? 'text-[#D4AF37]'
    : 'text-purple-300';

  return (
    <Box title="Spins" sub={m.wheel.totalSpins > 0 ? `${m.wheel.totalSpins.toLocaleString()} lifetime spins` : 'no spins yet'}>
      {/* Headline row: total wheel spins. */}
      <StatTable
        rows={[
          { label: 'Wheel spins', today: m.wheel.spinsToday, total: m.wheel.totalSpins, accent: 'text-[#F3E216]' },
        ]}
      />
      {/* Per-prize breakdown — every canonical wheel prize, even 0s. */}
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
          <tr>
            <th className="px-5 pt-3 pb-1.5 text-left font-medium border-t border-white/[0.06]">Prize</th>
            <th className="pt-3 pb-1.5 text-right font-medium border-t border-white/[0.06]">Today</th>
            <th className="pt-3 pb-1.5 text-right font-medium border-t border-white/[0.06]">Total</th>
            <th className="px-5 pt-3 pb-1.5 text-right font-medium border-t border-white/[0.06]">Share</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {prizeRows.map(({ label, counts: c }) => {
            const dim = c.total === 0;
            return (
              <tr key={label} className="border-t border-white/[0.06]">
                <td className={`px-5 py-2 ${dim ? 'text-gray-500' : accentFor(label)}`}>{label}</td>
                <td className={`py-2 text-right ${c.today > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{c.today.toLocaleString()}</td>
                <td className={`py-2 text-right ${dim ? 'text-gray-600' : 'text-gray-200'}`}>{c.total.toLocaleString()}</td>
                <td className={`px-5 py-2 text-right text-[11px] ${dim ? 'text-gray-600' : 'text-gray-500'}`}>{denomTotal > 0 ? `${((c.total / denomTotal) * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            );
          })}
          {legacyCount > 0 && (
            <tr className="border-t border-white/[0.06]" title="Spins recorded under a legacy doc shape (no `prize.type/value` field). Counted in the headline total but unattributable to a specific prize.">
              <td className="px-5 py-2 text-gray-500 italic">Legacy / unknown</td>
              <td className={`py-2 text-right ${legacyToday > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{legacyToday.toLocaleString()}</td>
              <td className="py-2 text-right text-gray-300">{legacyCount.toLocaleString()}</td>
              <td className="px-5 py-2 text-right text-[11px] text-gray-500">{denomTotal > 0 ? `${((legacyCount / denomTotal) * 100).toFixed(1)}%` : '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Box>
  );
}

/* ─────────────────────────────────────────────────────────  Footer  */

function TopUsersBox({
  q,
  loading,
}: {
  q: import('@/hooks/admin/useAdminApi').HeaviestUsersResponse | undefined;
  loading: boolean;
}) {
  return (
    <Box
      title="Top users"
      sub={<Link href="/admin?tab=users" className="hover:text-white">all users →</Link>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
        <Leaderboard
          title="By spend"
          loading={loading}
          entries={q?.topSpend ?? []}
          format={(e) => `$${Math.round(e.spendUsd).toLocaleString()}`}
          accent="text-emerald-300"
        />
        <Leaderboard
          title="By free drafts"
          loading={loading}
          entries={(q?.topFreeDrafts ?? []).filter((e) => e.freeDraftsWon > 0)}
          format={(e) => e.freeDraftsWon.toLocaleString()}
          accent="text-purple-300"
        />
        <Leaderboard
          title="By promos"
          loading={loading}
          entries={(q?.topPromos ?? []).filter((e) => e.promosClaimed > 0)}
          format={(e) => e.promosClaimed.toLocaleString()}
          accent="text-pink-300"
        />
      </div>
    </Box>
  );
}

function Leaderboard({
  title, loading, entries, format, accent,
}: {
  title: string;
  loading: boolean;
  entries: import('@/hooks/admin/useAdminApi').HeaviestUserEntry[];
  format: (e: import('@/hooks/admin/useAdminApi').HeaviestUserEntry) => string;
  accent: string;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500 mb-2">{title}</p>
      {loading ? (
        <p className="text-[11px] text-gray-500 py-1">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-[11px] text-gray-500 py-1">No data.</p>
      ) : (
        <ul>
          {entries.slice(0, 5).map((e, i) => (
            <li key={e.userId} className="flex items-center justify-between gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[10px] text-gray-500 tabular-nums w-3 shrink-0">{i + 1}</span>
                <div className="min-w-0">
                  {e.username && <p className="text-xs text-white truncate leading-tight">{e.username}</p>}
                  <WalletLink wallet={e.userId} bare className="!text-[10px] !text-gray-500 hover:!text-banana" />
                </div>
              </div>
              <p className={`text-sm font-semibold tabular-nums ${accent} shrink-0`}>{format(e)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorsBox({ errors, loading }: { errors: ErrorEventEntry[]; loading: boolean }) {
  const oneDayAgo = Date.now() - 86_400_000;
  const recent = errors.filter((e) => new Date(e.timestamp).getTime() > oneDayAgo);
  const counts = new Map<string, { count: number; latest: ErrorEventEntry; affected: Set<string> }>();
  for (const e of recent) {
    const existing = counts.get(e.source);
    const actor = (e.actor || '').toLowerCase();
    if (existing) {
      existing.count += 1;
      if (actor) existing.affected.add(actor);
      if (new Date(e.timestamp) > new Date(existing.latest.timestamp)) existing.latest = e;
    } else {
      counts.set(e.source, { count: 1, latest: e, affected: actor ? new Set([actor]) : new Set<string>() });
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);

  return (
    <Box
      title="Errors · last 24h"
      sub={<Link href="/admin?tab=logs" className="hover:text-white">all logs →</Link>}
    >
      <div className="divide-y divide-white/[0.04] max-h-[280px] overflow-y-auto">
        {loading ? (
          <p className="px-5 py-6 text-center text-xs text-gray-500">Loading…</p>
        ) : top.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-gray-500">Quiet day.</p>
        ) : (
          top.map(([source, { count, latest, affected }]) => {
            const wallets = Array.from(affected);
            const shown = wallets.slice(0, 3);
            const extra = wallets.length - shown.length;
            return (
              <div key={source} className="px-5 py-2 hover:bg-white/[0.02]">
                <Link href={`/admin?tab=logs&source=${encodeURIComponent(source)}`} className="block">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-mono text-amber-300 truncate">{source}</span>
                    <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{count}× · {wallets.length}u</span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate leading-snug">
                    {explainError(source, latest.message) || latest.message}
                  </p>
                </Link>
                {shown.length > 0 && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {shown.map((w) => (
                      <WalletLink key={w} wallet={w} bare className="!text-[10px] !text-gray-400 hover:!text-banana" />
                    ))}
                    {extra > 0 && <span className="text-[10px] text-gray-500">+{extra}</span>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Box>
  );
}

/* ─────────────────────────────────────────────────────────  Health  */

interface HealthState {
  level: 'ok' | 'warn' | 'critical';
  reason: string;
}

function computeHealth(errors: ErrorEventEntry[] | undefined, pendingWithdrawals: number | undefined): HealthState {
  const list = errors ?? [];
  const oneHourAgo = Date.now() - 3_600_000;
  const recent = list.filter((e) => new Date(e.timestamp).getTime() > oneHourAgo);
  const criticalRecent = recent.filter((e) => /critical|fatal|crash|panic/i.test(e.source) || /critical|crash/i.test(e.message));
  const lowRecent = recent.filter((e) => /watchdog|prefs|rtdb/i.test(e.source));
  const warnRecent = recent.filter((e) => !lowRecent.includes(e) && !criticalRecent.includes(e));

  if (criticalRecent.length > 0) {
    return { level: 'critical', reason: `${criticalRecent.length} critical error${criticalRecent.length === 1 ? '' : 's'} in the last hour` };
  }
  if ((pendingWithdrawals ?? 0) > 20) {
    return { level: 'critical', reason: `${pendingWithdrawals} pending withdrawals — Gnosis Safe batch overdue` };
  }
  if (warnRecent.length > 3) {
    return { level: 'warn', reason: `${warnRecent.length} warnings in the last hour` };
  }
  if ((pendingWithdrawals ?? 0) >= 5) {
    return { level: 'warn', reason: `${pendingWithdrawals} pending withdrawals waiting on approval` };
  }
  if (warnRecent.length > 0 || lowRecent.length > 5) {
    return { level: 'warn', reason: `${recent.length} error${recent.length === 1 ? '' : 's'} in the last hour` };
  }
  return { level: 'ok', reason: 'No critical issues — quiet hour' };
}

function HealthBar({
  health, ageSec, fetching, onRefresh,
}: {
  health: HealthState; ageSec: number | null; fetching: boolean; onRefresh: () => void;
}) {
  const palette = {
    ok: { dot: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.04]', label: 'Healthy' },
    warn: { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-500/30', bg: 'bg-amber-500/[0.05]', label: 'Needs a look' },
    critical: { dot: 'bg-red-400', text: 'text-red-300', border: 'border-red-500/40', bg: 'bg-red-500/[0.06]', label: 'Attention required' },
  }[health.level];
  return (
    <div className={`rounded-2xl border ${palette.border} ${palette.bg} px-5 py-3 flex items-center justify-between gap-4`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className={`inline-block w-2 h-2 rounded-full ${palette.dot} ${health.level !== 'ok' ? 'animate-pulse' : ''}`} />
        <span className={`text-sm font-semibold ${palette.text}`}>{palette.label}</span>
        <span className="text-sm text-gray-400 truncate">{health.reason}</span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-gray-500 shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${fetching ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
          {fetching ? 'refreshing…' : ageSec !== null ? `live · ${ageSec}s · auto 10s` : 'loading…'}
        </span>
        <button onClick={onRefresh} className="text-gray-400 hover:text-white" title="Refresh now">↻</button>
      </div>
    </div>
  );
}
