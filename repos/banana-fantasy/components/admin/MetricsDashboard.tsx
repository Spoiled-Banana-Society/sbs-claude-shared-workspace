'use client';

import { useEffect, useState } from 'react';
import { useAdminMetrics, AdminApiError } from '@/hooks/admin/useAdminApi';

function Card({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 backdrop-blur">
      <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? 'text-white'}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub ? <p className="text-[11px] text-gray-500 mt-1">{sub}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 tracking-wide">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{children}</div>
    </section>
  );
}

export function MetricsDashboard({ enabled }: { enabled: boolean }) {
  const query = useAdminMetrics(enabled);
  const m = query.data;
  const [tick, setTick] = useState(0);

  // Re-render "Xs ago" ticker every second — the query itself only refetches
  // via the Refresh button (auto-poll removed to stop burning Firestore reads)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSec = m?.generatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(m.generatedAt).getTime()) / 1000))
    : null;
  void tick;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Live Metrics</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Manual refresh ·{' '}
            {query.isError
              ? 'error loading'
              : query.isFetching
                ? 'refreshing…'
                : ageSec !== null
                  ? `updated ${ageSec}s ago`
                  : 'loading…'}
          </p>
        </div>
        <button
          onClick={() => query.refetch()}
          className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs"
        >
          ↻ Refresh now
        </button>
      </div>

      {query.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3">
          {(query.error as AdminApiError)?.message || 'Failed to load metrics'}
        </div>
      )}

      {m && (
        <>
          <Section title="Users">
            <Card label="Total users" value={m.users.total} />
            <Card label="New today" value={m.users.newToday} accent="text-green-400" />
            <Card label="New this week" value={m.users.newThisWeek} accent="text-green-400" />
            <Card label="Verified (BlueCheck)" value={m.users.verified} />
            <Card label="X linked" value={m.users.xLinked} />
          </Section>

          <Section title="Engagement">
            <Card label="Signups today" value={m.engagement.signupsToday} accent="text-green-400" />
            <Card label="Signups this week" value={m.engagement.signupsThisWeek} />
            <Card label="Logins today" value={m.engagement.loginsToday} accent="text-blue-400" />
            <Card label="Logins this week" value={m.engagement.loginsThisWeek} />
          </Section>

          <Section title="Banana Wheel">
            <Card label="Total spins" value={m.wheel.totalSpins} />
            <Card label="Spins today" value={m.wheel.spinsToday} accent="text-[#F3E216]" />
            <Card label="Jackpots hit" value={m.wheel.jackpotHits} accent="text-red-400" />
            <Card label="HOF hit" value={m.wheel.hofHits} accent="text-[#D4AF37]" />
            <Card label="Draft-pass wins" value={m.wheel.draftPassAwards} />
            <Card label="Draft passes awarded" value={m.wheel.draftPassesAwardedTotal} sub="sum over last 500 spins" />
          </Section>

          <Section title="Promos & Shares">
            <Card label="Promos claimed today" value={m.promos.promoClaimsToday} accent="text-green-400" />
            <Card label="X shares verified" value={m.promos.sharesVerifiedTotal} />
            <Card label="Shares today" value={m.promos.sharesVerifiedToday} accent="text-green-400" />
            <Card label="Shares that earned credit" value={m.promos.sharesEarnedCredit} />
          </Section>

          <Section title="Referrals">
            <Card label="Referral codes active" value={m.referrals.totalCodes} />
          </Section>

          <Section title="Withdrawals">
            <Card label="Pending" value={m.withdrawals.pending} accent="text-yellow-400" />
            <Card label="Approved" value={m.withdrawals.approved} accent="text-green-400" />
            <Card label="Denied" value={m.withdrawals.denied} />
            <Card label="Total volume" value={`$${m.withdrawals.totalVolume.toLocaleString()}`} sub="approved + pending" />
          </Section>

          <Section title="Special Draft Queues">
            <Card label="In queue (all)" value={m.drafts.queued} />
            <Card label="Jackpot queue" value={m.drafts.jackpotQueueSize} accent="text-red-400" />
            <Card label="HOF queue" value={m.drafts.hofQueueSize} accent="text-[#D4AF37]" />
          </Section>
        </>
      )}
    </div>
  );
}
