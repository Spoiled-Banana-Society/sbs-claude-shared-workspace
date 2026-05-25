'use client';

/**
 * Teams & Leagues — every league this user has a team in, with roster,
 * current rank, scores, and prize info. Sourced server-side from the
 * Go drafts API (`/league/all/{wallet}/draftTokenLeaderboard/...`).
 *
 * Boris's ask: "want everything about a user to get the best full
 * picture — their leagues, teams, money on them, standings when
 * contest starts." This section is that.
 */

import { useMemo, useState } from 'react';
import type { UserLookupResponse } from '@/hooks/admin/useUserLookup';

type Team = NonNullable<UserLookupResponse['teams']>[number];

interface Props {
  teams: NonNullable<UserLookupResponse['teams']> | null;
}

function levelColor(level: string): string {
  const l = level.toLowerCase();
  if (l === 'jackpot') return 'text-red-300';
  if (l === 'hof') return 'text-[#D4AF37]';
  return 'text-purple-300';
}

function levelBg(level: string): string {
  const l = level.toLowerCase();
  if (l === 'jackpot') return 'bg-red-500/10 ring-red-500/30';
  if (l === 'hof') return 'bg-[#D4AF37]/10 ring-[#D4AF37]/30';
  return 'bg-purple-500/10 ring-purple-500/30';
}

function fmtRank(rank: number | null, total: number | null): string {
  if (rank == null) return '—';
  if (total) return `#${rank} / ${total}`;
  return `#${rank}`;
}

export function TeamsLeaguesSection({ teams }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [levelFilter, setLevelFilter] = useState<'all' | 'jackpot' | 'hof' | 'pro'>('all');

  const summary = useMemo(() => {
    if (!teams) return null;
    const out = {
      total: teams.length,
      byLevel: { jackpot: 0, hof: 0, pro: 0 } as Record<string, number>,
      totalSeasonScore: 0,
      totalPrizeWon: 0,
      totalPrizePool: 0,
      bestRank: null as { rank: number; total: number | null; league: string | null } | null,
    };
    for (const t of teams) {
      const l = t.leagueLevel.toLowerCase();
      if (l === 'jackpot') out.byLevel.jackpot += 1;
      else if (l === 'hof') out.byLevel.hof += 1;
      else out.byLevel.pro += 1;
      out.totalSeasonScore += t.seasonScore;
      if (t.prizeWon) out.totalPrizeWon += t.prizeWon;
      if (t.prizePool) out.totalPrizePool += t.prizePool;
      if (t.seasonRank != null) {
        if (!out.bestRank || t.seasonRank < out.bestRank.rank) {
          out.bestRank = {
            rank: t.seasonRank,
            total: t.totalEntrants,
            league: t.leagueNumber ? `#${t.leagueNumber}` : null,
          };
        }
      }
    }
    return out;
  }, [teams]);

  if (teams === null) {
    return (
      <Card>
        <Header>
          <span className="text-[11px] text-amber-300">Go API unreachable</span>
        </Header>
        <p className="mt-2 text-xs text-gray-400">
          Live league + roster data is fetched server-side from the Go drafts API.
          It&apos;s offline or timed out for this lookup. The Drafts section below
          still reflects the user&apos;s entry history from activity events.
        </p>
      </Card>
    );
  }

  if (teams.length === 0) {
    return (
      <Card>
        <Header>
          <span className="text-[11px] text-gray-500">No teams yet</span>
        </Header>
        <p className="mt-2 text-xs text-gray-500">
          This user hasn&apos;t finalized any draft yet. Once they complete a draft
          their roster appears here with live scores once the contest starts.
        </p>
      </Card>
    );
  }

  const filtered = teams.filter((t) => {
    if (levelFilter === 'all') return true;
    return t.leagueLevel.toLowerCase() === levelFilter;
  });

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <Header>
        <span className="text-[11px] text-gray-400">
          {summary?.total ?? 0} teams · ${summary?.totalPrizeWon.toLocaleString()} won{summary?.totalPrizePool ? ` · $${summary.totalPrizePool.toLocaleString()} in pools` : ''}
        </span>
      </Header>

      {/* Summary tiles */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Tile label="Total teams" value={summary?.total ?? 0} />
        <Tile
          label="By level"
          value={
            <span className="text-[13px] tabular-nums">
              <span className="text-red-300">{summary?.byLevel.jackpot ?? 0}</span>
              <span className="text-gray-600"> · </span>
              <span className="text-[#D4AF37]">{summary?.byLevel.hof ?? 0}</span>
              <span className="text-gray-600"> · </span>
              <span className="text-purple-300">{summary?.byLevel.pro ?? 0}</span>
            </span>
          }
          sublabel="JP · HOF · Pro"
        />
        <Tile
          label="Total season pts"
          value={summary?.totalSeasonScore.toFixed(1) ?? '0.0'}
          accent="text-emerald-300"
        />
        <Tile
          label="Best rank"
          value={summary?.bestRank ? fmtRank(summary.bestRank.rank, summary.bestRank.total) : '—'}
          sublabel={summary?.bestRank?.league ?? undefined}
          accent="text-amber-300"
        />
      </dl>

      {/* Level filter chips */}
      <div className="mt-3 flex items-center gap-1.5 overflow-x-auto">
        {(['all', 'jackpot', 'hof', 'pro'] as const).map((k) => {
          const active = levelFilter === k;
          const count =
            k === 'all' ? teams.length :
            k === 'jackpot' ? summary?.byLevel.jackpot ?? 0 :
            k === 'hof' ? summary?.byLevel.hof ?? 0 :
            summary?.byLevel.pro ?? 0;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setLevelFilter(k)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                active
                  ? 'bg-banana text-black border-banana font-semibold'
                  : count === 0
                    ? 'border-white/[0.06] text-gray-600'
                    : 'border-white/[0.08] text-gray-300 hover:text-white hover:border-white/[0.20]'
              }`}
            >
              {k === 'all' ? 'All' : k.toUpperCase()}
              <span className={`ml-1.5 ${active ? 'text-black/70' : 'text-gray-500'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Per-team rows */}
      <ul className="mt-3 space-y-1.5">
        {filtered.map((t) => {
          const isExpanded = expanded.has(t.draftId);
          const hasRoster = t.roster.length > 0;
          return (
            <li key={t.draftId} className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
              <button
                type="button"
                onClick={() => hasRoster && toggleExpand(t.draftId)}
                className={`w-full px-3 py-2 flex items-center gap-3 text-xs text-left ${hasRoster ? 'hover:bg-white/[0.03] cursor-pointer' : 'cursor-default'}`}
                aria-expanded={isExpanded}
              >
                <span className={`shrink-0 rounded-full ring-1 px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold ${levelBg(t.leagueLevel)} ${levelColor(t.leagueLevel)}`}>
                  {t.leagueLevel}
                </span>
                <span className="text-gray-200 font-medium">
                  League {t.leagueNumber != null ? `#${t.leagueNumber}` : t.draftId.slice(0, 8)}
                </span>
                {t.draftSpeed && (
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    {t.draftSpeed}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-3 tabular-nums">
                  {t.seasonScore > 0 && (
                    <span className="text-emerald-300" title="Season points">
                      {t.seasonScore.toFixed(1)} pts
                    </span>
                  )}
                  {t.seasonRank != null && (
                    <span className="text-amber-300" title="Current rank">
                      {fmtRank(t.seasonRank, t.totalEntrants)}
                    </span>
                  )}
                  {t.prizeWon != null && t.prizeWon > 0 && (
                    <span className="text-emerald-300 font-semibold" title="Prize won">
                      +${t.prizeWon.toLocaleString()}
                    </span>
                  )}
                  {!t.prizeWon && t.prizePool != null && t.prizePool > 0 && (
                    <span className="text-gray-500" title="League prize pool">
                      ${t.prizePool.toLocaleString()} pool
                    </span>
                  )}
                  {hasRoster && (
                    <span className="text-gray-500 text-[10px]">
                      {isExpanded ? '▼' : '▶'} {t.roster.length}
                    </span>
                  )}
                </div>
              </button>
              {isExpanded && hasRoster && (
                <div className="border-t border-white/[0.04] px-3 py-2 bg-black/20">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
                    Roster ({t.roster.length} picks)
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
                    {[...t.roster].sort((a, b) => a.pickNum - b.pickNum).map((p, i) => (
                      <div
                        key={`${t.draftId}-${i}`}
                        className="flex items-center gap-1.5 rounded bg-white/[0.02] px-1.5 py-1 text-[11px]"
                      >
                        <span className="text-gray-500 tabular-nums w-5 text-right">
                          {p.pickNum || i + 1}
                        </span>
                        <span className="text-white font-medium">{p.team}</span>
                        <span className="text-gray-400 ml-auto">{p.position}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Tile({
  label,
  value,
  accent,
  sublabel,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${accent ?? 'text-white'}`}>
        {value}
      </dd>
      {sublabel && <p className="text-[9px] uppercase tracking-wider text-gray-600 mt-0.5">{sublabel}</p>}
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
        Teams & Leagues
      </h3>
      {children}
    </div>
  );
}

// Suppress unused-vars on Team type — it's referenced via the
// NonNullable indexed-access alias above so TypeScript flags it.
// Marking it `export type` puts it in the public surface for any
// future consumer that wants the per-team row type.
export type { Team };
