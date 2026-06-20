'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { TeamCard } from '@/components/standings/TeamCard';
import { LeagueDetailModal, type ModalTab } from '@/components/standings/LeagueDetailModal';
import { LeaderboardView } from '@/components/standings/LeaderboardView';
import { MultiChipSearch } from '@/components/ui/MultiChipSearch';
import { useAuth } from '@/hooks/useAuth';
import { useLeagues } from '@/hooks/useLeagues';
import { useGameweek } from '@/hooks/useStandings';
import { useTeamNicknames } from '@/hooks/useTeamNicknames';
import { useMyNfts, useNotOwnedLeagues } from '@/hooks/useMarketplace';
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
    // A wheel-won JP/HOF pass isn't stamped JP/HOF in its NFT metadata until the
    // draft reveals, so isHof/isJackpot are false while it's filling — fall back to
    // the known wheel level so it shows as HOF/Jackpot (badge, filter, gold art).
    type: ((n.isJackpot || n.fillingWheelLevel === 'jackpot') ? 'jackpot'
      : (n.isHof || n.fillingWheelLevel === 'hof') ? 'hof'
      : 'pro') as ContestType,
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
  const { isLoggedIn, isLoading: authLoading, user } = useAuth();

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

  // Live updates: revalidate teams + NFTs when the tab regains focus, so a team
  // drafted elsewhere shows up here without a manual refresh. Ref pattern keeps
  // the listener stable (no fetch-per-render — see CLAUDE.md render-loop rule).
  const refetchMyNftsRef = React.useRef(refetchMyNfts);
  refetchMyNftsRef.current = refetchMyNfts;
  const mutateLeaguesRef = React.useRef(leaguesQueryRaw.mutate);
  mutateLeaguesRef.current = leaguesQueryRaw.mutate;
  React.useEffect(() => {
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void refetchMyNftsRef.current?.();
      void mutateLeaguesRef.current?.();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []);

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
  const [leagueQuery, setLeagueQuery] = useState('');
  const [teamQuery, setTeamQuery] = useState('');
  const [teamsPage, setTeamsPage] = useState(0);
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest'>('newest');
  // Type filter persists in the URL (?type=jackpot) so a refresh / hard refresh
  // keeps you on the same tab instead of bouncing back to All.
  const [typeFilter, setTypeFilter] = useState<'all' | 'jackpot' | 'hof' | 'pro'>(() => {
    if (typeof window === 'undefined') return 'all';
    const t = new URLSearchParams(window.location.search).get('type');
    return t === 'jackpot' || t === 'hof' || t === 'pro' ? t : 'all';
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (typeFilter === 'all') url.searchParams.delete('type');
    else url.searchParams.set('type', typeFilter);
    window.history.replaceState(null, '', url.toString());
  }, [typeFilter]);

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

  // Filter by search query, type filter, and sort by league number
  const filteredLeagues = useMemo(() => {
    let result = [...mergedLeagues];

    // Type filter buttons
    if (typeFilter !== 'all') {
      result = result.filter((league) => league.type === typeFilter);
    }

    // League # query — partial match on the league's display number.
    const lq = leagueQuery.trim().replace(/^#/, '');
    if (lq) {
      result = result.filter((league) => (league.name.match(/#\s*(\d+)/)?.[1] ?? '').includes(lq));
    }

    // Team # query — partial match on the team's on-chain token id (Team #).
    const tq = teamQuery.trim().replace(/^#/, '');
    if (tq) {
      result = result.filter((league) => String(nftByLeague.get(league.id)?.tokenId ?? '').includes(tq));
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
  }, [mergedLeagues, teamSearch, sortOrder, typeFilter, leagueQuery, teamQuery, nftByLeague]);

  // Paginate
  const totalTeamPages = Math.ceil(filteredLeagues.length / TEAMS_PER_PAGE);
  const paginatedLeagues = useMemo(() => {
    const start = teamsPage * TEAMS_PER_PAGE;
    return filteredLeagues.slice(start, start + TEAMS_PER_PAGE);
  }, [filteredLeagues, teamsPage]);

  // Reset page when search or filter changes
  React.useEffect(() => { setTeamsPage(0); }, [teamSearch, typeFilter, leagueQuery, teamQuery]);

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
  // Count from mergedLeagues — the teams the user CURRENTLY owns (drafted teams
  // minus any whose NFT is no longer on-chain-owned by this wallet). This is the
  // exact set rendered, so the chip totals always match the list (no more
  // "All (33)" over "21 teams"), and the counts reflect real current ownership.
  const typeBreakdown = useMemo(() => {
    const counts = { jackpot: 0, hof: 0, pro: 0 };
    mergedLeagues.forEach((l) => {
      if (l.type === 'jackpot') counts.jackpot++;
      else if (l.type === 'hof') counts.hof++;
      else counts.pro++;
    });
    return counts;
  }, [mergedLeagues]);

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-5xl mx-auto">
      {/* Page header — pure My Teams for now. The Week selector + My Teams /
          Leaderboard toggle return when the season starts (scores exist). */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {viewMode === 'myteams' ? 'Teams' : 'Standings'}
          </h1>
          {viewMode !== 'myteams' && (
            <p className="text-white/40 text-sm mt-1">View the global leaderboard</p>
          )}
        </div>
        {/* Exposure + Marketplace — on the right of the Teams header, same spot
            and treatment as Rankings on the drafting page. Exposure is a view
            of this same roster; Marketplace is where you buy/sell these teams. */}
        {viewMode === 'myteams' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/marketplace"
              className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
            >
              Marketplace
            </Link>
            <Link
              href="/exposure"
              className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
            >
              Exposure
            </Link>
          </div>
        )}
      </div>

      {/* MY TEAMS VIEW — also render while auth is still rehydrating on refresh
          (authLoading), so the page keeps the My Teams layout instead of briefly
          flashing the leaderboard before isLoggedIn flips true. */}
      {(isLoggedIn || authLoading) && viewMode === 'myteams' && (
        <>
          {/* Type filters + roster search — one clean row */}
          {mergedLeagues.length > 0 && (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
                <div className="flex gap-2 flex-shrink-0">
                  {([
                    { key: 'all', label: `All (${typeBreakdown.pro + typeBreakdown.jackpot + typeBreakdown.hof})`, color: 'white' },
                    { key: 'pro', label: `Pro (${typeBreakdown.pro})`, color: '#a855f7' },
                    { key: 'jackpot', label: `Jackpot (${typeBreakdown.jackpot})`, color: '#ef4444' },
                    { key: 'hof', label: `HOF (${typeBreakdown.hof})`, color: '#D4AF37' },
                  ] as const).map(({ key, label, color }) => (
                    <button
                      key={key}
                      onClick={() => setTypeFilter(key)}
                      className={`px-4 py-2 rounded-[10px] text-[13px] font-medium transition-all border ${
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
                {/* Search group — right-aligned on desktop (aligns to the card grid's
                    right edge), full-width stack on mobile. */}
                <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
                  <div className="flex-1 sm:flex-none sm:w-[220px] min-w-0">
                    <MultiChipSearch
                      chips={teamSearch}
                      onChange={setTeamSearch}
                      options={searchOptions}
                      placeholder="Roster slot"
                      className="w-full"
                    />
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={leagueQuery}
                    onChange={(e) => setLeagueQuery(e.target.value)}
                    placeholder="League #"
                    className="w-[96px] sm:w-[110px] flex-shrink-0 px-3 py-2 rounded-[10px] bg-white/[0.03] border border-white/[0.06] text-[13px] font-medium text-white placeholder:text-white/40 focus:border-banana/50 hover:bg-white/[0.06] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={teamQuery}
                    onChange={(e) => setTeamQuery(e.target.value)}
                    placeholder="Team #"
                    className="w-[88px] sm:w-[110px] flex-shrink-0 px-3 py-2 rounded-[10px] bg-white/[0.03] border border-white/[0.06] text-[13px] font-medium text-white placeholder:text-white/40 focus:border-banana/50 hover:bg-white/[0.06] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
              {teamSearch.length > 1 && (
                <p className="text-white/20 text-[10px] -mt-3 mb-4 ml-1">Showing teams that match ALL filters</p>
              )}
            </>
          )}

          {/* Loading skeleton — show whenever we don't YET have a confirmed
              answer (auth rehydrating, first load, or revalidating with nothing
              cached). A card-grid skeleton that matches the page, so a refresh
              never flashes the "No teams yet" empty state before teams load. */}
          {mergedLeagues.length === 0 && (authLoading || leaguesQuery.isLoading || leaguesQuery.isValidating) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-5 mb-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl overflow-hidden border border-white/[0.06] bg-white/[0.02]">
                  <div className="aspect-[4/5] bg-white/[0.04] animate-pulse" />
                  <div className="px-4 pt-3.5 pb-1 flex items-center justify-between">
                    <div className="h-4 w-24 bg-white/[0.06] rounded animate-pulse" />
                    <div className="h-3 w-20 bg-white/[0.04] rounded animate-pulse" />
                  </div>
                  <div className="px-4 pb-4 pt-2 flex gap-2">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <div key={j} className="flex-1 h-8 bg-white/[0.05] rounded-lg animate-pulse" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Team cards */}
          {mergedLeagues.length > 0 && (
            <div className="space-y-3 mb-6">
              {filteredLeagues.length > 0 ? (
                <>
                  {/* Sort toggle (the chip already shows the count) */}
                  <div className="flex items-center justify-end px-1 mb-2">
                    <button
                      onClick={() => setSortOrder(prev => prev === 'oldest' ? 'newest' : 'oldest')}
                      className="text-white/30 text-xs hover:text-white/60 transition-colors"
                    >
                      {sortOrder === 'oldest' ? 'Oldest first ↑' : 'Newest first ↓'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-5">
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
                  <p className="text-white/40 text-sm">
                    {teamSearch.length > 0 || leagueQuery.trim() || teamQuery.trim()
                      ? 'No teams match'
                      : typeFilter !== 'all'
                        ? `No ${typeFilter === 'jackpot' ? 'Jackpot' : typeFilter === 'hof' ? 'HOF' : 'Pro'} teams`
                        : 'No teams'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Empty state — ONLY once we're sure there are no teams (auth resolved,
              not loading, not validating). Never flash this during a refresh. */}
          {mergedLeagues.length === 0 && !authLoading && !leaguesQuery.isLoading && !leaguesQuery.isValidating && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center mb-8">
              <div className="text-4xl mb-4">🏈</div>
              <p className="text-white/50 font-medium mb-2">No teams yet</p>
              <p className="text-white/30 text-sm mb-6">Your drafted teams will show here.</p>
              <a
                href="/draft"
                className="inline-block px-6 py-2.5 bg-banana text-black font-semibold rounded-xl hover:bg-banana-dark transition-colors"
              >
                Start Drafting
              </a>
            </div>
          )}
        </>
      )}

      {/* LEADERBOARD VIEW — only once auth has RESOLVED, so a logged-in user
          refreshing never sees it flash before isLoggedIn settles. */}
      {!authLoading && (viewMode === 'leaderboard' || !isLoggedIn) && (
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
