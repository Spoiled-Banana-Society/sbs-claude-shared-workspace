'use client';

import React, { useState, useMemo } from 'react';
import { TeamCard } from '@/components/standings/TeamCard';
import { LeagueDetailModal, type ModalTab } from '@/components/standings/LeagueDetailModal';
import { LeaderboardView } from '@/components/standings/LeaderboardView';
import { useAuth } from '@/hooks/useAuth';
import { useLeagues } from '@/hooks/useLeagues';
import { useGameweek } from '@/hooks/useStandings';
import { formatScore, formatRank } from '@/lib/formatters';
import type { League } from '@/types';

type ViewMode = 'myteams' | 'leaderboard';

export default function StandingsPage() {
  const { isLoggedIn, user } = useAuth();
  const leaguesQueryRaw = useLeagues({ userId: user?.id, status: 'completed' });
  // Hide teams with no roster data (incomplete/corrupted drafts)
  const leaguesQuery = useMemo(() => ({
    ...leaguesQueryRaw,
    data: leaguesQueryRaw.data.filter(l => l.roster.length >= 15),
  }), [leaguesQueryRaw]);
  const { data: currentGameweek } = useGameweek();

  const leagues = leaguesQuery.data;

  const [viewMode, setViewMode] = useState<ViewMode>('myteams');

  // Switch to My Teams when auth loads (isLoggedIn starts false, becomes true after auth)
  React.useEffect(() => {
    if (isLoggedIn) setViewMode('myteams');
  }, [isLoggedIn]);

  const [gameweek, setGameweek] = useState<string>(currentGameweek);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamsPage, setTeamsPage] = useState(0);
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest'>('newest');
  const [typeFilter, setTypeFilter] = useState<'all' | 'jackpot' | 'hof' | 'pro'>('all');
  const TEAMS_PER_PAGE = 20;

  // Modal state
  const [modalLeague, setModalLeague] = useState<League | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('roster');
  const [modalInitialPlayer, setModalInitialPlayer] = useState<string | undefined>();

  // Update gameweek when API returns
  React.useEffect(() => {
    if (currentGameweek && currentGameweek !== '2025REG-01') {
      setGameweek(currentGameweek);
    }
  }, [currentGameweek]);

  // Summary stats (portfolio card)
  const summaryStats = useMemo(() => {
    const totalTeams = leagues.length;
    const bestRank = leagues.reduce((best, l) => {
      if (l.leagueRank > 0 && (best === 0 || l.leagueRank < best)) return l.leagueRank;
      return best;
    }, 0);
    const totalSeasonScore = leagues.reduce((sum, l) => sum + l.seasonScore, 0);
    const totalWinnings = leagues.reduce((sum, l) => sum + (l.prizeIndicator ?? 0), 0);
    return { totalTeams, bestRank, totalSeasonScore, totalWinnings };
  }, [leagues]);

  // Generate gameweek options (REG weeks 1-18)
  const gameweekOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let i = 1; i <= 18; i++) {
      const val = `2025REG-${String(i).padStart(2, '0')}`;
      opts.push({ value: val, label: `Week ${i}` });
    }
    return opts;
  }, []);

  // Filter by search query, type filter, and sort by league number
  const filteredLeagues = useMemo(() => {
    let result = [...leagues];

    // Type filter buttons
    if (typeFilter !== 'all') {
      result = result.filter((league) => league.type === typeFilter);
    }

    if (teamSearch.trim()) {
      // Split by comma for multi-term search (AND logic)
      const terms = teamSearch.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);

      const typeAliases: Record<string, string> = {
        'jp': 'jackpot', 'jackpot': 'jackpot',
        'hof': 'hof', 'hall of fame': 'hof',
        'pro': 'pro',
      };

      result = result.filter((league) => {
        // Every term must match something on this league (AND)
        return terms.every(q => {
          const matchedType = typeAliases[q];
          if (matchedType && league.type === matchedType) return true;
          if (league.name.toLowerCase().includes(q)) return true;
          if (league.id.toLowerCase().includes(q)) return true;
          const numMatch = league.name.match(/#(\d+)/);
          if (numMatch && numMatch[1].includes(q)) return true;
          if (league.roster.some(p => p.teamPosition.toLowerCase().includes(q) || p.slot.toLowerCase().includes(q))) return true;
          return false;
        });
      });
    }
    // Sort by league number
    result.sort((a, b) => {
      const numA = parseInt(a.id.match(/(\d+)$/)?.[1] || '0', 10);
      const numB = parseInt(b.id.match(/(\d+)$/)?.[1] || '0', 10);
      return sortOrder === 'oldest' ? numA - numB : numB - numA;
    });
    return result;
  }, [leagues, teamSearch, sortOrder, typeFilter]);

  // Paginate
  const totalTeamPages = Math.ceil(filteredLeagues.length / TEAMS_PER_PAGE);
  const paginatedLeagues = useMemo(() => {
    const start = teamsPage * TEAMS_PER_PAGE;
    return filteredLeagues.slice(start, start + TEAMS_PER_PAGE);
  }, [filteredLeagues, teamsPage]);

  // Reset page when search or filter changes
  React.useEffect(() => { setTeamsPage(0); }, [teamSearch, typeFilter]);

  const handleOpenModal = (league: League, tab: ModalTab) => {
    setModalLeague(league);
    setModalTab(tab);
  };

  const handleOpenLeagueFromLookup = (draftId: string, options?: { tab?: string; wallet?: string }) => {
    const leagueNum = draftId.match(/(\d+)$/)?.[1] || draftId;
    setModalLeague({
      id: draftId,
      name: `League #${leagueNum}`,
      contestId: '',
      type: 'regular',
      leagueRank: 0,
      weeklyRank: 0,
      weeklyScore: 0,
      seasonScore: 0,
      status: 'completed',
      roster: [],
      draftDate: '',
    });
    setModalTab((options?.tab as ModalTab) || 'roster');
    setModalInitialPlayer(options?.wallet);
  };

  // Draft type breakdown for portfolio card
  const typeBreakdown = useMemo(() => {
    const counts = { jackpot: 0, hof: 0, pro: 0 };
    leagues.forEach((l) => {
      if (l.type === 'jackpot') counts.jackpot++;
      else if (l.type === 'hof') counts.hof++;
      else counts.pro++;
    });
    return counts;
  }, [leagues]);

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-5xl mx-auto">
      {/* Page header with toggle + gameweek selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">Standings</h1>
          <p className="text-white/40 text-sm">
            {isLoggedIn ? 'Track your teams and league performance' : 'View the global leaderboard'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Gameweek selector */}
          <select
            value={gameweek}
            onChange={(e) => setGameweek(e.target.value)}
            className="bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/70 focus:outline-none focus:ring-1 focus:ring-banana/40 appearance-none cursor-pointer"
          >
            {gameweekOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-bg-primary text-white">
                {opt.label}
              </option>
            ))}
          </select>

          {/* My Teams / Leaderboard toggle */}
          {isLoggedIn && (
            <div className="flex bg-white/[0.04] rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('myteams')}
                className={`text-sm px-4 py-2 rounded-md font-medium transition-colors ${
                  viewMode === 'myteams'
                    ? 'bg-banana text-black'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                My Teams
              </button>
              <button
                onClick={() => setViewMode('leaderboard')}
                className={`text-sm px-4 py-2 rounded-md font-medium transition-colors ${
                  viewMode === 'leaderboard'
                    ? 'bg-banana text-black'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                Leaderboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MY TEAMS VIEW */}
      {isLoggedIn && viewMode === 'myteams' && (
        <>
          {/* Portfolio Summary Card */}
          {leagues.length > 0 && (
            <div className="glass-card px-5 py-5 sm:px-6 sm:py-6 mb-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                {/* Total teams with type breakdown */}
                <div>
                  <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Teams</p>
                  <p className="text-white font-bold text-2xl">{summaryStats.totalTeams}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {typeBreakdown.jackpot > 0 && (
                      <span className="text-[10px] text-jackpot font-medium">{typeBreakdown.jackpot} JP</span>
                    )}
                    {typeBreakdown.hof > 0 && (
                      <span className="text-[10px] text-hof font-medium">{typeBreakdown.hof} HOF</span>
                    )}
                    {typeBreakdown.pro > 0 && (
                      <span className="text-[10px] text-pro font-medium">{typeBreakdown.pro} Pro</span>
                    )}
                  </div>
                </div>

                {/* Best rank */}
                <div>
                  <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Best Rank</p>
                  <div className="flex items-center gap-2">
                    {summaryStats.bestRank > 0 && summaryStats.bestRank <= 3 && (
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        summaryStats.bestRank === 1 ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-black shadow-lg shadow-yellow-500/20' :
                        summaryStats.bestRank === 2 ? 'bg-gradient-to-br from-gray-300 to-gray-500 text-black shadow-lg shadow-gray-400/20' :
                        'bg-gradient-to-br from-orange-400 to-orange-700 text-white shadow-lg shadow-orange-500/20'
                      }`}>
                        {summaryStats.bestRank}
                      </div>
                    )}
                    <p className="text-white font-bold text-2xl">
                      {summaryStats.bestRank > 0 ? formatRank(summaryStats.bestRank) : '-'}
                    </p>
                  </div>
                </div>

                {/* Total season score */}
                <div>
                  <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Total Score</p>
                  <p className="text-banana font-bold text-2xl">{formatScore(summaryStats.totalSeasonScore)}</p>
                </div>

                {/* Total winnings */}
                <div>
                  <p className="text-white/40 text-[11px] uppercase tracking-wider mb-1">Winnings</p>
                  <p className={`font-bold text-2xl ${summaryStats.totalWinnings > 0 ? 'text-green-400' : 'text-white/30'}`}>
                    {summaryStats.totalWinnings > 0 ? `$${summaryStats.totalWinnings}` : '-'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Search bar */}
          {leagues.length > 0 && (
            <div className="relative mb-5">
              <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Search roster, type, or league # — use commas for AND (e.g. CIN QB, CIN WR)"
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-banana/40 focus:ring-1 focus:ring-banana/20 transition-colors"
              />
              {teamSearch && (
                <button
                  onClick={() => setTeamSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              )}
              {teamSearch && teamSearch.includes(',') && (
                <p className="text-white/20 text-[10px] mt-1 ml-1">Showing teams that match ALL terms</p>
              )}
            </div>
          )}

          {/* Type filter buttons */}
          {leagues.length > 0 && (
            <div className="flex gap-2 mb-5">
              {([
                { key: 'all', label: 'All', color: 'white' },
                { key: 'jackpot', label: `Jackpot (${typeBreakdown.jackpot})`, color: '#ef4444' },
                { key: 'hof', label: `HOF (${typeBreakdown.hof})`, color: '#D4AF37' },
                { key: 'pro', label: `Pro (${typeBreakdown.pro})`, color: '#a855f7' },
              ] as const).map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => setTypeFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    typeFilter === key
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
                  }`}
                  style={typeFilter === key && key !== 'all' ? { borderColor: color, color } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Loading skeleton */}
          {leaguesQuery.isValidating && leagues.length === 0 && (
            <div className="space-y-3 mb-8">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          )}

          {/* Team cards */}
          {leagues.length > 0 && (
            <div className="space-y-3 mb-6">
              {filteredLeagues.length > 0 ? (
                <>
                  {/* Count + sort toggle */}
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="text-white/30 text-xs">
                      {filteredLeagues.length} {filteredLeagues.length === 1 ? 'team' : 'teams'}
                    </p>
                    <button
                      onClick={() => setSortOrder(prev => prev === 'oldest' ? 'newest' : 'oldest')}
                      className="text-white/30 text-xs hover:text-white/60 transition-colors"
                    >
                      {sortOrder === 'oldest' ? 'Oldest first ↑' : 'Newest first ↓'}
                    </button>
                  </div>
                  {paginatedLeagues.map((league, i) => (
                    <TeamCard
                      key={league.id}
                      league={league}
                      onOpenModal={handleOpenModal}
                      index={i}
                    />
                  ))}
                  {/* Pagination */}
                  {totalTeamPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <button
                        onClick={() => setTeamsPage(Math.max(0, teamsPage - 1))}
                        disabled={teamsPage === 0}
                        className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/50 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Prev
                      </button>
                      <span className="text-white/40 text-xs">
                        {teamsPage + 1} / {totalTeamPages}
                      </span>
                      <button
                        onClick={() => setTeamsPage(Math.min(totalTeamPages - 1, teamsPage + 1))}
                        disabled={teamsPage >= totalTeamPages - 1}
                        className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/50 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 rounded-xl border border-white/[0.04] bg-white/[0.02]">
                  <p className="text-white/40 text-sm">No teams match &ldquo;{teamSearch}&rdquo;</p>
                  <button onClick={() => setTeamSearch('')} className="text-banana text-xs mt-1 hover:underline">Clear search</button>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!leaguesQuery.isValidating && leagues.length === 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center mb-8">
              <div className="text-4xl mb-4">🏈</div>
              <p className="text-white/50 font-medium mb-2">No teams yet</p>
              <p className="text-white/30 text-sm mb-6">Draft to get started!</p>
              <a
                href="/"
                className="inline-block px-6 py-2.5 bg-banana text-black font-semibold rounded-xl hover:bg-banana-dark transition-colors"
              >
                Start Drafting
              </a>
            </div>
          )}
        </>
      )}

      {/* LEADERBOARD VIEW */}
      {(viewMode === 'leaderboard' || !isLoggedIn) && (
        <LeaderboardView gameweek={gameweek} onOpenLeagueDetail={handleOpenLeagueFromLookup} />
      )}

      {/* League Detail Modal */}
      {modalLeague && (
        <LeagueDetailModal
          league={modalLeague}
          initialTab={modalTab}
          initialPlayer={modalInitialPlayer}
          walletAddress={user?.walletAddress ?? ''}
          onClose={() => { setModalLeague(null); setModalInitialPlayer(undefined); }}
        />
      )}
    </div>
  );
}
