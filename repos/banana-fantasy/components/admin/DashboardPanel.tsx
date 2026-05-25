'use client';

/**
 * Dashboard — at-a-glance overview, square-grid layout.
 *
 * Boris's spec (May 2026 consolidation round):
 *   - Compact squares at top: every important domain in one glance
 *   - For each KPI: daily AND total visible together
 *   - All promos surfaced (even ones with zero claims) so coverage gaps show
 *   - 2-column rows below to minimize scrolling
 *   - Live data, every number polled, no graphs
 *
 * Section order (top → bottom):
 *   1. Health + live indicator (one line)
 *   2. 8 KPI squares in 2 rows of 4: USERS · LOGINS · SPINS · MINTS
 *                                    PROMOS · JP HITS · HOF HITS · WITHDRAWALS
 *   3. ALL PROMOS table + WHEEL PRIZES table (2-column)
 *   4. JP/HOF pipeline + FREE vs PAID (2-column)
 *   5. SIGNUP RAILS + WITHDRAWAL AGING (2-column)
 *   6. PROMO PROGRESS + HEAVIEST USERS (2-column)
 *   7. RECENT ERRORS + LIVE ACTIVITY (2-column)
 */

import Link from 'next/link';
import {
  useAdminMetrics,
  useRecentErrors,
  usePromoProgress,
  type ErrorEventEntry,
  type MetricsResponse,
  type PromoProgressResponse,
  AdminApiError,
} from '@/hooks/admin/useAdminApi';
import { LiveActivity } from '@/components/admin/LiveActivity';
import { WalletLink } from '@/components/admin/WalletLink';
import { PromoProgressCard } from '@/components/admin/Dashboard/PromoProgressCard';
import { HeaviestUsersCard } from '@/components/admin/Dashboard/HeaviestUsersCard';
import { WithdrawalAgingCard } from '@/components/admin/Dashboard/WithdrawalAgingCard';
import { explainError } from '@/lib/logSources';

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

/* ─────────────────────────────────────────────────────────  Page  */

export function DashboardPanel({ enabled }: { enabled: boolean }) {
  const metricsQ = useAdminMetrics(enabled);
  const errorsQ = useRecentErrors(enabled);
  const promoQ = usePromoProgress(enabled);
  const m = metricsQ.data;
  const errors = errorsQ.data?.errors ?? [];

  const health = computeHealth(errors, m?.withdrawals.pending);
  const ageSec = m?.generatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(m.generatedAt).getTime()) / 1000))
    : null;

  return (
    <div className="space-y-5">
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

      {m && <KpiGrid m={m} />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {m && <AllPromosCard m={m} progress={promoQ.data} />}
        {m && <WheelPrizesCard m={m} />}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {m && <WheelDraftsCard m={m} />}
        {m && <PassesCard m={m} />}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {m && <SignupRailsCard m={m} />}
        <WithdrawalAgingCard enabled={enabled} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <PromoProgressCard enabled={enabled} />
        <HeaviestUsersCard enabled={enabled} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <RecentErrorsWidget errors={errors} loading={errorsQ.isLoading} />
        <LiveActivityWidget enabled={enabled} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────  Header  */

function HealthBar({
  health,
  ageSec,
  fetching,
  onRefresh,
}: {
  health: HealthState;
  ageSec: number | null;
  fetching: boolean;
  onRefresh: () => void;
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
          {fetching ? 'refreshing…' : ageSec !== null ? `live · ${ageSec}s ago · auto 10s` : 'loading…'}
        </span>
        <button onClick={onRefresh} className="text-gray-400 hover:text-white" title="Refresh now">↻</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────  KPI squares  */

/**
 * Single square KPI tile. Top: small label. Big number = today. Underneath:
 * "X total" lifetime + one extra context line. Sized so 4 fit on a row at
 * desktop with comfortable padding.
 */
function Sq({
  label,
  today,
  total,
  totalLabel,
  extra,
  accent = 'text-white',
}: {
  label: string;
  today: number | string;
  total?: number | string;
  totalLabel?: string;
  extra?: string;
  accent?: string;
}) {
  const todayDisplay = typeof today === 'number' ? today.toLocaleString() : today;
  const totalDisplay = typeof total === 'number' ? total.toLocaleString() : total;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5 flex flex-col min-h-[120px]">
      <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl sm:text-3xl font-semibold tabular-nums ${accent}`}>{todayDisplay}</p>
      <div className="mt-auto pt-2 text-[11px] text-gray-500 leading-tight">
        {total !== undefined && (
          <span className="block tabular-nums">
            <span className="text-gray-300">{totalDisplay}</span>{' '}
            {totalLabel ?? 'all-time'}
          </span>
        )}
        {extra && <span className="block">{extra}</span>}
      </div>
    </div>
  );
}

function KpiGrid({ m }: { m: MetricsResponse }) {
  // Retention proxy: lifetime logins / total users — "X.X average logins
  // per signed-up user." Anything <1 means most signups never came back.
  const retention = m.users.total > 0 ? (m.lifetime.logins / m.users.total).toFixed(1) : '0';
  const freePasses = m.totalFreeDraftsFromWheel;
  const paidPasses = m.lifetime.passesPurchased;
  const totalPasses = freePasses + paidPasses;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <Sq
        label="New users"
        today={m.users.newToday}
        total={m.users.total}
        totalLabel="users total"
        extra={`+${m.users.newThisWeek} this week`}
      />
      <Sq
        label="Logins"
        today={m.engagement.loginsToday}
        total={m.lifetime.logins}
        totalLabel="lifetime"
        extra={`${retention}× per user · ${m.engagement.loginsThisWeek} this wk`}
        accent="text-blue-300"
      />
      <Sq
        label="Wheel spins"
        today={m.wheel.spinsToday}
        total={m.lifetime.wheelSpins}
        totalLabel="spins ever"
        extra={`JP odds 1% · HOF odds 5%`}
        accent="text-[#F3E216]"
      />
      <Sq
        label="Mints (paid passes)"
        today={'—'}
        total={paidPasses}
        totalLabel="card + USDC ever"
        extra={`${totalPasses.toLocaleString()} total passes (paid + free)`}
        accent="text-emerald-300"
      />

      <Sq
        label="Promos claimed"
        today={m.promos.promoClaimsToday}
        total={m.lifetime.promosClaimed}
        totalLabel="lifetime"
        extra={`${m.promos.sharesVerifiedToday} shares verified today`}
        accent="text-pink-300"
      />
      <Sq
        label="Jackpot wheel hits"
        today={'—'}
        total={m.lifetime.jackpotWins}
        totalLabel="lifetime"
        extra={`${m.wheelDrafts.jackpot.total} JP drafts created · ${m.reservedDrafts.jackpot} unredeemed`}
        accent="text-red-400"
      />
      <Sq
        label="HOF wheel hits"
        today={'—'}
        total={m.lifetime.hofWins}
        totalLabel="lifetime"
        extra={`${m.wheelDrafts.hof.total} HOF drafts created · ${m.reservedDrafts.hof} unredeemed`}
        accent="text-[#D4AF37]"
      />
      <Sq
        label="Withdrawals"
        today={m.withdrawals.pending}
        total={`$${m.lifetime.withdrawalsPaidVolume.toLocaleString()}`}
        totalLabel="paid lifetime"
        extra={`${m.withdrawals.pending} pending now`}
        accent={m.withdrawals.pending > 0 ? 'text-amber-300' : 'text-white'}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────  Section primitive  */

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">{title}</h3>
        {sub && <p className="text-[10px] text-gray-600">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">{children}</div>;
}

/* ─────────────────────────────────────────────────────────  ALL promos table  */

// Canonical promo list — every type defined in types/index.ts PromoType.
// Rendering ALL of them (not just ones with claims) so coverage gaps are
// obvious: a promo with 0 starts + 0 claims tells you "this promo is
// live but nobody's engaging with it — investigate."
const CANONICAL_PROMOS: { key: string; label: string }[] = [
  { key: 'new-user', label: 'New user' },
  { key: 'buy-bonus', label: 'Buy bonus' },
  { key: 'referral', label: 'Referral' },
  { key: 'daily-drafts', label: 'Daily drafts' },
  { key: 'pick-10', label: 'Pick 10' },
  { key: 'tweet-engagement', label: 'Tweet engagement' },
  { key: 'spin-share', label: 'Spin share' },
  { key: 'add-to-home-screen', label: 'Add to home screen' },
  { key: 'jackpot', label: 'Jackpot (in-draft)' },
  { key: 'hof', label: 'HOF (in-draft)' },
  { key: 'mint', label: 'Mint' },
  { key: 'founder-draft', label: 'Founder draft' },
];

function AllPromosCard({ m, progress }: { m: MetricsResponse; progress?: PromoProgressResponse }) {
  const breakdown = m.promoBreakdown;
  const perType = progress?.perType ?? {};
  // Build the row set: canonical list first, then any extras seen in
  // the data that aren't on the canonical list (so we never silently
  // hide a new promo type).
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
    <Section title="All promos">
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-4 pt-4 pb-2 text-left font-medium">Promo</th>
              <th className="pt-4 pb-2 text-right font-medium">Today</th>
              <th className="pt-4 pb-2 text-right font-medium">Lifetime</th>
              <th className="pt-4 pb-2 text-right font-medium">Started</th>
              <th className="pt-4 pb-2 text-right font-medium">Done</th>
              <th className="px-4 pt-4 pb-2 text-right font-medium">Conv</th>
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
                <tr key={row.key} className="border-t border-white/[0.06]">
                  <td className={`px-4 py-2 capitalize ${inactive ? 'text-gray-500' : 'text-white'}`}>{row.label}</td>
                  <td className={`py-2 text-right ${claims.claimsToday > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{claims.claimsToday}</td>
                  <td className={`py-2 text-right ${claims.claimsTotal > 0 ? 'text-gray-200' : 'text-gray-600'}`}>{claims.claimsTotal}</td>
                  <td className={`py-2 text-right ${prog.started > 0 ? 'text-gray-200' : 'text-gray-600'}`}>{prog.started}</td>
                  <td className={`py-2 text-right ${prog.completed > 0 ? 'text-emerald-300' : 'text-gray-600'}`}>{prog.completed}</td>
                  <td className={`px-4 py-2 text-right ${rateColor}`}>{prog.started > 0 ? `${ratePct}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-white/[0.06]">
          Dim rows have zero activity. Started + Done track multi-step promos via promo-progress.
        </p>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Wheel prizes  */

function WheelPrizesCard({ m }: { m: MetricsResponse }) {
  const rows = Object.entries(m.wheelPrizeBreakdown).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const accentFor = (label: string) =>
    /jackpot/i.test(label) ? 'text-red-300'
    : /hof/i.test(label) ? 'text-[#D4AF37]'
    : /nothing/i.test(label) ? 'text-gray-400'
    : 'text-purple-300';

  return (
    <Section title="Wheel wins" sub={total > 0 ? `last ${total.toLocaleString()} spins` : 'no spins yet'}>
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-4 pt-4 pb-2 text-left font-medium">Prize</th>
              <th className="pt-4 pb-2 text-right font-medium">Count</th>
              <th className="px-4 pt-4 pb-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-xs text-gray-500">
                  No spin data yet.
                </td>
              </tr>
            ) : (
              rows.map(([label, count]) => (
                <tr key={label} className="border-t border-white/[0.06]">
                  <td className={`px-4 py-2 ${accentFor(label)} capitalize`}>{label}</td>
                  <td className="py-2 text-right text-gray-200">{count.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))
            )}
            <tr className="border-t border-white/[0.06]">
              <td className="px-4 py-2.5 text-white font-semibold">Total free drafts given</td>
              <td className="py-2.5 text-right text-purple-300 font-semibold">{m.totalFreeDraftsFromWheel.toLocaleString()}</td>
              <td className="px-4 py-2.5" />
            </tr>
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  JP/HOF drafts  */

function WheelDraftsCard({ m }: { m: MetricsResponse }) {
  const jp = m.wheelDrafts.jackpot;
  const hof = m.wheelDrafts.hof;
  return (
    <Section title="JP / HOF drafts" sub="wheel-won only · separate from 5%/1% distribution">
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-4 pt-4 pb-2 text-left font-medium">Type</th>
              <th className="pt-4 pb-2 text-right font-medium">Filling</th>
              <th className="pt-4 pb-2 text-right font-medium">Drafting</th>
              <th className="pt-4 pb-2 text-right font-medium">Done</th>
              <th className="pt-4 pb-2 text-right font-medium">Total</th>
              <th className="px-4 pt-4 pb-2 text-right font-medium">Unredeemed</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-white/[0.06]">
              <td className="px-4 py-2 text-sm font-semibold text-red-300">Jackpot</td>
              <td className="py-2 text-right text-gray-300">{jp.filling.toLocaleString()}</td>
              <td className="py-2 text-right text-gray-300">{jp.drafting.toLocaleString()}</td>
              <td className="py-2 text-right text-emerald-300">{jp.completed.toLocaleString()}</td>
              <td className="py-2 text-right text-white font-semibold">{jp.total.toLocaleString()}</td>
              <td className="px-4 py-2 text-right text-gray-300">{m.reservedDrafts.jackpot.toLocaleString()}</td>
            </tr>
            <tr className="border-t border-white/[0.06]">
              <td className="px-4 py-2 text-sm font-semibold text-[#D4AF37]">HOF</td>
              <td className="py-2 text-right text-gray-300">{hof.filling.toLocaleString()}</td>
              <td className="py-2 text-right text-gray-300">{hof.drafting.toLocaleString()}</td>
              <td className="py-2 text-right text-emerald-300">{hof.completed.toLocaleString()}</td>
              <td className="py-2 text-right text-white font-semibold">{hof.total.toLocaleString()}</td>
              <td className="px-4 py-2 text-right text-gray-300">{m.reservedDrafts.hof.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-white/[0.06]">
          Unredeemed = wheel wins users earned but haven&apos;t entered a draft with yet.
        </p>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Passes  */

function PassesCard({ m }: { m: MetricsResponse }) {
  const free = m.totalFreeDraftsFromWheel;
  const paid = m.lifetime.passesPurchased;
  const total = free + paid;
  const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0');
  return (
    <Section title="Passes — free vs paid">
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-4 pt-4 pb-2 text-left font-medium">Source</th>
              <th className="pt-4 pb-2 text-right font-medium">Count</th>
              <th className="px-4 pt-4 pb-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-white/[0.06]">
              <td className="px-4 py-2 text-emerald-300">Paid (card + USDC)</td>
              <td className="py-2 text-right text-gray-200">{paid.toLocaleString()}</td>
              <td className="px-4 py-2 text-right text-gray-500">{pct(paid)}%</td>
            </tr>
            <tr className="border-t border-white/[0.06]">
              <td className="px-4 py-2 text-purple-300">Free (wheel wins)</td>
              <td className="py-2 text-right text-gray-200">{free.toLocaleString()}</td>
              <td className="px-4 py-2 text-right text-gray-500">{pct(free)}%</td>
            </tr>
            <tr className="border-t border-white/[0.06]">
              <td className="px-4 py-2.5 text-white font-semibold">Total</td>
              <td className="py-2.5 text-right text-white font-bold">{total.toLocaleString()}</td>
              <td className="px-4 py-2.5" />
            </tr>
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Signup rails  */

function SignupRailsCard({ m }: { m: MetricsResponse }) {
  const segments: { key: keyof MetricsResponse['users']['byWalletType']; label: string; accent: string }[] = [
    { key: 'privy_embedded', label: 'Social login (Gmail / X / etc.)', accent: 'text-blue-300' },
    { key: 'privy_external', label: 'Privy + external wallet', accent: 'text-purple-300' },
    { key: 'external_connect', label: 'Crypto wallet direct', accent: 'text-emerald-300' },
    { key: 'unknown', label: 'Unknown (pre-tracking)', accent: 'text-gray-400' },
  ];
  const total = m.users.total;
  const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0');
  return (
    <Section title="Signup rails" sub={`lifetime · ${total.toLocaleString()} users`}>
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-4 pt-4 pb-2 text-left font-medium">Rail</th>
              <th className="pt-4 pb-2 text-right font-medium">Count</th>
              <th className="px-4 pt-4 pb-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {segments.map((s) => {
              const count = m.users.byWalletType[s.key];
              const dim = count === 0;
              return (
                <tr key={s.key} className="border-t border-white/[0.06]">
                  <td className={`px-4 py-2 ${dim ? 'text-gray-500' : s.accent}`}>{s.label}</td>
                  <td className={`py-2 text-right ${dim ? 'text-gray-600' : 'text-gray-200'}`}>{count.toLocaleString()}</td>
                  <td className={`px-4 py-2 text-right ${dim ? 'text-gray-600' : 'text-gray-500'}`}>{pct(count)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Recent errors  */

function RecentErrorsWidget({ errors, loading }: { errors: ErrorEventEntry[]; loading: boolean }) {
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
  const top5 = [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);

  return (
    <Section title="Recent errors · last 24h">
      <Card>
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">Top by source</h4>
          <Link href="/admin?tab=logs" className="text-[11px] text-gray-400 hover:text-white">See all →</Link>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {loading ? (
            <p className="px-5 py-6 text-center text-gray-500 text-xs">Loading…</p>
          ) : top5.length === 0 ? (
            <p className="px-5 py-6 text-center text-gray-500 text-xs">Nothing — quiet day.</p>
          ) : (
            top5.map(([source, { count, latest, affected }]) => {
              const wallets = Array.from(affected);
              const shown = wallets.slice(0, 3);
              const extra = wallets.length - shown.length;
              return (
                <div key={source} className="px-5 py-2.5 hover:bg-white/[0.02] transition-colors">
                  <Link href={`/admin?tab=logs&source=${encodeURIComponent(source)}`} className="block">
                    <div className="flex items-baseline justify-between gap-3 mb-0.5">
                      <span className="text-[12px] font-mono text-amber-300 truncate">{source}</span>
                      <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                        {count.toLocaleString()}× · {wallets.length} {wallets.length === 1 ? 'user' : 'users'}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 truncate leading-snug">
                      {explainError(source, latest.message) || latest.message}
                    </p>
                  </Link>
                  {shown.length > 0 && (
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {shown.map((w) => (
                        <WalletLink key={w} wallet={w} bare className="!text-[10px] !text-gray-400 hover:!text-banana" />
                      ))}
                      {extra > 0 && <span className="text-[10px] text-gray-500">+{extra} more</span>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </Section>
  );
}

function LiveActivityWidget({ enabled }: { enabled: boolean }) {
  return (
    <Section title="Live activity">
      <Card>
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">Recent events</h4>
          <Link href="/admin?tab=audit&sub=live-activity" className="text-[11px] text-gray-400 hover:text-white">See all →</Link>
        </div>
        <div className="p-2 max-h-[440px] overflow-y-auto">
          <LiveActivity enabled={enabled} />
        </div>
      </Card>
    </Section>
  );
}
