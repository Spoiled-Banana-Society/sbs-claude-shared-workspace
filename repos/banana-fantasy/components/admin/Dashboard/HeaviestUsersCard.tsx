'use client';

/**
 * "Heaviest users" — three side-by-side leaderboards: top spend, top
 * promos claimed, top wheel-spin wins. Computed server-side from the
 * v2_activity_events stream (bounded scan). Each wallet is a click
 * straight into User Lookup so investigation is one step away.
 *
 * Boris's ask: "data of users who spent the most money did the most
 * promos."
 */

import { useHeaviestUsers, type HeaviestUserEntry } from '@/hooks/admin/useAdminApi';
import { WalletLink } from '@/components/admin/WalletLink';

interface Props {
  enabled: boolean;
}

export function HeaviestUsersCard({ enabled }: Props) {
  const q = useHeaviestUsers(enabled);

  if (q.isLoading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-sm text-gray-400">Loading top users…</p>
      </div>
    );
  }
  if (q.isError || !q.data) return null;
  const data = q.data;
  if (data.uniqueUsers === 0) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Heaviest users</h3>
        <span className="text-[11px] text-gray-500">
          top 10 across {data.uniqueUsers.toLocaleString()} active wallets · scan window {data.scannedDocs.toLocaleString()} events
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.04]">
        <Leaderboard
          title="By spend"
          unit="USD"
          entries={data.topSpend}
          format={(e) => `$${e.spendUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
          sub={(e) => `${e.passesBought} pass${e.passesBought === 1 ? '' : 'es'}`}
          accent="text-emerald-300"
        />
        <Leaderboard
          title="By promos claimed"
          unit="claims"
          entries={data.topPromos.filter((e) => e.promosClaimed > 0)}
          format={(e) => e.promosClaimed.toLocaleString()}
          sub={(e) => `${e.spinsWon} spins · $${e.spendUsd.toLocaleString()}`}
          accent="text-pink-300"
        />
        <Leaderboard
          title="By wheel wins"
          unit="spins"
          entries={data.topSpins.filter((e) => e.spinsWon > 0)}
          format={(e) => e.spinsWon.toLocaleString()}
          sub={(e) => `${e.promosClaimed} promos · $${e.spendUsd.toLocaleString()}`}
          accent="text-[#F3E216]"
        />
      </div>
    </div>
  );
}

function Leaderboard({
  title,
  unit,
  entries,
  format,
  sub,
  accent,
}: {
  title: string;
  unit: string;
  entries: HeaviestUserEntry[];
  format: (e: HeaviestUserEntry) => string;
  sub: (e: HeaviestUserEntry) => string;
  accent: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wider text-gray-500">{title}</p>
        <p className="text-[10px] text-gray-600">{unit}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-gray-500 py-2">No data in this window.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e, i) => (
            <li key={e.userId} className="flex items-center justify-between gap-3 group">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[10px] text-gray-500 tabular-nums w-4">{i + 1}.</span>
                <div className="min-w-0">
                  {e.username ? (
                    <p className="text-xs text-white truncate">{e.username}</p>
                  ) : null}
                  <WalletLink wallet={e.userId} bare className="!text-[10px] !text-gray-500 hover:!text-banana" />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-xs font-semibold tabular-nums ${accent}`}>{format(e)}</p>
                <p className="text-[10px] text-gray-600">{sub(e)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
