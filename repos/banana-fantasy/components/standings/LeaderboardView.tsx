'use client';

import React, { useState, useMemo } from 'react';
import { formatScore } from '@/lib/formatters';
import { fetchJson } from '@/lib/appApiClient';
import { useSWRLike } from '@/hooks/useSWRLike';
import { useLeagueDetail } from '@/hooks/useStandings';
import type { LeaderboardEntry } from '@/types';

interface LeaderboardViewProps {
  gameweek: string;
  onOpenLeagueDetail?: (draftId: string, options?: { tab?: string; wallet?: string }) => void;
}

type LevelFilter = 'all' | 'Pro' | 'HOF' | 'Jackpot';
type SortField = 'SeasonScore' | 'WeekScore';

const filterPills: { id: LevelFilter; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: 'bg-white/10 text-white/70 hover:bg-white/20' },
  { id: 'Pro', label: 'Pro', color: 'bg-pro/20 text-pro hover:bg-pro/30' },
  { id: 'HOF', label: 'HOF', color: 'bg-hof/20 text-hof hover:bg-hof/30' },
  { id: 'Jackpot', label: 'Jackpot', color: 'bg-jackpot/20 text-jackpot hover:bg-jackpot/30' },
];

const PAGE_SIZE = 20;

export function LeaderboardView({ gameweek, onOpenLeagueDetail }: LeaderboardViewProps) {
  const [level, setLevel] = useState<LevelFilter>('all');
  const [sortField, setSortField] = useState<SortField>('SeasonScore');
  const [page, setPage] = useState(0);
  const [leagueInput, setLeagueInput] = useState('');
  const [leagueLookup, setLeagueLookup] = useState<string | null>(null);

  const cacheKey = `leaderboard:${gameweek}:${level}:${sortField}`;
  const { data: entries, isValidating } = useSWRLike<LeaderboardEntry[]>(
    cacheKey,
    ({ signal }) =>
      fetchJson<LeaderboardEntry[]>('/api/leaderboard', {
        signal,
        query: { gameweek, level, orderBy: sortField, limit: '200' },
      }),
    { fallbackData: [] },
  );

  // Client-side pagination
  const totalPages = Math.ceil((entries?.length ?? 0) / PAGE_SIZE);
  const pageEntries = useMemo(() => {
    const start = page * PAGE_SIZE;
    return (entries || []).slice(start, start + PAGE_SIZE);
  }, [entries, page]);

  // League lookup — fetch specific league standings
  const { data: leagueStandings, isValidating: leagueLookupLoading } = useLeagueDetail(leagueLookup, gameweek);

  const leagueEntries = useMemo(() => {
    return (leagueStandings || []).map((entry: unknown, idx: number) => {
      if (typeof entry !== 'object' || !entry) {
        return { rank: idx + 1, displayName: '-', weeklyScore: 0, seasonScore: 0, isCurrentUser: false };
      }
      const e = entry as Record<string, unknown>;
      return {
        rank: typeof e.rank === 'number' ? e.rank : idx + 1,
        displayName: String(e.displayName || e.ownerWallet || e.cardId || '-').slice(0, 20),
        ownerWallet: String(e.ownerWallet || e.cardId || ''),
        weeklyScore: Number(e.weeklyScore ?? e.weekScore ?? e.scoreWeek ?? 0),
        seasonScore: Number(e.seasonScore ?? e.scoreSeason ?? 0),
        isCurrentUser: Boolean(e.isCurrentUser),
        pickCount: typeof e.pickCount === 'number' ? e.pickCount : undefined,
        roster: Array.isArray(e.roster) ? e.roster as string[] : undefined,
        leagueLevel: typeof e.leagueLevel === 'string' ? e.leagueLevel : typeof e.level === 'string' ? e.level : undefined,
      };
    });
  }, [leagueStandings]);

  // Reset page when filter changes
  const handleLevelChange = (l: LevelFilter) => {
    setLevel(l);
    setPage(0);
  };

  const handleLeagueLookup = () => {
    const raw = leagueInput.trim();
    if (!raw) {
      setLeagueLookup(null);
      return;
    }
    // Support full draft IDs
    if (raw.includes('draft-')) {
      setLeagueLookup(raw);
      return;
    }
    // Extract just the number from input like "league 7", "#7", "League #7", or just "7"
    const numMatch = raw.match(/(\d+)/);
    if (!numMatch) {
      setLeagueLookup(null);
      return;
    }
    setLeagueLookup(`2025-fast-draft-${numMatch[1]}`);
  };

  const clearLeagueLookup = () => {
    setLeagueLookup(null);
    setLeagueInput('');
  };

  return (
    <div>
      {/* Filter pills + sort toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-2">
          {filterPills.map((pill) => (
            <button
              key={pill.id}
              onClick={() => handleLevelChange(pill.id)}
              className={`
                text-xs font-semibold px-3 py-1.5 rounded-full transition-all
                ${level === pill.id
                  ? pill.id === 'all'
                    ? 'bg-white/20 text-white ring-1 ring-white/30'
                    : `${pill.color} ring-1 ring-current/30`
                  : 'bg-white/[0.04] text-white/40 hover:text-white/60'
                }
              `}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-0.5">
          <button
            onClick={() => { setSortField('SeasonScore'); setPage(0); }}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              sortField === 'SeasonScore' ? 'bg-banana text-black font-semibold' : 'text-white/50 hover:text-white/70'
            }`}
          >
            Season
          </button>
          <button
            onClick={() => { setSortField('WeekScore'); setPage(0); }}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              sortField === 'WeekScore' ? 'bg-banana text-black font-semibold' : 'text-white/50 hover:text-white/70'
            }`}
          >
            Weekly
          </button>
        </div>
      </div>

      {/* League lookup */}
      <div className="flex items-center gap-2 mb-5">
        <div className="relative flex-1 max-w-xs">
          <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            value={leagueInput}
            onChange={(e) => setLeagueInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLeagueLookup(); }}
            placeholder="Look up league # (e.g. 42)"
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-banana/40 focus:ring-1 focus:ring-banana/20 transition-colors"
          />
        </div>
        <button
          onClick={handleLeagueLookup}
          className="text-xs px-4 py-2 rounded-xl bg-banana text-black font-semibold hover:bg-banana-dark transition-colors"
        >
          Look Up
        </button>
        {leagueLookup && (
          <button
            onClick={clearLeagueLookup}
            className="text-xs px-3 py-2 rounded-xl bg-white/[0.06] text-white/50 hover:text-white/70 transition-colors"
          >
            Back to Global
          </button>
        )}
      </div>

      {/* League lookup results */}
      {leagueLookup && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-white font-semibold text-sm">League #{leagueLookup?.match(/(\d+)$/)?.[1] || leagueInput.trim()}</h3>
              {leagueEntries.length > 0 && leagueEntries[0].leagueLevel && (() => {
                const lvl = String(leagueEntries[0].leagueLevel).toLowerCase();
                const isJP = lvl.includes('jackpot');
                const isHOF = lvl.includes('hof') || lvl.includes('hall');
                return (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    isJP ? 'bg-jackpot/20 text-jackpot' : isHOF ? 'bg-hof/20 text-hof' : 'bg-pro/20 text-pro'
                  }`}>
                    {isJP ? 'Jackpot' : isHOF ? 'HOF' : 'Pro'}
                  </span>
                );
              })()}
            </div>
            {leagueEntries.length > 0 && onOpenLeagueDetail && (
              <button
                onClick={() => onOpenLeagueDetail(leagueLookup, { tab: 'board' })}
                className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white/80 font-medium transition-colors bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1.5 rounded-lg border border-white/[0.06]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
                Draft Board
              </button>
            )}
          </div>
          {leagueLookupLoading && leagueEntries.length === 0 && (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          )}
          {!leagueLookupLoading && leagueEntries.length === 0 && (
            <div className="text-center py-8 rounded-xl border border-white/[0.04] bg-white/[0.02]">
              <p className="text-white/40 text-sm">League not found or no standings yet</p>
              <p className="text-white/25 text-xs mt-1">Check the league number and try again</p>
            </div>
          )}
          {leagueEntries.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="grid grid-cols-[28px_1fr] sm:grid-cols-[36px_1fr_80px_80px] gap-2 px-3 sm:px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
                <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium">#</div>
                <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium">Player</div>
                <div className="hidden sm:block text-[10px] uppercase tracking-wider text-white/30 font-medium text-right">Weekly</div>
                <div className="hidden sm:block text-[10px] uppercase tracking-wider text-white/30 font-medium text-right">Season</div>
              </div>
              <div>
                {leagueEntries.map((entry, idx) => {
                  // Prize won from API — will be populated once season scoring is live
                  const prizeWon = Number((entry as Record<string, unknown>).prizeWon ?? 0);
                  return (
                  <React.Fragment key={idx}>
                    <div
                      onClick={() => onOpenLeagueDetail?.(leagueLookup, { wallet: entry.ownerWallet })}
                      className={`
                        grid grid-cols-[28px_1fr] sm:grid-cols-[36px_1fr_80px_80px] gap-2 px-3 sm:px-4 py-2.5 items-center transition-colors cursor-pointer
                        ${entry.isCurrentUser ? 'bg-banana/[0.08] hover:bg-banana/[0.12]' : 'hover:bg-white/[0.04]'}
                      `}
                    >
                      <div>
                        {entry.rank <= 2 ? (
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            entry.rank === 1 ? 'bg-banana text-black' :
                            'bg-white/80 text-black'
                          }`}>{entry.rank}</span>
                        ) : (
                          <span className="text-white/40 text-sm">{entry.rank}</span>
                        )}
                      </div>
                      <div className={`flex items-center gap-1.5 min-w-0 ${entry.isCurrentUser ? 'text-banana' : 'text-white/80'}`}>
                        <span className="text-sm font-medium truncate">
                          {entry.displayName}
                        </span>
                        {entry.isCurrentUser && <span className="text-[10px] text-banana/60 flex-shrink-0">(You)</span>}
                        {prizeWon > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 flex-shrink-0">${prizeWon}</span>
                        )}
                      </div>
                      <div className="hidden sm:block text-right text-white/50 text-sm">
                        {entry.weeklyScore > 0 ? formatScore(entry.weeklyScore) : <span className="text-white/15">—</span>}
                      </div>
                      <div className={`hidden sm:block text-right font-semibold text-sm ${entry.isCurrentUser ? 'text-banana' : 'text-white/70'}`}>
                        {entry.seasonScore > 0 ? formatScore(entry.seasonScore) : <span className="text-white/15">—</span>}
                      </div>
                    </div>

                    {/* Advance line between rank 2 and 3 */}
                    {entry.rank === 2 && leagueEntries.length > 2 && (
                      <div className="flex items-center gap-2 px-4 py-1.5">
                        <div className="flex-1 h-px bg-green-500/30" />
                        <span className="text-[9px] uppercase tracking-wider text-green-500/50 font-medium">Advance</span>
                        <div className="flex-1 h-px bg-green-500/30" />
                      </div>
                    )}
                  </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Global leaderboard (hidden when viewing league lookup) */}
      {leagueLookup ? null : <>

      {/* Loading skeleton */}
      {isValidating && (!entries || entries.length === 0) && (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      )}

      {/* Table */}
      {pageEntries.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[40px_1fr_80px_80px] sm:grid-cols-[50px_1fr_100px_100px] gap-2 px-4 py-3 bg-white/[0.03] border-b border-white/[0.06]">
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium">#</div>
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium">Player</div>
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium text-right">Weekly</div>
            <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium text-right">Season</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-white/[0.04]">
            {pageEntries.map((entry, idx) => (
              <div
                key={`${entry.rank}-${idx}`}
                className={`
                  grid grid-cols-[40px_1fr_80px_80px] sm:grid-cols-[50px_1fr_100px_100px] gap-2 px-4 py-3 items-center transition-colors
                  ${entry.isCurrentUser ? 'bg-banana/[0.08]' : 'hover:bg-white/[0.03]'}
                `}
              >
                {/* Rank */}
                <div>
                  {entry.rank <= 3 ? (
                    <span
                      className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                        ${entry.rank === 1 ? 'bg-yellow-500 text-black' : ''}
                        ${entry.rank === 2 ? 'bg-gray-400 text-black' : ''}
                        ${entry.rank === 3 ? 'bg-orange-600 text-white' : ''}
                      `}
                    >
                      {entry.rank}
                    </span>
                  ) : (
                    <span className="text-white/50 text-sm">{entry.rank}</span>
                  )}
                </div>

                {/* Player */}
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${entry.isCurrentUser ? 'text-banana' : 'text-white'}`}>
                    {entry.username}
                    {entry.isCurrentUser && <span className="ml-1.5 text-[10px] text-banana/60">(You)</span>}
                  </p>
                  {entry.teamName && (
                    <p className="text-white/30 text-xs truncate">{entry.teamName}</p>
                  )}
                </div>

                {/* Weekly */}
                <div className="text-right text-white/60 text-sm">
                  {formatScore(entry.weeklyScore)}
                </div>

                {/* Season */}
                <div className={`text-right font-semibold text-sm ${entry.isCurrentUser ? 'text-banana' : 'text-white'}`}>
                  {formatScore(entry.seasonScore)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isValidating && pageEntries.length === 0 && (
        <div className="text-center py-12">
          <p className="text-white/40">No leaderboard data available</p>
          <p className="text-white/25 text-xs mt-1">Scores will appear once gameweek scoring completes</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/50 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Prev
          </button>
          <span className="text-white/40 text-xs">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/50 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}

      </>}
    </div>
  );
}
