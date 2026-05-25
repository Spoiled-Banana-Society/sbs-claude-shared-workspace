'use client';

/**
 * Dashboard — clean Apple-style overview.
 *
 * Design principles (May 2026 rewrite after Boris's "no graphs" feedback):
 *   - Numbers are the hero (tabular-nums, large, color-restricted)
 *   - Hairline dividers (white/[0.06]) instead of bars / sparklines / pies
 *   - Dense tables for breakdowns — every row reads in one line
 *   - One accent per metric domain (banana yellow primary, otherwise gray)
 *   - Generous card padding but ZERO wasted vertical space
 *   - Live data confirmation visible at the top (subtle, never noisy)
 *
 * Sections in order:
 *   1. Health bar (one line, dismissible color)
 *   2. Today (5 KPI tiles)
 *   3. All time (5 KPI tiles)
 *   4. Passes — paid vs free vs total
 *   5. Wheel wins by prize (table)
 *   6. JP / HOF drafts pipeline (table)
 *   7. Promos popularity + conversion (table + stale starters list)
 *   8. Signup rails (table)
 *   9. Heaviest users (3-column leaderboards) + Withdrawals by age
 *  10. Recent errors + Live activity
 *
 * Every number is live from /api/admin/metrics, /api/admin/promo-progress,
 * /api/admin/heaviest-users, /api/admin/error-events, /api/admin/withdrawals
 * (all polling on intervals — 10–60s depending on cost).
 */

import Link from 'next/link';
import {
  useAdminMetrics,
  useRecentErrors,
  type ErrorEventEntry,
  type MetricsResponse,
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
  const m = metricsQ.data;
  const errors = errorsQ.data?.errors ?? [];

  const health = computeHealth(errors, m?.withdrawals.pending);
  const ageSec = m?.generatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(m.generatedAt).getTime()) / 1000))
    : null;

  return (
    <div className="space-y-6">
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

      {m && (
        <>
          <TodaySection m={m} />
          <AllTimeSection m={m} />
          <PassesSection m={m} />
          <WheelWinsSection m={m} />
          <WheelDraftsSection m={m} />
          <PromosSection m={m} />
        </>
      )}

      <PromoProgressCard enabled={enabled} />

      {m && <SignupRailsSection m={m} />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <HeaviestUsersCard enabled={enabled} />
        <WithdrawalAgingCard enabled={enabled} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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
    <div className={`rounded-2xl border ${palette.border} ${palette.bg} px-5 py-3.5 flex items-center justify-between gap-4`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className={`inline-block w-2 h-2 rounded-full ${palette.dot} ${health.level !== 'ok' ? 'animate-pulse' : ''}`} />
        <span className={`text-sm font-semibold ${palette.text}`}>{palette.label}</span>
        <span className="text-sm text-gray-400 truncate">{health.reason}</span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-gray-500 shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${fetching ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
          {fetching
            ? 'refreshing…'
            : ageSec !== null
              ? `live · ${ageSec}s ago · auto 10s`
              : 'loading…'}
        </span>
        <button
          onClick={onRefresh}
          className="text-gray-400 hover:text-white"
          title="Refresh now"
        >
          ↻
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────  KPI tiles  */

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

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] ${className}`}>
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent = 'text-white',
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
}) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${accent}`}>{display}</p>
      {sub && <p className="mt-1.5 text-[11px] text-gray-500 leading-tight">{sub}</p>}
    </div>
  );
}

function TodaySection({ m }: { m: MetricsResponse }) {
  return (
    <Section title="Today">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Signups" value={m.engagement.signupsToday} sub={`${m.engagement.signupsThisWeek} this week`} />
        <Kpi label="Logins" value={m.engagement.loginsToday} sub={`${m.engagement.loginsThisWeek} this week`} accent="text-blue-300" />
        <Kpi label="Wheel spins" value={m.wheel.spinsToday} sub={`${m.wheel.totalSpins.toLocaleString()} all-time`} accent="text-[#F3E216]" />
        <Kpi
          label="Pending withdrawals"
          value={m.withdrawals.pending}
          sub={`$${m.withdrawals.totalVolume.toLocaleString()} approved + pending`}
          accent={m.withdrawals.pending > 0 ? 'text-amber-300' : 'text-white'}
        />
        <Kpi label="Promos claimed" value={m.promos.promoClaimsToday} sub={`${m.promos.sharesVerifiedToday} shares verified`} accent="text-green-300" />
      </div>
    </Section>
  );
}

function AllTimeSection({ m }: { m: MetricsResponse }) {
  return (
    <Section title="All time">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Total users" value={m.users.total} sub={`+${m.users.newToday} today / +${m.users.newThisWeek} this week`} />
        <Kpi label="Total spins" value={m.lifetime.wheelSpins} sub="every spin ever" accent="text-[#F3E216]" />
        <Kpi label="Passes purchased" value={m.lifetime.passesPurchased} sub="card + USDC mints" accent="text-emerald-300" />
        <Kpi label="Promos claimed" value={m.lifetime.promosClaimed} sub="across all promo types" accent="text-pink-300" />
        <Kpi label="Withdrawals paid" value={`$${m.lifetime.withdrawalsPaidVolume.toLocaleString()}`} sub={`${m.lifetime.draftsCompleted.toLocaleString()} drafts completed`} accent="text-green-300" />
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Passes  */

function PassesSection({ m }: { m: MetricsResponse }) {
  const free = m.totalFreeDraftsFromWheel;
  const paid = m.lifetime.passesPurchased;
  const total = free + paid;
  const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0');
  return (
    <Section title="Passes">
      <Card>
        <div className="px-5 pt-4 pb-1 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">Free vs paid</h4>
          <p className="text-[11px] text-gray-500">all-time</p>
        </div>
        <div className="px-5 pb-3">
          <DataRow label="Paid" sub="card + USDC mints" value={paid} percent={pct(paid)} accent="text-emerald-300" />
          <DataRow label="Free" sub="wheel wins" value={free} percent={pct(free)} accent="text-purple-300" />
          <div className="border-t border-white/[0.06] mt-1 pt-2 pb-1">
            <DataRow label="Total" value={total} bold />
          </div>
        </div>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Wheel wins  */

function WheelWinsSection({ m }: { m: MetricsResponse }) {
  const rows = Object.entries(m.wheelPrizeBreakdown).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  if (rows.length === 0) return null;
  // Color hints by prize family.
  const accentFor = (label: string) =>
    /jackpot/i.test(label) ? 'text-red-300'
    : /hof/i.test(label) ? 'text-[#D4AF37]'
    : /nothing/i.test(label) ? 'text-gray-400'
    : 'text-purple-300';
  return (
    <Section title="Wheel wins" sub={`last ${total.toLocaleString()} spins`}>
      <Card>
        <div className="px-5 pt-4 pb-2">
          {rows.map(([label, count]) => (
            <DataRow
              key={label}
              label={label}
              value={count}
              percent={total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'}
              accent={accentFor(label)}
            />
          ))}
          <div className="border-t border-white/[0.06] mt-1 pt-2 pb-2">
            <DataRow
              label="Total free drafts given"
              sub="sum of prize values across draft-pass spins"
              value={m.totalFreeDraftsFromWheel}
              bold
              accent="text-purple-300"
            />
          </div>
        </div>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  JP/HOF drafts  */

function WheelDraftsSection({ m }: { m: MetricsResponse }) {
  const jp = m.wheelDrafts.jackpot;
  const hof = m.wheelDrafts.hof;
  if (jp.total === 0 && hof.total === 0 && m.reservedDrafts.jackpot === 0 && m.reservedDrafts.hof === 0) {
    return null;
  }
  return (
    <Section title="JP / HOF drafts" sub="wheel-won only · separate from regular 5% / 1% distribution">
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-5 pt-4 pb-2 text-left font-medium">Type</th>
              <th className="pt-4 pb-2 text-right font-medium">Filling</th>
              <th className="pt-4 pb-2 text-right font-medium">Drafting</th>
              <th className="pt-4 pb-2 text-right font-medium">Done</th>
              <th className="pt-4 pb-2 text-right font-medium">Total</th>
              <th className="px-5 pt-4 pb-2 text-right font-medium">Unredeemed</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t border-white/[0.06]">
              <td className="px-5 py-2.5 text-sm font-semibold text-red-300">Jackpot</td>
              <td className="py-2.5 text-right text-gray-300">{jp.filling.toLocaleString()}</td>
              <td className="py-2.5 text-right text-gray-300">{jp.drafting.toLocaleString()}</td>
              <td className="py-2.5 text-right text-emerald-300">{jp.completed.toLocaleString()}</td>
              <td className="py-2.5 text-right text-white font-semibold">{jp.total.toLocaleString()}</td>
              <td className="px-5 py-2.5 text-right text-gray-300">{m.reservedDrafts.jackpot.toLocaleString()}</td>
            </tr>
            <tr className="border-t border-white/[0.06]">
              <td className="px-5 py-2.5 text-sm font-semibold text-[#D4AF37]">HOF</td>
              <td className="py-2.5 text-right text-gray-300">{hof.filling.toLocaleString()}</td>
              <td className="py-2.5 text-right text-gray-300">{hof.drafting.toLocaleString()}</td>
              <td className="py-2.5 text-right text-emerald-300">{hof.completed.toLocaleString()}</td>
              <td className="py-2.5 text-right text-white font-semibold">{hof.total.toLocaleString()}</td>
              <td className="px-5 py-2.5 text-right text-gray-300">{m.reservedDrafts.hof.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <p className="px-5 pt-2 pb-4 text-[11px] text-gray-500">
          Unredeemed = wheel wins users earned but haven&apos;t entered a draft with yet.
        </p>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Promos popularity  */

function PromosSection({ m }: { m: MetricsResponse }) {
  const rows = Object.entries(m.promoBreakdown).sort((a, b) => b[1].claimsTotal - a[1].claimsTotal);
  if (rows.length === 0) return null;
  return (
    <Section title="Promos — popularity">
      <Card>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-gray-500">
            <tr>
              <th className="px-5 pt-4 pb-2 text-left font-medium">Type</th>
              <th className="pt-4 pb-2 text-right font-medium">Today</th>
              <th className="px-5 pt-4 pb-2 text-right font-medium">Lifetime</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map(([type, c]) => (
              <tr key={type} className="border-t border-white/[0.06]">
                <td className="px-5 py-2.5 text-white capitalize">{type.replace(/_/g, ' ')}</td>
                <td className="py-2.5 text-right text-emerald-300">{c.claimsToday.toLocaleString()}</td>
                <td className="px-5 py-2.5 text-right text-gray-200">{c.claimsTotal.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Signup rails  */

function SignupRailsSection({ m }: { m: MetricsResponse }) {
  const segments: { key: keyof MetricsResponse['users']['byWalletType']; label: string; sub: string; accent: string }[] = [
    { key: 'privy_embedded', label: 'Social login', sub: 'Privy embedded wallet (Gmail / X / etc.)', accent: 'text-blue-300' },
    { key: 'privy_external', label: 'Privy + external wallet', sub: 'Privy session, user linked their own wallet', accent: 'text-purple-300' },
    { key: 'external_connect', label: 'Crypto wallet direct', sub: 'MetaMask / Coinbase Wallet / etc., no Privy', accent: 'text-emerald-300' },
    { key: 'unknown', label: 'Unknown', sub: 'signed up before walletType was recorded', accent: 'text-gray-400' },
  ];
  const total = m.users.total;
  const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0');
  return (
    <Section title="Signup rails" sub={`lifetime · ${total.toLocaleString()} users`}>
      <Card>
        <div className="px-5 pt-4 pb-2">
          {segments
            .filter((s) => m.users.byWalletType[s.key] > 0)
            .map((s) => (
              <DataRow
                key={s.key}
                label={s.label}
                sub={s.sub}
                value={m.users.byWalletType[s.key]}
                percent={pct(m.users.byWalletType[s.key])}
                accent={s.accent}
              />
            ))}
        </div>
      </Card>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────  Data row primitive  */

/**
 * Single data row used inside every table-style card. Three columns:
 * label (+ optional sub), value, %. Hairline divider between rows is
 * handled by the parent's mb spacing. Apple Health / Stocks-style.
 */
function DataRow({
  label,
  sub,
  value,
  percent,
  accent = 'text-white',
  bold = false,
}: {
  label: string;
  sub?: string;
  value: number | string;
  percent?: string;
  accent?: string;
  bold?: boolean;
}) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0">
        <p className={`text-sm ${bold ? 'font-semibold text-white' : 'text-gray-200'} capitalize`}>{label}</p>
        {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
      </div>
      <div className="flex items-baseline gap-3 shrink-0">
        <span className={`text-base tabular-nums ${bold ? 'font-bold' : 'font-semibold'} ${accent}`}>{display}</span>
        {percent !== undefined && (
          <span className="text-[11px] text-gray-500 tabular-nums w-12 text-right">{percent}%</span>
        )}
      </div>
    </div>
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
      counts.set(e.source, {
        count: 1,
        latest: e,
        affected: actor ? new Set([actor]) : new Set<string>(),
      });
    }
  }
  const top5 = [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);

  return (
    <Card>
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Recent errors · last 24h</h3>
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
              <div key={source} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <Link href={`/admin?tab=logs&source=${encodeURIComponent(source)}`} className="block">
                  <div className="flex items-baseline justify-between gap-3 mb-1">
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
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
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
  );
}

function LiveActivityWidget({ enabled }: { enabled: boolean }) {
  return (
    <Card>
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Live activity</h3>
        <Link href="/admin?tab=audit&sub=live-activity" className="text-[11px] text-gray-400 hover:text-white">See all →</Link>
      </div>
      <div className="p-2 max-h-[480px] overflow-y-auto">
        <LiveActivity enabled={enabled} />
      </div>
    </Card>
  );
}
