'use client';

/**
 * Day-at-a-glance stat band — the six buckets Boris tracks (purchases, new
 * accounts, spins, wheel winnings, drafts filled, promos claimed), each as
 * TODAY (since 3 AM PT) with the since-launch total underneath.
 *
 * Single source of truth: /api/admin/activity/stats (same endpoint that
 * powers the Audit → Live Activity cards), computed server-side over the
 * full event record. Rendered on the Dashboard so the day's picture lives
 * where Boris looks first; the Audit tab keeps its own copy wired to the
 * live event stream.
 */

import React, { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

interface StatsBucket {
  purchases: number; passesBought: number; purchaseUsd: number;
  newAccounts: number; returningNewAccounts: number;
  web2NewAccounts: number; web3NewAccounts: number; logins: number;
  spins: number; freeDraftsWonFromSpins: number; jpPassesFromSpins: number; hofPassesFromSpins: number;
  draftsFilled: number; draftEntries: number; promosClaimed: number;
}
interface ActivityStats { dayStartIso: string; today: StatsBucket; total: StatsBucket }

const POLL_MS = 30_000;

function StatCard({ label, value, sub, sub2 }: { label: string; value: string; sub?: string; sub2?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-white mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
      {sub2 && <p className="text-[10px] text-gray-600 mt-0.5">{sub2}</p>}
    </div>
  );
}

export function ActivityStatCards({ enabled }: { enabled: boolean }) {
  const { getAccessToken } = usePrivy();
  const [stats, setStats] = useState<ActivityStats | null>(null);

  // Ref the token getter so the poll effect never refires on Privy
  // re-renders. See render-loop rule (CLAUDE.md Rule #0).
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => { getAccessTokenRef.current = getAccessToken; }, [getAccessToken]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const token = await getAccessTokenRef.current();
        const res = await fetch('/api/admin/activity/stats', {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (res.ok && !cancelled) setStats(await res.json() as ActivityStats);
      } catch { /* keep last-known stats */ }
    };
    void load();
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled]);

  const dayLabel = stats?.dayStartIso
    ? `Today (since ${new Date(stats.dayStartIso).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'America/Los_Angeles' })} PT)`
    : 'Today';

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{dayLabel}</p>
        <p className="text-[10px] text-gray-600">all-time = since launch (Jun 23) · live-updating</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <StatCard
          label="Purchases"
          value={stats ? stats.today.purchases.toString() : '…'}
          sub={stats
            ? `${stats.today.passesBought} passes · $${stats.today.purchaseUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} — all-time ${stats.total.passesBought} · $${stats.total.purchaseUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            : 'loading'}
        />
        <StatCard
          label="New accounts"
          value={stats ? stats.today.newAccounts.toString() : '…'}
          sub={stats
            ? `${stats.today.newAccounts - stats.today.returningNewAccounts} new · ${stats.today.returningNewAccounts} returning · ${stats.today.web2NewAccounts} gmail / ${stats.today.web3NewAccounts} wallet`
            : 'loading'}
          sub2={stats
            ? `${stats.today.logins} log-ins today — all-time ${stats.total.newAccounts} (${stats.total.returningNewAccounts} ret · ${stats.total.web2NewAccounts} gmail / ${stats.total.web3NewAccounts} wallet)`
            : undefined}
        />
        <StatCard
          label="Spins"
          value={stats ? stats.today.spins.toString() : '…'}
          sub={stats ? `all-time ${stats.total.spins}` : 'loading'}
        />
        <StatCard
          label="Won from spins"
          value={stats ? stats.today.freeDraftsWonFromSpins.toString() : '…'}
          sub={stats
            ? `free drafts${(stats.today.jpPassesFromSpins + stats.today.hofPassesFromSpins) > 0 ? ` +${stats.today.jpPassesFromSpins}JP/${stats.today.hofPassesFromSpins}HOF` : ''} — all-time ${stats.total.freeDraftsWonFromSpins} (+${stats.total.jpPassesFromSpins}JP/${stats.total.hofPassesFromSpins}HOF)`
            : 'loading'}
        />
        <StatCard
          label="Drafts filled"
          value={stats ? stats.today.draftsFilled.toString() : '…'}
          sub={stats ? `${stats.today.draftEntries} seats entered — all-time ${stats.total.draftsFilled} filled` : 'loading'}
        />
        <StatCard
          label="Promos claimed"
          value={stats ? stats.today.promosClaimed.toString() : '…'}
          sub={stats ? `all-time ${stats.total.promosClaimed}` : 'loading'}
        />
      </div>
    </div>
  );
}
