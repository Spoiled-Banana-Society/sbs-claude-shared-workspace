'use client';

/**
 * Dashboard — 4 domain boxes, one screen.
 *
 * Boris's spec (May 2026, third consolidation): "much better than this.
 * way too long of a page. i dont want to scroll. boxes that put certain
 * things together. easily decipher between today vs total. minimalistic,
 * smart, made for two founders to digest fast."
 *
 * LAYOUT (fits 1440×900 with minimal scroll):
 *
 *   [ Health bar — 1 line ]
 *
 *   ┌─── USERS ────────┬─── WHEEL ──────────┐
 *   │ signups, logins  │ spins, JP/HOF hits  │
 *   │ retention,       │ wins by prize,      │
 *   │ signup rails     │ JP/HOF draft        │
 *   │                  │ pipeline            │
 *   ├─── PROMOS ───────┼─── MONEY ──────────┤
 *   │ today + lifetime │ free vs paid passes │
 *   │ all 12 promos    │ withdrawals:        │
 *   │ stale starters   │ pending + aging     │
 *   └──────────────────┴─────────────────────┘
 *
 *   [ TOP USERS · ERRORS · LIVE ACTIVITY  — 3-col on xl ]
 *
 * Each domain box is a self-contained Card with a consistent internal
 * structure: title row → "Today / Total" mini-table → optional inline
 * subsection (rails, prizes, all-promos, aging). Today and Total are
 * always in two right-aligned columns so they read at a glance.
 */

import Link from 'next/link';
import {
  useAdminMetrics,
  useRecentErrors,
  usePromoProgress,
  useAdminWithdrawals,
  useHeaviestUsers,
  type ErrorEventEntry,
  type MetricsResponse,
  type PromoProgressResponse,
  type HeaviestUserEntry,
  type AdminWithdrawalItem,
  AdminApiError,
} from '@/hooks/admin/useAdminApi';
import { LiveActivity } from '@/components/admin/LiveActivity';
import { WalletLink } from '@/components/admin/WalletLink';
import { explainError } from '@/lib/logSources';

/* ─────────────────────────────────────────────────────────  Page  */

export function DashboardPanel({ enabled }: { enabled: boolean }) {
  const metricsQ = useAdminMetrics(enabled);
  const errorsQ = useRecentErrors(enabled);
  const promoQ = usePromoProgress(enabled);
  const withdrawalsQ = useAdminWithdrawals(enabled);
  const heaviestQ = useHeaviestUsers(enabled);
  const m = metricsQ.data;
  const errors = errorsQ.data?.errors ?? [];

  const health = computeHealth(errors, m?.withdrawals.pending);
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

      {/* MAIN 2x2: every primary domain in one self-contained box. */}
      {m && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <UsersBox m={m} />
          <WheelBox m={m} />
          <PromosBox m={m} progress={promoQ.data} />
          <MoneyBox m={m} withdrawals={withdrawalsQ.data ?? []} />
        </div>
      )}

      {/* SECONDARY 3-col: top users · errors · live activity. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <TopUsersBox data={heaviestQ.data?.topSpend} loading={heaviestQ.isLoading} />
        <RecentErrorsBox errors={errors} loading={errorsQ.isLoading} />
        <LiveActivityBox enabled={enabled} />
      </div>
    </div>
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

function HealthBar({ health, ageSec, fetching, onRefresh }: {
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

/* ─────────────────────────────────────────────────────────  Domain primitives  */

/**
 * One domain box. Title at top, optional sub-line, body fills the rest.
 * Same height across the 2x2 grid via `h-full` so the layout stays clean.
 */
function DomainBox({ title, sub, accent, children }: {
  title: string;
  sub?: React.ReactNode;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full rounded-2xl border border-white/[0.06] bg-white/[0.02] flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-white/[0.06] flex items-baseline justify-between gap-2">
        <h3 className={`text-sm font-semibold ${accent ?? 'text-white'}`}>{title}</h3>
        {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/**
 * Today / Total mini-table. Right-aligned numeric columns; rows have
 * hairline dividers. The two columns make the today-vs-total distinction
 * obvious without extra label noise.
 */
function TodayTotalTable({ rows }: {
  rows: Array<{ label: string; today?: string | number; total?: string | number; accent?: string; sub?: string }>;
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
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-white/[0.06]">
            <td className="px-5 py-2 align-top">
              <p className={`text-sm ${r.accent ?? 'text-gray-200'}`}>{r.label}</p>
              {r.sub && <p className="text-[10px] text-gray-500 leading-tight">{r.sub}</p>}
            </td>
            <td className={`py-2 text-right ${r.today !== undefined && r.today !== '—' ? 'text-white' : 'text-gray-600'}`}>
              {r.today ?? '—'}
            </td>
            <td className={`px-5 py-2 text-right ${r.total !== undefined && r.total !== '—' ? 'text-gray-200' : 'text-gray-600'}`}>
              {r.total ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Small inline subsection inside a domain box. Title + content with
 * its own top divider so it sits inside the parent box neatly.
 */
function Inline({ title, sub, children }: {
  title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="border-t border-white/[0.06]">
      <div className="px-5 pt-3 pb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{title}</p>
        {sub && <p className="text-[10px] text-gray-600">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────  USERS box  */

function UsersBox({ m }: { m: MetricsResponse }) {
  const retention = m.users.total > 0 ? (m.lifetime.logins / m.users.total).toFixed(1) : '0';
  const rails: { key: keyof MetricsResponse['users']['byWalletType']; label: string }[] = [
    { key: 'privy_embedded', label: 'Social (Gmail / X)' },
    { key: 'privy_external', label: 'Privy + external wallet' },
    { key: 'external_connect', label: 'Crypto wallet direct' },
    { key: 'unknown', label: 'Unknown (pre-tracking)' },
  ];
  const total = m.users.total;
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—');

  return (
    <DomainBox title="Users">
      <TodayTotalTable
        rows={[
          { label: 'New signups', today: m.users.newToday, total: m.users.total, sub: `${m.users.newThisWeek} this week` },
          { label: 'Logins', today: m.engagement.loginsToday, total: m.lifetime.logins, sub: `${m.engagement.loginsThisWeek} this week`, accent: 'text-blue-300' },
          { label: 'Logins per user', total: `${retention}×`, sub: 'lifetime ÷ total users — retention proxy' },
        ]}
      />
      <Inline title="Signup rails" sub={`${total.toLocaleString()} users`}>
        <table className="w-full text-sm">
          <tbody className="tabular-nums">
            {rails.map((r) => {
              const count = m.users.byWalletType[r.key];
              const dim = count === 0;
              return (
                <tr key={r.key} className="border-t border-white/[0.04]">
                  <td className={`px-5 py-1.5 ${dim ? 'text-gray-500' : 'text-gray-200'}`}>{r.label}</td>
                  <td className={`py-1.5 text-right ${dim ? 'text-gray-600' : 'text-white'}`}>{count.toLocaleString()}</td>
                  <td className={`px-5 py-1.5 text-right text-[11px] ${dim ? 'text-gray-600' : 'text-gray-500'}`}>{pct(count)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Inline>
    </DomainBox>
  );
}

/* ─────────────────────────────────────────────────────────  WHEEL box  */

function WheelBox({ m }: { m: MetricsResponse }) {
  const prizeRows = Object.entries(m.wheelPrizeBreakdown).sort((a, b) => b[1] - a[1]);
  const prizeTotal = prizeRows.reduce((s, [, n]) => s + n, 0);
  const accentFor = (label: string) =>
    /jackpot/i.test(label) ? 'text-red-300'
    : /hof/i.test(label) ? 'text-[#D4AF37]'
    : /nothing/i.test(label) ? 'text-gray-400'
    : 'text-purple-300';

  return (
    <DomainBox title="Wheel" accent="text-[#F3E216]">
      <TodayTotalTable
        rows={[
          { label: 'Spins', today: m.wheel.spinsToday, total: m.wheel.totalSpins, accent: 'text-[#F3E216]' },
          { label: 'Jackpot hits', total: m.lifetime.jackpotWins, sub: '1% odds · created ' + m.wheelDrafts.jackpot.total + ' JP draft' + (m.wheelDrafts.jackpot.total === 1 ? '' : 's'), accent: 'text-red-300' },
          { label: 'HOF hits', total: m.lifetime.hofWins, sub: '5% odds · created ' + m.wheelDrafts.hof.total + ' HOF draft' + (m.wheelDrafts.hof.total === 1 ? '' : 's'), accent: 'text-[#D4AF37]' },
          { label: 'Free drafts given', total: m.totalFreeDraftsFromWheel, sub: 'sum of prize values across draft-pass spins', accent: 'text-purple-300' },
        ]}
      />

      <Inline title="Wins by prize" sub={prizeTotal > 0 ? `last ${prizeTotal.toLocaleString()} spins` : 'no spins yet'}>
        <table className="w-full text-sm">
          <tbody className="tabular-nums">
            {prizeRows.length === 0 ? (
              <tr>
                <td className="px-5 py-3 text-center text-[11px] text-gray-500">No spin data yet.</td>
              </tr>
            ) : (
              prizeRows.map(([label, count]) => (
                <tr key={label} className="border-t border-white/[0.04]">
                  <td className={`px-5 py-1.5 ${accentFor(label)} capitalize`}>{label}</td>
                  <td className="py-1.5 text-right text-gray-200">{count.toLocaleString()}</td>
                  <td className="px-5 py-1.5 text-right text-[11px] text-gray-500">{prizeTotal > 0 ? `${((count / prizeTotal) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Inline>

      <Inline title="JP / HOF draft pipeline" sub="wheel-won only">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-5 pt-2 pb-1 text-left font-medium">Type</th>
              <th className="pt-2 pb-1 text-right font-medium">Filling</th>
              <th className="pt-2 pb-1 text-right font-medium">Drafting</th>
              <th className="pt-2 pb-1 text-right font-medium">Done</th>
              <th className="pt-2 pb-1 text-right font-medium">Total</th>
              <th className="px-5 pt-2 pb-1 text-right font-medium">Unredm</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-white/[0.04]">
              <td className="px-5 py-1.5 text-red-300 font-medium">Jackpot</td>
              <td className="py-1.5 text-right text-gray-300">{m.wheelDrafts.jackpot.filling.toLocaleString()}</td>
              <td className="py-1.5 text-right text-gray-300">{m.wheelDrafts.jackpot.drafting.toLocaleString()}</td>
              <td className="py-1.5 text-right text-emerald-300">{m.wheelDrafts.jackpot.completed.toLocaleString()}</td>
              <td className="py-1.5 text-right text-white">{m.wheelDrafts.jackpot.total.toLocaleString()}</td>
              <td className="px-5 py-1.5 text-right text-gray-300">{m.reservedDrafts.jackpot.toLocaleString()}</td>
            </tr>
            <tr className="border-t border-white/[0.04]">
              <td className="px-5 py-1.5 text-[#D4AF37] font-medium">HOF</td>
              <td className="py-1.5 text-right text-gray-300">{m.wheelDrafts.hof.filling.toLocaleString()}</td>
              <td className="py-1.5 text-right text-gray-300">{m.wheelDrafts.hof.drafting.toLocaleString()}</td>
              <td className="py-1.5 text-right text-emerald-300">{m.wheelDrafts.hof.completed.toLocaleString()}</td>
              <td className="py-1.5 text-right text-white">{m.wheelDrafts.hof.total.toLocaleString()}</td>
              <td className="px-5 py-1.5 text-right text-gray-300">{m.reservedDrafts.hof.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </Inline>
    </DomainBox>
  );
}

/* ─────────────────────────────────────────────────────────  PROMOS box  */

// Canonical promo list — render every type so coverage gaps are visible.
const CANONICAL_PROMOS: { key: string; label: string }[] = [
  { key: 'new-user', label: 'New user' },
  { key: 'buy-bonus', label: 'Buy bonus' },
  { key: 'referral', label: 'Referral' },
  { key: 'daily-drafts', label: 'Daily drafts' },
  { key: 'pick-10', label: 'Pick 10' },
  { key: 'tweet-engagement', label: 'Tweet engagement' },
  { key: 'spin-share', label: 'Spin share' },
  { key: 'add-to-home-screen', label: 'Add to home' },
  { key: 'jackpot', label: 'Jackpot (in-draft)' },
  { key: 'hof', label: 'HOF (in-draft)' },
  { key: 'mint', label: 'Mint' },
  { key: 'founder-draft', label: 'Founder draft' },
];

function PromosBox({ m, progress }: { m: MetricsResponse; progress?: PromoProgressResponse }) {
  const breakdown = m.promoBreakdown;
  const perType = progress?.perType ?? {};
  const seenKeys = new Set([
    ...Object.keys(breakdown),
    ...Object.keys(perType),
    ...CANONICAL_PROMOS.map((p) => p.key),
  ]);
  const canonicalKeySet = new Set(CANONICAL_PROMOS.map((p) => p.key));
  const extras = [...seenKeys].filter((k) => !canonicalKeySet.has(k));
  const rows: { key: string; label: string }[] = [
    ...CANONICAL_PROMOS,
    ...extras.map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/-/g, ' ') })),
  ];

  return (
    <DomainBox
      title="Promos"
      accent="text-pink-300"
      sub={`${m.promos.promoClaimsToday} today · ${m.lifetime.promosClaimed} lifetime`}
    >
      <div className="overflow-y-auto max-h-[440px]">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500 sticky top-0 bg-[#0f0f12] backdrop-blur">
            <tr>
              <th className="px-5 pt-3 pb-1.5 text-left font-medium">Promo</th>
              <th className="pt-3 pb-1.5 text-right font-medium">Today</th>
              <th className="pt-3 pb-1.5 text-right font-medium">Life</th>
              <th className="pt-3 pb-1.5 text-right font-medium">Start</th>
              <th className="pt-3 pb-1.5 text-right font-medium">Done</th>
              <th className="px-5 pt-3 pb-1.5 text-right font-medium">Conv</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row) => {
              const claims = breakdown[row.key] ?? { claimsToday: 0, claimsTotal: 0 };
              const prog = perType[row.key] ?? { started: 0, completed: 0, pending: 0, conversionRate: 0 };
              const inactive = claims.claimsTotal === 0 && prog.started === 0;
              const ratePct = (prog.conversionRate * 100).toFixed(0);
              const rateColor =
                prog.started === 0 ? 'text-gray-600'
                : prog.conversionRate >= 0.5 ? 'text-emerald-300'
                : prog.conversionRate >= 0.2 ? 'text-amber-300'
                : 'text-red-300';
              return (
                <tr key={row.key} className="border-t border-white/[0.04]">
                  <td className={`px-5 py-1.5 capitalize ${inactive ? 'text-gray-500' : 'text-white'}`}>{row.label}</td>
                  <td className={`py-1.5 text-right ${claims.claimsToday > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{claims.claimsToday}</td>
                  <td className={`py-1.5 text-right ${claims.claimsTotal > 0 ? 'text-gray-200' : 'text-gray-600'}`}>{claims.claimsTotal}</td>
                  <td className={`py-1.5 text-right ${prog.started > 0 ? 'text-gray-200' : 'text-gray-600'}`}>{prog.started}</td>
                  <td className={`py-1.5 text-right ${prog.completed > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{prog.completed}</td>
                  <td className={`px-5 py-1.5 text-right ${rateColor}`}>{prog.started > 0 ? `${ratePct}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {progress && progress.stalePending.length > 0 && (
        <Inline title="Stale starters" sub={`pending 48h+ · ${progress.stalePending.length} to DM`}>
          <ul className="max-h-32 overflow-y-auto pb-2">
            {progress.stalePending.slice(0, 8).map((p) => (
              <li
                key={`${p.wallet}-${p.promoId}`}
                className="flex items-center justify-between gap-3 px-5 py-1.5 border-t border-white/[0.04]"
              >
                <WalletLink wallet={p.wallet} bare className="!text-xs !text-gray-200 hover:!text-banana" />
                <span className="text-[11px] text-gray-400 capitalize">
                  {p.promoType.replace(/-/g, ' ')} · {p.progress}/{p.progressMax}
                </span>
                <span className="text-[11px] text-amber-300 shrink-0 tabular-nums">
                  {p.hoursStale !== null ? `${p.hoursStale}h` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </Inline>
      )}
    </DomainBox>
  );
}

/* ─────────────────────────────────────────────────────────  MONEY box  */

const AGE_BUCKETS = [
  { key: 'fresh' as const, label: '< 24h', accent: 'text-emerald-300' },
  { key: '1to3' as const, label: '1–3 d', accent: 'text-amber-300' },
  { key: '3to7' as const, label: '3–7 d', accent: 'text-orange-300' },
  { key: 'week+' as const, label: '> 7 d', accent: 'text-red-300' },
];

function bucketFor(ageHours: number): typeof AGE_BUCKETS[number]['key'] {
  if (ageHours < 24) return 'fresh';
  if (ageHours < 72) return '1to3';
  if (ageHours < 168) return '3to7';
  return 'week+';
}

function MoneyBox({ m, withdrawals }: { m: MetricsResponse; withdrawals: AdminWithdrawalItem[] }) {
  const free = m.totalFreeDraftsFromWheel;
  const paid = m.lifetime.passesPurchased;
  const totalPasses = free + paid;
  const pct = (n: number) => (totalPasses > 0 ? `${((n / totalPasses) * 100).toFixed(1)}%` : '—');

  const pending = withdrawals.filter((w) => w.status === 'pending');
  const now = Date.now();
  const counts: Record<typeof AGE_BUCKETS[number]['key'], { count: number; amount: number }> = {
    fresh: { count: 0, amount: 0 },
    '1to3': { count: 0, amount: 0 },
    '3to7': { count: 0, amount: 0 },
    'week+': { count: 0, amount: 0 },
  };
  for (const w of pending) {
    const t = w.createdAt ? new Date(w.createdAt).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    const ageHours = (now - t) / 3_600_000;
    counts[bucketFor(ageHours)].count += 1;
    counts[bucketFor(ageHours)].amount += w.amount;
  }

  return (
    <DomainBox title="Money" accent="text-emerald-300">
      <TodayTotalTable
        rows={[
          { label: 'Pending withdrawals', today: m.withdrawals.pending, sub: `$${m.withdrawals.totalVolume.toLocaleString()} approved + pending`, accent: m.withdrawals.pending > 0 ? 'text-amber-300' : 'text-gray-200' },
          { label: 'Withdrawals paid', total: `$${m.lifetime.withdrawalsPaidVolume.toLocaleString()}`, sub: 'lifetime payouts', accent: 'text-green-300' },
        ]}
      />

      <Inline title="Passes — free vs paid">
        <table className="w-full text-sm">
          <tbody className="tabular-nums">
            <tr className="border-t border-white/[0.04]">
              <td className="px-5 py-1.5 text-emerald-300">Paid (card + USDC)</td>
              <td className="py-1.5 text-right text-white">{paid.toLocaleString()}</td>
              <td className="px-5 py-1.5 text-right text-[11px] text-gray-500">{pct(paid)}</td>
            </tr>
            <tr className="border-t border-white/[0.04]">
              <td className="px-5 py-1.5 text-purple-300">Free (wheel wins)</td>
              <td className="py-1.5 text-right text-white">{free.toLocaleString()}</td>
              <td className="px-5 py-1.5 text-right text-[11px] text-gray-500">{pct(free)}</td>
            </tr>
            <tr className="border-t border-white/[0.06]">
              <td className="px-5 py-1.5 text-white font-semibold">Total</td>
              <td className="py-1.5 text-right text-white font-semibold">{totalPasses.toLocaleString()}</td>
              <td className="px-5 py-1.5" />
            </tr>
          </tbody>
        </table>
      </Inline>

      <Inline title="Pending withdrawals — by age" sub={pending.length === 0 ? 'nothing pending' : `${pending.length} total`}>
        <table className="w-full text-sm">
          <tbody className="tabular-nums">
            {AGE_BUCKETS.map((b) => {
              const c = counts[b.key];
              const dim = c.count === 0;
              return (
                <tr key={b.key} className="border-t border-white/[0.04]">
                  <td className={`px-5 py-1.5 ${dim ? 'text-gray-500' : b.accent}`}>{b.label}</td>
                  <td className={`py-1.5 text-right ${dim ? 'text-gray-600' : 'text-white'}`}>{c.count.toLocaleString()}</td>
                  <td className={`px-5 py-1.5 text-right text-[11px] ${dim ? 'text-gray-600' : 'text-gray-500'}`}>${c.amount.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Inline>
    </DomainBox>
  );
}

/* ─────────────────────────────────────────────────────────  Secondary row  */

function TopUsersBox({ data, loading }: { data: HeaviestUserEntry[] | undefined; loading: boolean }) {
  return (
    <DomainBox title="Top users · by spend" sub="see all → User Lookup">
      <div className="px-5 py-3">
        {loading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : !data || data.length === 0 ? (
          <p className="text-xs text-gray-500">No spend data in scan window.</p>
        ) : (
          <ul>
            {data.slice(0, 8).map((e, i) => (
              <li key={e.userId} className="flex items-center justify-between gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[10px] text-gray-500 tabular-nums w-4 shrink-0">{i + 1}.</span>
                  <div className="min-w-0">
                    {e.username && <p className="text-xs text-white truncate">{e.username}</p>}
                    <WalletLink wallet={e.userId} bare className="!text-[10px] !text-gray-500 hover:!text-banana" />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm text-emerald-300 font-semibold tabular-nums">${Math.round(e.spendUsd).toLocaleString()}</p>
                  <p className="text-[10px] text-gray-500">{e.passesBought} pass{e.passesBought === 1 ? '' : 'es'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DomainBox>
  );
}

function RecentErrorsBox({ errors, loading }: { errors: ErrorEventEntry[]; loading: boolean }) {
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
    <DomainBox title="Errors · last 24h" sub={<Link href="/admin?tab=logs" className="hover:text-white">all logs →</Link>}>
      <div className="divide-y divide-white/[0.04] max-h-[300px] overflow-y-auto">
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
    </DomainBox>
  );
}

function LiveActivityBox({ enabled }: { enabled: boolean }) {
  return (
    <DomainBox title="Live activity" sub={<Link href="/admin?tab=audit&sub=live-activity" className="hover:text-white">see all →</Link>}>
      <div className="p-2 max-h-[300px] overflow-y-auto">
        <LiveActivity enabled={enabled} />
      </div>
    </DomainBox>
  );
}
