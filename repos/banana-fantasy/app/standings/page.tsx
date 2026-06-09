'use client';

import React, { useState, useMemo } from 'react';
import { TeamCard } from '@/components/standings/TeamCard';
import { LeagueDetailModal, type ModalTab } from '@/components/standings/LeagueDetailModal';
import { LeaderboardView } from '@/components/standings/LeaderboardView';
import { MultiChipSearch } from '@/components/ui/MultiChipSearch';
import { useAuth } from '@/hooks/useAuth';
import { useLeagues } from '@/hooks/useLeagues';
import { useGameweek } from '@/hooks/useStandings';
import { useTeamNicknames } from '@/hooks/useTeamNicknames';
import { useMyNfts, useNotOwnedLeagues } from '@/hooks/useMarketplace';
import { formatScore, formatRank } from '@/lib/formatters';
import type { League, ContestType } from '@/types';
import type { MarketplaceTeam } from '@/lib/opensea';

type ViewMode = 'myteams' | 'leaderboard';

/**
 * Build a League-shaped object from a marketplace NFT the user owns but did NOT
 * draft (e.g. bought on the marketplace). useLeagues only returns teams the user
 * drafted, so without this a bought team never appears in My Teams even though
 * the wallet owns the NFT. The card renders from this; clicking opens the real
 * league (when leagueId is known) via the same modal.
 */
function nftToSyntheticLeague(n: MarketplaceTeam): League {
  return {
    id: n.leagueId || `nft-${n.tokenId}`,
    name: n.name || `Team #${n.tokenId}`,
    contestId: '',
    type: (n.isJackpot ? 'jackpot' : n.isHof ? 'hof' : 'pro') as ContestType,
    // Only treat the NFT's RANK trait as a rank when it's a real 1-10 league
    // position — pre-season it holds the token id (e.g. 8742), not a rank.
    leagueRank: n.rank >= 1 && n.rank <= 10 ? n.rank : 0,
    weeklyRank: 0,
    weeklyScore: n.weeklyAvg || 0,
    seasonScore: n.points || 0,
    status: 'completed',
    roster: (n.roster || []).map((tp, i) => ({
      slot: `${i + 1}`,
      teamPosition: tp,
      weeklyPoints: 0,
      seasonPoints: 0,
    })),
    draftDate: '',
  };
}

export default function StandingsPage() {
  const { isLoggedIn, user } = useAuth();

  // Marketplace NFTs/listings for the logged-in user, mapped by leagueId so each
  // team card can offer inline List / Cancel with price + time-left.
  const { data: myNfts, refetch: refetchMyNfts, patchListing: patchMyNftListing } = useMyNfts(user?.walletAddress ?? null);
  const nftByLeague = useMemo(() => {
    const m = new Map<string, MarketplaceTeam>();
    for (const n of myNfts) {
      if (n.leagueId) m.set(n.leagueId, n);
      // Also key by the synthetic id so bought-not-drafted cards get their
      // List/Cancel controls + "bought for" price too.
      m.set(`nft-${n.tokenId}`, n);
    }
    return m;
  }, [myNfts]);

  const leaguesQueryRaw = useLeagues({ userId: user?.id, status: 'completed' });
  // Hide teams with no roster data (incomplete/corrupted drafts)
  const leaguesQuery = useMemo(() => ({
    ...leaguesQueryRaw,
    data: leaguesQueryRaw.data.filter(l => l.roster.length >= 15),
  }), [leaguesQueryRaw]);
  const { data: currentGameweek } = useGameweek();

  const leagues = leaguesQuery.data;

  // Leagues we can already confirm the wallet still owns (it holds the NFT).
  const ownedLeagueIds = useMemo(
    () => new Set(myNfts.filter(n => n.leagueId).map(n => n.leagueId as string)),
    [myNfts],
  );
  // Drafted leagues we can't confirm as owned → may have been sold. Verify these
  // on-chain (sold teams must NOT show in My Teams). We only check the ones not
  // already confirmed owned, so freshly-drafted teams OpenSea hasn't indexed yet
  // are checked too — and kept, because on-chain still says the wallet owns them.
  const candidateLeagueIds = useMemo(
    () => leagues.filter(l => !ownedLeagueIds.has(l.id)).map(l => l.id),
    [leagues, ownedLeagueIds],
  );
  const notOwnedLeagueIds = useNotOwnedLeagues(user?.walletAddress ?? null, candidateLeagueIds);

  // Teams to show = teams the user drafted + teams they own but didn't draft
  // (bought on the marketplace), minus any drafted team they've since sold.
  const mergedLeagues = useMemo(() => {
    const draftedIds = new Set(leagues.map(l => l.id));
    const extra: League[] = [];
    for (const n of myNfts) {
      // ONLY drafted teams belong on My Teams — NEVER undrafted draft passes.
      // A pass has no backend roster record (hasBackendRecord === false); a
      // drafted team has one (true/undefined). Without this we listed all 600+
      // owned passes as "Draft Pass #N" cards. (Wheel-won JP/HOF passes that are
      // mid-fill are the one exception — they're effectively teams.)
      if (n.hasBackendRecord === false && n.fillingWheelLevel == null) continue;
      const synthId = n.leagueId || `nft-${n.tokenId}`;
      if (draftedIds.has(synthId)) continue; // already shown as a drafted team
      extra.push(nftToSyntheticLeague(n));
    }
    const base = extra.length ? [...leagues, ...extra] : leagues;
    return notOwnedLeagueIds.size ? base.filter(l => !notOwnedLeagueIds.has(l.id)) : base;
  }, [leagues, myNfts, notOwnedLeagueIds]);

  const { nicknames, setNickname } = useTeamNicknames();

  const [viewMode, setViewMode] = useState<ViewMode>('myteams');

  // Switch to My Teams when auth loads (isLoggedIn starts false, becomes true after auth)
  React.useEffect(() => {
    if (isLoggedIn) setViewMode('myteams');
  }, [isLoggedIn]);

  const [gameweek, setGameweek] = useState<string>(currentGameweek);
  const [teamSearch, setTeamSearch] = useState<string[]>([]);
  const [teamsPage, setTeamsPage] = useState(0);
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest'>('newest');
  const [typeFilter, setTypeFilter] = useState<'all' | 'jackpot' | 'hof' | 'pro'>('all');

  // Closed list of valid filter chips: every team-position seen across
  // leagues + the type aliases (Jackpot/HOF/Pro). Restricts the chip
  // search so users can't type something that doesn't exist.
  const searchOptions = useMemo(() => {
    const set = new Set<string>();
    leagues.forEach(l => {
      l.roster.forEach(r => {
        if (r.teamPosition) set.add(r.teamPosition);
        const team = r.teamPosition.split(' ')[0];
        if (team) set.add(team);
      });
    });
    set.add('Jackpot');
    set.add('HOF');
    set.add('Pro');
    return [...set].sort();
  }, [leagues]);
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
    let result = [...mergedLeagues];

    // Type filter buttons
    if (typeFilter !== 'all') {
      result = result.filter((league) => league.type === typeFilter);
    }

    if (teamSearch.length > 0) {
      // AND across chips: every chip must match something on the league.
      const terms = teamSearch.map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);

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
    // Sort by League # — the user-facing monotonic number in the
    // displayName ("League #1201"). Higher league # = more recent draft.
    // The previous cardId-timestamp sort surfaced when the NFT was MINTED,
    // not when the draft was played — tokens minted months ago but used
    // in a recent draft sorted to the bottom, hiding the user's newest
    // results. League # increments per fill across the whole product, so
    // it's the right monotonic signal.
    //
    // Tie-breaker: slot id trailing digits, then leaving order stable.
    result.sort((a, b) => {
      const leagueNumA = parseInt(a.name.match(/#(\d+)/)?.[1] || '0', 10);
      const leagueNumB = parseInt(b.name.match(/#(\d+)/)?.[1] || '0', 10);
      if (leagueNumA !== leagueNumB) {
        return sortOrder === 'oldest' ? leagueNumA - leagueNumB : leagueNumB - leagueNumA;
      }
      const idNumA = parseInt(a.id.match(/(\d+)$/)?.[1] || '0', 10);
      const idNumB = parseInt(b.id.match(/(\d+)$/)?.[1] || '0', 10);
      return sortOrder === 'oldest' ? idNumA - idNumB : idNumB - idNumA;
    });
    return result;
  }, [mergedLeagues, teamSearch, sortOrder, typeFilter]);

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
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
            {viewMode === 'myteams' ? 'My Teams' : 'Standings'}
          </h1>
          <p className="text-white/40 text-sm">
            {viewMode === 'myteams' ? 'Track your teams and league performance' : 'View the global leaderboard'}
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
          {mergedLeagues.length > 0 && (
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
          {mergedLeagues.length > 0 && (
            <div className="mb-5">
              <MultiChipSearch
                chips={teamSearch}
                onChange={setTeamSearch}
                options={searchOptions}
                placeholder="Type a roster slot or type (e.g. CIN QB)"
                className="w-full"
              />
              {teamSearch.length > 1 && (
                <p className="text-white/20 text-[10px] mt-1 ml-1">Showing teams that match ALL filters</p>
              )}
            </div>
          )}

          {/* Type filter buttons */}
          {mergedLeagues.length > 0 && (
            <div className="flex gap-2 mb-5">
              {([
                { key: 'all', label: 'All', color: 'white' },
                { key: 'pro', label: `Pro (${typeBreakdown.pro})`, color: '#a855f7' },
                { key: 'jackpot', label: `Jackpot (${typeBreakdown.jackpot})`, color: '#ef4444' },
                { key: 'hof', label: `HOF (${typeBreakdown.hof})`, color: '#D4AF37' },
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
          {mergedLeagues.length > 0 && (
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedLeagues.map((league, i) => (
                      <TeamCard
                        key={league.id}
                        league={league}
                        onOpenModal={handleOpenModal}
                        index={i}
                        nickname={nicknames[league.id]}
                        onRename={setNickname}
                        walletAddress={user?.walletAddress}
                        marketplaceTeam={nftByLeague.get(league.id) ?? null}
                        onListed={(tokenId, orderHash, price) => { patchMyNftListing(tokenId, { orderHash, price }); setTimeout(() => refetchMyNfts(), 12000); }}
                        onCancelled={(tokenId) => { patchMyNftListing(tokenId, null); setTimeout(() => refetchMyNfts(), 12000); }}
                      />
                    ))}
                  </div>
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
                  <p className="text-white/40 text-sm">No teams match {teamSearch.map(t => `“${t}”`).join(' + ')}</p>
                  <button onClick={() => setTeamSearch([])} className="text-banana text-xs mt-1 hover:underline">Clear search</button>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!leaguesQuery.isValidating && mergedLeagues.length === 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center mb-8">
              <div className="text-4xl mb-4">🏈</div>
              <p className="text-white/50 font-medium mb-2">No teams yet</p>
              <p className="text-white/30 text-sm mb-6">Your drafted teams will show here.</p>
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
          imageUrl={nftByLeague.get(modalLeague.id)?.imageUrl ?? null}
          onClose={() => { setModalLeague(null); setModalInitialPlayer(undefined); }}
        />
      )}
    </div>
  );
}
