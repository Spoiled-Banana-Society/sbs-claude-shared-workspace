'use client';

/**
 * Dashboard — the "what needs my attention right now" tab.
 *
 * Phase 3 of the admin overhaul. Replaces the old "Metrics" tab as the
 * default landing screen. Surfaces, in priority order:
 *
 *   1. System health (🟢/🟡/🔴 with one-line reason) — top priority
 *   2. KPI cards with live sparklines + 7-day deltas
 *   3. Recent errors (top 5 by source, expandable)
 *   4. Live activity feed (last 20 events, clickable wallets)
 *
 * Everything here is read-only — actions live in the dedicated tabs
 * (User Lookup for per-user, Money for payouts, etc.). The Dashboard
 * is for triage: glance, see what's healthy / what's broken / who
 * needs help, then jump to the right tab.
 *
 * Sparklines are populated from in-memory polling — the same hook that
 * powers the live KPI numbers keeps the last 30 samples for trend.
 * Refreshing the page wipes the series; that's fine because we also
 * show "vs yesterday" deltas from server-side counts.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAdminMetrics, useRecentErrors, type ErrorEventEntry, type MetricsResponse, AdminApiError } from '@/hooks/admin/useAdminApi';
import { Sparkline } from '@/components/admin/Sparkline';
import { LiveActivity } from '@/components/admin/LiveActivity';
import { WalletLink } from '@/components/admin/WalletLink';
import { explainError } from '@/lib/logSources';

// How many polling samples we keep for each KPI's sparkline. At a 10s
// poll interval, 30 samples ≈ 5 minutes of trend.
const SPARK_WINDOW = 30;

/**
 * Aggregates polling samples into a rolling per-KPI series. Pure in-memory;
 * cleared on page refresh by design (we don't want to mislead the eye with
 * stitched-together data from different sessions).
 */
function useKpiSeries(latest: number | undefined, tick: string | undefined): number[] {
  const ref = useRef<{ values: number[]; lastTick: string | null }>({ values: [], lastTick: null });
  const [, force] = useState(0);
  useEffect(() => {
    if (latest === undefined || !tick) return;
    if (ref.current.lastTick === tick) return; // dedupe same poll
    ref.current.lastTick = tick;
    ref.current.values = [...ref.current.values.slice(-(SPARK_WINDOW - 1)), latest];
    force((x) => x + 1);
  }, [latest, tick]);
  return ref.current.values;
}

interface HealthState {
  level: 'ok' | 'warn' | 'critical';
  reason: string;
}

function computeHealth(errors: ErrorEventEntry[] | undefined, pendingWithdrawals: number | undefined): HealthState {
  // CRITICAL: any critical-severity error in the last hour, OR
  // pending withdrawals piling up (>20).
  // WARN:     any non-low errors in the last hour, OR pending withdrawals 5+.
  // OK:       otherwise.
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

export function DashboardPanel({ enabled }: { enabled: boolean }) {
  const metricsQ = useAdminMetrics(enabled);
  const errorsQ = useRecentErrors(enabled);
  const m = metricsQ.data;
  const errors = errorsQ.data?.errors ?? [];

  // Build sparkline series from successive polls. Tick = generatedAt so
  // we only sample once per server-side regen.
  const signupsSeries = useKpiSeries(m?.engagement.signupsToday, m?.generatedAt);
  const loginsSeries = useKpiSeries(m?.engagement.loginsToday, m?.generatedAt);
  const spinsSeries = useKpiSeries(m?.wheel.spinsToday, m?.generatedAt);
  const withdrawSeries = useKpiSeries(m?.withdrawals.pending, m?.generatedAt);

  const health = computeHealth(errors, m?.withdrawals.pending);

  // Age-in-seconds of the data — drives the "Updated Xs ago" header so
  // Boris can see at a glance that the dashboard IS pulling live data.
  const ageSec = m?.generatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(m.generatedAt).getTime()) / 1000))
    : null;

  return (
    <div className="space-y-6">
      {/* System health — top priority, always visible */}
      <HealthCard health={health} loading={metricsQ.isLoading || errorsQ.isLoading} />

      {/* Live-data indicator. Auto-refreshes every 10s; manual refresh
          for the impatient. The age tick lets Boris confirm at a glance
          the dashboard isn't stale. */}
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${metricsQ.isFetching ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
          {metricsQ.isFetching
            ? 'refreshing live data…'
            : ageSec !== null
              ? `live · last update ${ageSec}s ago · auto-refreshes every 10s`
              : 'loading live data…'}
        </div>
        <button
          onClick={() => metricsQ.refetch()}
          className="text-gray-400 hover:text-white underline underline-offset-2"
        >
          ↻ Refresh now
        </button>
      </div>

      {metricsQ.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(metricsQ.error as AdminApiError)?.message || 'Failed to load metrics'}
        </div>
      )}

      {/* TODAY — what's happening right now, with live in-memory sparklines */}
      {m && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-2">Today</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <KpiCard label="Signups today" value={m.engagement.signupsToday} sub={`${m.engagement.signupsThisWeek} this week`} series={signupsSeries} />
            <KpiCard label="Logins today" value={m.engagement.loginsToday} sub={`${m.engagement.loginsThisWeek} this week`} series={loginsSeries} accent="text-blue-400" />
            <KpiCard label="Wheel spins today" value={m.wheel.spinsToday} sub={`${m.wheel.totalSpins.toLocaleString()} all-time`} series={spinsSeries} accent="text-[#F3E216]" />
            <KpiCard label="Pending withdrawals" value={m.withdrawals.pending} sub={`$${m.withdrawals.totalVolume.toLocaleString()} approved+pending volume`} series={withdrawSeries} accent={m.withdrawals.pending > 0 ? 'text-yellow-400' : 'text-white'} />
            <KpiCard label="Total users" value={m.users.total} sub={`+${m.users.newToday} today / +${m.users.newThisWeek} this week`} />
            <KpiCard label="Promos claimed today" value={m.promos.promoClaimsToday} sub={`${m.promos.sharesVerifiedToday} shares verified`} accent="text-green-400" />
            <KpiCard label="JP drafts (wheel-won)" value={m.wheelDrafts.jackpot.total} sub={`${m.wheelDrafts.jackpot.filling} filling · ${m.wheelDrafts.jackpot.drafting} drafting · ${m.wheelDrafts.jackpot.completed} done`} accent="text-red-400" />
            <KpiCard label="HOF drafts (wheel-won)" value={m.wheelDrafts.hof.total} sub={`${m.wheelDrafts.hof.filling} filling · ${m.wheelDrafts.hof.drafting} drafting · ${m.wheelDrafts.hof.completed} done`} accent="text-[#D4AF37]" />
          </div>
        </div>
      )}

      {/* JP/HOF WHEEL-WON DRAFT PIPELINE — explicit "what stage is each one
          at" view. Boris asked for: how many pending where filling, how
          many already finished. This card group is the answer. */}
      {m && (m.wheelDrafts.jackpot.total > 0 || m.wheelDrafts.hof.total > 0) && (
        <WheelDraftsPipelineCard wheelDrafts={m.wheelDrafts} reserved={m.reservedDrafts} />
      )}

      {/* ALL TIME — cumulative scoreboard. Boris explicitly asked for these
          alongside the per-day numbers ("total promos, total mints etc."). */}
      {m && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-2">All time</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <KpiCard label="Total signups" value={m.lifetime.signups} sub="every user that ever signed in" />
            <KpiCard label="Total logins" value={m.lifetime.logins} sub="lifetime login events" accent="text-blue-400" />
            <KpiCard label="Total wheel spins" value={m.lifetime.wheelSpins} sub="every spin ever" accent="text-[#F3E216]" />
            <KpiCard label="Total passes purchased" value={m.lifetime.passesPurchased} sub="card + USDC mints" accent="text-emerald-400" />
            <KpiCard label="Total promos claimed" value={m.lifetime.promosClaimed} sub="across all promo types" accent="text-pink-400" />
            <KpiCard label="Jackpot wheel hits" value={m.lifetime.jackpotWins} sub="lifetime — wheel landed on Jackpot" accent="text-red-400" />
            <KpiCard label="HOF wheel hits" value={m.lifetime.hofWins} sub="lifetime — wheel landed on HOF" accent="text-[#D4AF37]" />
            <KpiCard label="Withdrawals paid" value={`$${m.lifetime.withdrawalsPaidVolume.toLocaleString()}`} sub={`${m.lifetime.draftsCompleted.toLocaleString()} drafts completed`} accent="text-green-400" />
          </div>
        </div>
      )}

      {/* FREE vs PAID — at-a-glance ratio of how many draft passes came
          from wheel wins vs how many were purchased. Answers "are we
          mostly giving them away or selling them". */}
      {m && (
        <FreeVsPaidCard
          freeFromWheel={m.totalFreeDraftsFromWheel}
          paid={m.lifetime.passesPurchased}
        />
      )}

      {/* WHEEL PRIZE BREAKDOWN — how many wins of each prize type across
          the last 2000 spins. Boris's ask: "from the banana wheel spins
          how many wins are what 1 draft 5 draft 20 drafts JP and HOF". */}
      {m && Object.keys(m.wheelPrizeBreakdown).length > 0 && (
        <WheelPrizeBreakdownCard breakdown={m.wheelPrizeBreakdown} />
      )}

      {/* RESERVED DRAFTS PENDING — JP/HOF entries users earned on the
          wheel but haven't yet redeemed into an actual draft. */}
      {m && (m.reservedDrafts.jackpot > 0 || m.reservedDrafts.hof > 0) && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-2">Reserved drafts (wheel wins not yet redeemed)</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="JP entries unredeemed"
              value={m.reservedDrafts.jackpot}
              sub="JP wheel wins users haven't entered a draft with yet"
              accent="text-red-400"
            />
            <KpiCard
              label="HOF entries unredeemed"
              value={m.reservedDrafts.hof}
              sub="HOF wheel wins users haven't entered a draft with yet"
              accent="text-[#D4AF37]"
            />
          </div>
        </div>
      )}

      {/* PROMO BREAKDOWN — popularity by type. Surfaces "which promo is
          actually moving" without admin having to scan the audit log. */}
      {m && Object.keys(m.promoBreakdown).length > 0 && (
        <PromoBreakdownCard breakdown={m.promoBreakdown} />
      )}

      {/* Two-column lower split: recent errors + live activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RecentErrorsWidget errors={errors} loading={errorsQ.isLoading} />
        <LiveActivityWidget enabled={enabled} />
      </div>
    </div>
  );
}

function HealthCard({ health, loading }: { health: HealthState; loading: boolean }) {
  const colorByLevel = {
    ok: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.04]', dot: 'bg-emerald-400', text: 'text-emerald-300' },
    warn: { border: 'border-amber-500/30', bg: 'bg-amber-500/[0.04]', dot: 'bg-amber-400', text: 'text-amber-300' },
    critical: { border: 'border-red-500/40', bg: 'bg-red-500/[0.06]', dot: 'bg-red-400', text: 'text-red-300' },
  }[health.level];
  const headline = { ok: 'Healthy', warn: 'Needs a look', critical: 'Attention required' }[health.level];

  return (
    <div className={`rounded-xl border ${colorByLevel.border} ${colorByLevel.bg} px-5 py-4 flex items-center justify-between gap-4`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${colorByLevel.dot} ${health.level !== 'ok' ? 'animate-pulse' : ''}`} />
        <div className="min-w-0">
          <h3 className={`text-sm font-semibold ${colorByLevel.text}`}>{loading ? 'Checking system…' : headline}</h3>
          <p className="text-[12px] text-gray-400 truncate">{loading ? 'Polling metrics + errors' : health.reason}</p>
        </div>
      </div>
      <Link href="/admin?tab=logs" className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2 shrink-0">
        Logs →
      </Link>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  series,
  accent = 'text-white',
}: {
  label: string;
  /** Accept pre-formatted strings (e.g. "$1,234") or raw numbers. */
  value: number | string;
  sub?: string;
  series?: number[];
  accent?: string;
}) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 backdrop-blur">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[11px] text-gray-400 uppercase tracking-wider">{label}</p>
        {series && series.length >= 2 && <Sparkline values={series} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>{display}</p>
      {sub ? <p className="text-[11px] text-gray-500 mt-1">{sub}</p> : null}
    </div>
  );
}

/**
 * Wheel prize breakdown — shows how many spins won each prize over the
 * last 2000 spins ("1 free draft × 412", "5 free drafts × 47", "Jackpot
 * entry × 11", "HOF entry × 52", "Nothing × 920", …). Sorted by count
 * descending so the most-frequent prize sits at the top. Boris's exact
 * ask: see at a glance which prize values are hitting most often.
 */
function WheelPrizeBreakdownCard({ breakdown }: { breakdown: Record<string, number> }) {
  const rows = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const leader = rows[0]?.[1] ?? 0;
  const total = rows.reduce((s, [, n]) => s + n, 0);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Wheel wins by prize</h3>
        <span className="text-[11px] text-gray-500">last {total.toLocaleString()} spins</span>
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {rows.map(([prize, count]) => {
          const pct = leader > 0 ? Math.max(2, Math.round((count / leader) * 100)) : 0;
          // Color code by prize type so JP/HOF pop visually.
          const accent =
            /jackpot/i.test(prize) ? 'bg-red-500/70'
            : /hof/i.test(prize) ? 'bg-[#D4AF37]/70'
            : /nothing/i.test(prize) ? 'bg-gray-500/40'
            : 'bg-purple-400/70';
          return (
            <li key={prize} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="text-sm font-medium text-white capitalize">{prize}</span>
                <span className="text-xs text-gray-300 tabular-nums">
                  {count.toLocaleString()}
                  <span className="text-gray-500 ml-1">
                    ({total > 0 ? ((count / total) * 100).toFixed(1) : '0'}%)
                  </span>
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full ${accent}`} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Promo breakdown — claims today + lifetime per promo type. Sorted by
 * lifetime claims so the most popular promo bubbles to the top.
 * Boris's ask: "stats not only of people claiming but also which ones
 * are most popular". A bar relative to the leader makes that obvious
 * at a glance without needing exact numbers in your head.
 */
function PromoBreakdownCard({
  breakdown,
}: {
  breakdown: Record<string, { claimsToday: number; claimsTotal: number }>;
}) {
  const rows = Object.entries(breakdown)
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.claimsTotal - a.claimsTotal);
  const leader = rows[0]?.claimsTotal ?? 0;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Promos — popularity by type</h3>
        <span className="text-[11px] text-gray-500">today / all-time</span>
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {rows.map((row) => {
          // Bar width relative to the leader so the most-popular promo
          // is a full bar and the rest scale down proportionally.
          const pct = leader > 0 ? Math.max(2, Math.round((row.claimsTotal / leader) * 100)) : 0;
          return (
            <li key={row.type} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="text-sm font-medium text-white capitalize">{row.type.replace(/_/g, ' ')}</span>
                <span className="text-xs text-gray-400 tabular-nums">
                  <span className="text-emerald-300">{row.claimsToday}</span> / {row.claimsTotal.toLocaleString()}
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full bg-banana/70" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RecentErrorsWidget({ errors, loading }: { errors: ErrorEventEntry[]; loading: boolean }) {
  // Group by source, take top 5 most-frequent in the last 24h. Also
  // accumulate the set of distinct wallets affected per source so the
  // dashboard widget can show "affected: 3 wallets" without needing a
  // click-through. Boris's ask: "give me a little more info there like
  // the wallet / user name of the person persons affected".
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
      counts.set(e.source, {
        count: 1,
        latest: e,
        affected: actor ? new Set([actor]) : new Set<string>(),
      });
    }
  }
  const top5 = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Recent errors (24h)</h3>
        <Link href="/admin?tab=logs" className="text-[11px] text-gray-400 hover:text-white">
          See all →
        </Link>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {loading ? (
          <p className="px-4 py-6 text-center text-gray-500 text-xs">Loading errors…</p>
        ) : top5.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-500 text-xs">Nothing in the last 24 hours — quiet day.</p>
        ) : (
          top5.map(([source, { count, latest, affected }]) => {
            // Show up to the first 3 affected wallets as clickable chips
            // (each → User Lookup); collapse the rest into "+N more".
            const wallets = Array.from(affected);
            const shown = wallets.slice(0, 3);
            const extra = wallets.length - shown.length;
            return (
              <div key={source} className="px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                <Link
                  href={`/admin?tab=logs&source=${encodeURIComponent(source)}`}
                  className="block"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-[12px] font-mono text-amber-300 truncate">{source}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">{count}× · {wallets.length} {wallets.length === 1 ? 'wallet' : 'wallets'}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 truncate">{explainError(source, latest.message) || latest.message}</p>
                </Link>
                {shown.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {shown.map((w) => (
                      <WalletLink key={w} wallet={w} bare className="!text-[10px] !text-gray-400 hover:!text-banana" />
                    ))}
                    {extra > 0 && (
                      <span className="text-[10px] text-gray-500">+{extra} more</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * JP/HOF wheel-won draft pipeline — explicit per-stage breakdown so Boris
 * can see at a glance: "X drafts filling / Y mid-draft / Z completed"
 * for each special type. Answers his exact question "how many are
 * pending where filling, how many already finished".
 *
 * Side panel shows the unredeemed-entries totals (wheel wins users
 * earned but haven't joined a draft with yet) since those are the
 * upstream source of new queue activity.
 */
function WheelDraftsPipelineCard({
  wheelDrafts,
  reserved,
}: {
  wheelDrafts: MetricsResponse['wheelDrafts'];
  reserved: MetricsResponse['reservedDrafts'];
}) {
  const rows = [
    { label: 'Jackpot', data: wheelDrafts.jackpot, accent: 'text-red-400', bar: 'bg-red-500/70', pending: reserved.jackpot },
    { label: 'HOF', data: wheelDrafts.hof, accent: 'text-[#D4AF37]', bar: 'bg-[#D4AF37]/70', pending: reserved.hof },
  ];
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">JP / HOF drafts — pipeline (wheel-won only)</h3>
        <span className="text-[11px] text-gray-500">filling → drafting → completed</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {rows.map((row) => {
          const total = row.data.total;
          const pct = (n: number) => (total > 0 ? Math.max(2, Math.round((n / total) * 100)) : 0);
          return (
            <div key={row.label} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <span className={`text-sm font-semibold ${row.accent}`}>{row.label}</span>
                <span className="text-[11px] text-gray-400">
                  {row.data.filling} filling · {row.data.drafting} drafting · {row.data.completed} completed · {total} total
                </span>
              </div>
              {/* Stacked-bar visualization so the mix of filling / drafting
                  / completed reads at a glance without doing math. */}
              {total > 0 && (
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div className="h-full bg-yellow-400/70" style={{ width: `${pct(row.data.filling)}%` }} title="filling" />
                  <div className="h-full bg-blue-400/70" style={{ width: `${pct(row.data.drafting)}%` }} title="drafting" />
                  <div className="h-full bg-emerald-400/70" style={{ width: `${pct(row.data.completed)}%` }} title="completed" />
                </div>
              )}
              {row.pending > 0 && (
                <p className="mt-1.5 text-[11px] text-gray-500">
                  +{row.pending} {row.label} {row.pending === 1 ? 'entry is' : 'entries are'} sitting in user balances unredeemed
                  — they&apos;ll flow into &quot;filling&quot; as soon as those users hit Enter on /banana-wheel.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Free vs paid draft passes — at-a-glance ratio so Boris can see
 * "are we mostly giving them away or selling them". Free total is
 * derived from wheel wins (sum of prize.value across draft_pass spins,
 * bounded by the scan window the metrics endpoint uses).
 */
function FreeVsPaidCard({ freeFromWheel, paid }: { freeFromWheel: number; paid: number }) {
  const total = freeFromWheel + paid;
  const freePct = total > 0 ? (freeFromWheel / total) * 100 : 0;
  const paidPct = total > 0 ? (paid / total) * 100 : 0;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-white">Free vs paid draft passes</h3>
        <span className="text-[11px] text-gray-500">{total.toLocaleString()} total</span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-md border border-purple-500/30 bg-purple-500/[0.06] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-purple-300/80">Free (wheel wins)</p>
          <p className="text-xl font-bold text-purple-200 tabular-nums">{freeFromWheel.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{freePct.toFixed(1)}% of all passes</p>
        </div>
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Paid (card + USDC)</p>
          <p className="text-xl font-bold text-emerald-200 tabular-nums">{paid.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{paidPct.toFixed(1)}% of all passes</p>
        </div>
      </div>
      {/* Stacked bar visual. */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full bg-purple-400/80" style={{ width: `${freePct}%` }} title={`Free ${freePct.toFixed(1)}%`} />
        <div className="h-full bg-emerald-400/80" style={{ width: `${paidPct}%` }} title={`Paid ${paidPct.toFixed(1)}%`} />
      </div>
    </div>
  );
}

function LiveActivityWidget({ enabled }: { enabled: boolean }) {
  // Wraps the existing LiveActivity component with a card shell that
  // matches the rest of the dashboard. The component itself owns its
  // streaming state — we just give it a frame.
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Live activity</h3>
        {/* Open the full Live Activity view (table + filters + CSV export)
            living as the first sub-tab under Audit. */}
        <Link href="/admin?tab=audit&sub=live-activity" className="text-[11px] text-gray-400 hover:text-white">
          See all →
        </Link>
      </div>
      <div className="p-2 max-h-[480px] overflow-y-auto">
        <LiveActivity enabled={enabled} />
      </div>
    </div>
  );
}
