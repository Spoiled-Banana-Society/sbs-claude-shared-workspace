'use client';

/**
 * Heaviest users — three leaderboards in one card.
 *
 * Apple-clean rewrite (May 2026). Each list uses hairline dividers,
 * tabular numerals, and a single accent per metric. No bars, no
 * percentages — just the rank + name + number.
 *
 * Boris's ask: "data of users who spent the most money did the most
 * promos." Every wallet is clickable into User Lookup.
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
      <Section title="Heaviest users">
        <Card>
          <p className="px-5 py-4 text-sm text-gray-400">Loading…</p>
        </Card>
      </Section>
    );
  }
  if (q.isError || !q.data || q.data.uniqueUsers === 0) return null;
  const data = q.data;

  return (
    <Section title="Heaviest users" sub={`top 10 · ${data.uniqueUsers.toLocaleString()} active wallets`}>
      <Card>
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
          sub={(e) => `${e.spinsWon} spins · $${Math.round(e.spendUsd).toLocaleString()}`}
          accent="text-pink-300"
        />
        <Leaderboard
          title="By wheel wins"
          unit="spins"
          entries={data.topSpins.filter((e) => e.spinsWon > 0)}
          format={(e) => e.spinsWon.toLocaleString()}
          sub={(e) => `${e.promosClaimed} promos · $${Math.round(e.spendUsd).toLocaleString()}`}
          accent="text-[#F3E216]"
        />
      </Card>
    </Section>
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
    <div className="px-5 py-4 border-b border-white/[0.06] last:border-0">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        <p className="text-[10px] uppercase tracking-wider text-gray-500">{unit}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-gray-500 py-1">No data in scan window.</p>
      ) : (
        <ul>
          {entries.map((e, i) => (
            <li
              key={e.userId}
              className="flex items-center justify-between gap-3 py-2 border-b border-white/[0.04] last:border-0"
            >
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[11px] text-gray-500 tabular-nums w-4 shrink-0">{i + 1}.</span>
                <div className="min-w-0">
                  {e.username && <p className="text-xs text-white truncate">{e.username}</p>}
                  <WalletLink wallet={e.userId} bare className="!text-[10px] !text-gray-500 hover:!text-banana" />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-semibold tabular-nums ${accent}`}>{format(e)}</p>
                <p className="text-[10px] text-gray-500">{sub(e)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
