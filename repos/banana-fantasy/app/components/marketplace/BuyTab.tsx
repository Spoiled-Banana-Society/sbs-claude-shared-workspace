'use client';

import type React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { CollectionStats, MarketplaceTeam } from '@/lib/opensea';
import { hasSeasonStarted } from '@/lib/draftTypes';
import { MultiChipSearch } from '@/components/ui/MultiChipSearch';

type ViewFilter = 'listed' | 'all' | 'top' | 'pro' | 'jackpot' | 'hof';
type BuyStep = 'confirm' | 'processing' | 'complete';
type PaymentMethod = 'card' | 'usdc';
type CardFlowStep = 'idle' | 'funding' | 'waiting' | 'buying';

interface BuyTabProps {
  collectionStats: CollectionStats | null;
  statsLoading: boolean;
  viewFilter: ViewFilter;
  rosterFilter: string[];
  rosterFilterOptions: string[];
  sortBy: string;
  sweepMode: boolean;
  sweepSelected: Set<string>;
  deduplicatedTeams: MarketplaceTeam[];
  listingsLoading: boolean;
  allNftsLoading: boolean;
  hasMore: boolean;
  allNftsHasMore: boolean;
  watchlistSet: Set<string>;
  walletAddress: string | null;
  lastSales: Record<string, { price: number; timestamp: string }>;
  leaderboardTeams: MarketplaceTeam[];
  showBuyModal: boolean;
  selectedTeam: MarketplaceTeam | null;
  buyStep: BuyStep;
  paymentMethod: PaymentMethod;
  cardFlowStep: CardFlowStep;
  txError: string | null;
  userUsdcBalance?: number | null;
  onSetViewFilter: (filter: ViewFilter) => void;
  viewCounts?: { all?: number; pro?: number; jackpot?: number; hof?: number };
  onSetRosterFilter: (chips: string[]) => void;
  leagueFilter: number | null;
  onSetLeagueFilter: (n: number | null) => void;
  onSetSortBy: (value: string) => void;
  onToggleSweepMode: () => void;
  onToggleSweepSelect: (tokenId: string) => void;
  onClearSweep: () => void;
  onOpenSweepModal: () => void;
  onLoadMore: () => void;
  onToggleWatchlist: (tokenId: string, price?: number | null) => void;
  onShare: (team: { name: string; tokenId: string; price?: number | null }, event?: React.MouseEvent) => void;
  onOpenBuyModal: (team: MarketplaceTeam) => void;
  onGoToSellTab: () => void;
  onNavigateToTeam: (tokenId: string) => void;
  onMakeOffer: (tokenId: string) => void;
  onCloseBuyModal: () => void;
  onSetPaymentMethod: (method: PaymentMethod) => void;
  onHandleBuy: () => void;
}

export function BuyTab({
  collectionStats,
  statsLoading,
  viewFilter,
  rosterFilter,
  rosterFilterOptions,
  sortBy,
  sweepMode,
  sweepSelected,
  deduplicatedTeams,
  listingsLoading,
  allNftsLoading,
  hasMore,
  allNftsHasMore,
  watchlistSet,
  walletAddress,
  leaderboardTeams,
  showBuyModal,
  selectedTeam,
  buyStep,
  paymentMethod,
  cardFlowStep,
  txError,
  userUsdcBalance,
  onSetViewFilter,
  viewCounts,
  onSetRosterFilter,
  leagueFilter,
  onSetLeagueFilter,
  onSetSortBy,
  onToggleSweepMode,
  onToggleSweepSelect,
  onClearSweep,
  onOpenSweepModal,
  onLoadMore,
  onToggleWatchlist,
  onOpenBuyModal,
  onGoToSellTab,
  onNavigateToTeam,
  onMakeOffer,
  onCloseBuyModal,
  onSetPaymentMethod,
  onHandleBuy,
}: BuyTabProps) {
  const isTeamsLoading = viewFilter === 'all' || viewFilter === 'top' || viewFilter === 'pro' || viewFilter === 'jackpot' || viewFilter === 'hof'
    ? allNftsLoading
    : listingsLoading;
  const canLoadMore = (viewFilter === 'listed' && hasMore && !listingsLoading) || (viewFilter !== 'listed' && allNftsHasMore && !allNftsLoading);
  const sweepTeams = deduplicatedTeams.filter(team => sweepSelected.has(team.tokenId) && team.price != null);
  const sweepTotal = sweepTeams.reduce((sum, team) => sum + (team.price || 0), 0);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statsLoading || !collectionStats ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard
              iconClassName="bg-banana/20"
              label="Total Volume"
              value={collectionStats.totalVolume > 0 ? `$${collectionStats.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'}
              detail={collectionStats.weeklyVolumeChange != null ? `${Math.abs(collectionStats.weeklyVolumeChange).toFixed(1)}% this week` : null}
              detailClassName={collectionStats.weeklyVolumeChange != null && collectionStats.weeklyVolumeChange >= 0 ? 'text-success' : 'text-error'}
              icon={(
                <svg className="w-5 h-5 text-banana" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              )}
            />
            <StatCard
              iconClassName="bg-success/20"
              label="Teams Listed"
              value={collectionStats.totalListed.toLocaleString()}
              detail={null}
              detailClassName="text-text-secondary"
              icon={(
                <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              )}
            />
            <StatCard
              iconClassName="bg-banana/20"
              label="Floor Price"
              value={collectionStats.floorPrice > 0 ? `$${collectionStats.floorPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '--'}
              detail={collectionStats.floorPriceSymbol}
              detailClassName="text-text-secondary"
              icon={(
                <svg className="w-5 h-5 text-banana" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              )}
            />
            <StatCard
              iconClassName="bg-hof/20"
              label="Total Sales"
              value={collectionStats.totalSales.toLocaleString()}
              detail={`Avg $${collectionStats.averagePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              detailClassName="text-text-secondary"
              icon={(
                <svg className="w-5 h-5 text-hof" fill="currentColor" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              )}
            />
          </>
        )}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-bg-secondary p-1 rounded-xl border border-bg-tertiary">
            {([
              { key: 'listed', label: 'Listed', count: undefined },
              { key: 'all', label: 'All Teams', count: viewCounts?.all },
              { key: 'top', label: 'Top Teams', count: undefined },
              { key: 'pro', label: 'Pro', count: viewCounts?.pro },
              { key: 'jackpot', label: 'Jackpot', count: viewCounts?.jackpot },
              { key: 'hof', label: 'HOF', count: viewCounts?.hof },
            ] as const).map(filter => (
              <button
                key={filter.key}
                onClick={() => onSetViewFilter(filter.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewFilter === filter.key ? filter.key === 'jackpot' ? 'bg-error text-white' : filter.key === 'hof' ? 'bg-hof text-white' : filter.key === 'pro' ? 'bg-pro text-white' : filter.key === 'top' ? 'bg-success text-white' : 'bg-banana text-black' : 'text-text-secondary hover:text-text-primary'}`}
              >
                {filter.label}
                {typeof filter.count === 'number' && filter.count > 0 && (
                  <sup className={`ml-1 text-[9px] font-bold tabular-nums ${viewFilter === filter.key ? 'opacity-80' : 'opacity-50'}`}>
                    {filter.count.toLocaleString()}
                  </sup>
                )}
              </button>
            ))}
          </div>

          <MultiChipSearch
            chips={rosterFilter}
            onChange={onSetRosterFilter}
            options={rosterFilterOptions}
            placeholder="Type a roster slot (e.g. KC QB)"
            className="w-72"
          />

          {/* League # filter — backend-sourced (instant) via the on-chain-id index. */}
          <input
            type="number"
            inputMode="numeric"
            value={leagueFilter ?? ''}
            onChange={(e) => onSetLeagueFilter(e.target.value ? Number(e.target.value) : null)}
            placeholder="League #"
            className="w-28 px-3 py-1.5 rounded-lg bg-bg-primary border border-bg-tertiary text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-banana outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSweepMode}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${sweepMode ? 'bg-banana text-black' : 'bg-bg-secondary border border-bg-tertiary text-text-secondary hover:text-text-primary'}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Sweep
          </button>

          <select
            value={sortBy}
            onChange={event => onSetSortBy(event.target.value)}
            className="bg-bg-secondary border border-bg-tertiary rounded-xl px-4 py-2 text-sm text-text-primary appearance-none cursor-pointer pr-10 focus:outline-none focus:border-banana"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '16px' }}
          >
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
          </select>
        </div>
      </div>

      {isTeamsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mb-12">
          {[...Array(6)].map((_, index) => <CardSkeleton key={index} />)}
        </div>
      ) : deduplicatedTeams.length === 0 ? (
        <div className="text-center py-16 mb-12">
          <div className="text-4xl mb-4">🍌</div>
          <h3 className="text-text-primary font-semibold text-lg mb-2">
            {viewFilter === 'listed' ? 'No Listings Found' : 'No Teams Found'}
          </h3>
          <p className="text-text-secondary text-sm">
            {viewFilter === 'jackpot'
              ? 'No Jackpot teams found. These are rare — 1 in 100 paid drafts, plus wheel wins.'
              : viewFilter === 'hof'
                ? 'No Hall of Fame teams found in this view.'
                : viewFilter === 'top'
                  ? 'No top performing teams found yet.'
                  : rosterFilter.length > 0
                    ? 'No teams match all your filters. Remove a chip to broaden the search.'
                    : 'No BBB4 teams are currently listed for sale. Check back later!'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mb-12">
          {deduplicatedTeams.map(team => (
            <div
              key={`${team.id}-${team.orderHash}`}
              onClick={() => {
                if (sweepMode && team.price != null) onToggleSweepSelect(team.tokenId);
                else onNavigateToTeam(team.tokenId);
              }}
              className={`group relative bg-[#0d0d12] border rounded-2xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg cursor-pointer ${sweepMode && sweepSelected.has(team.tokenId) ? 'ring-2 ring-banana border-banana/50' : team.isJackpot ? 'border-error/30 hover:shadow-error/20' : team.isHof ? 'border-hof/30 hover:shadow-hof/20' : 'border-bg-tertiary hover:border-bg-elevated'}`}
            >
              <div className="relative aspect-[4/5] bg-[#0d0d12]">
                {team.imageUrl ? (
                  <Image src={team.imageUrl} alt={team.name} fill className="object-contain" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center"><FallbackPassSvg gradientId={`passGrad-${team.id}`} /></div>
                )}

                <div className="absolute top-5 right-3 flex flex-col gap-3 z-10">
                  <button
                    onClick={event => {
                      event.stopPropagation();
                      event.preventDefault();
                      onToggleWatchlist(team.tokenId, team.price);
                    }}
                    className="flex items-center justify-center transition-transform hover:scale-110"
                    title="Add to watchlist"
                  >
                    <svg className={`w-5 h-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${watchlistSet.has(team.tokenId) ? 'text-red-500' : 'text-white/85 hover:text-white'}`} fill={watchlistSet.has(team.tokenId) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                  </button>
                  <button
                    onClick={async event => {
                      event.stopPropagation();
                      event.preventDefault();
                      if (!team.imageUrl) return;
                      try {
                        const res = await fetch(team.imageUrl);
                        const blob = await res.blob();
                        const objUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = objUrl;
                        a.download = `SBS-Team-${team.tokenId}.png`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(objUrl);
                      } catch { /* ignore download failure */ }
                    }}
                    className="flex items-center justify-center transition-transform hover:scale-110"
                    title="Download card"
                  >
                    <svg className="w-5 h-5 text-white/85 hover:text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" />
                    </svg>
                  </button>
                </div>

                <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                  {team.isJackpot ? (
                    <span className="px-3 py-1 bg-error text-white text-[10px] font-bold uppercase rounded-full">JACKPOT</span>
                  ) : team.isHof ? (
                    <span className="px-3 py-1 bg-hof text-white text-[10px] font-bold uppercase rounded-full">HOF</span>
                  ) : (
                    <span className="px-3 py-1 bg-pro text-white text-[10px] font-bold uppercase rounded-full">PRO</span>
                  )}
                  {team.rank >= 1 && team.rank <= 10 && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${team.rank === 1 ? 'bg-yellow-500/20 text-yellow-400' : team.rank === 2 ? 'bg-gray-400/20 text-gray-300' : team.rank === 3 ? 'bg-orange-500/20 text-orange-400' : 'bg-white/10 text-white/60'}`}>#{team.rank}</span>
                  )}
                </div>

                {/* bottom overlay: price/name + action (no separate footer = no dead space) */}
                <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2.5 px-3.5 pt-10 pb-3.5 bg-gradient-to-t from-[#07080b] via-[#07080b]/60 to-transparent">
                  <div className="min-w-0">
                    {team.price != null ? (
                      <>
                        <p className="font-mono font-bold text-[17px] text-text-primary leading-tight">${team.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                        <p className="font-mono text-[10.5px] text-text-muted truncate">{hasSeasonStarted() && team.points > 0 ? `${team.points.toLocaleString()} pts` : team.leagueNumber != null ? `League #${team.leagueNumber}` : team.name}</p>
                      </>
                    ) : (
                      <>
                        <p className="font-mono font-semibold text-[15px] text-text-primary truncate">{team.name}</p>
                        <p className="font-mono text-[10.5px] text-text-muted truncate">{hasSeasonStarted() && team.points > 0 ? `${team.points.toLocaleString()} pts` : team.leagueNumber != null ? `League #${team.leagueNumber}` : 'Not listed'}</p>
                      </>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    {sweepMode && team.price != null ? (
                      <button
                        onClick={event => { event.stopPropagation(); event.preventDefault(); onToggleSweepSelect(team.tokenId); }}
                        className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center transition-all ${sweepSelected.has(team.tokenId) ? 'border-banana bg-banana text-black' : 'border-white/30 bg-[#08090c]/50 hover:border-white'}`}
                      >
                        {sweepSelected.has(team.tokenId) && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
                        )}
                      </button>
                    ) : walletAddress && team.ownerAddress?.toLowerCase() === walletAddress.toLowerCase() ? (
                      team.price != null ? (
                        <span className="text-text-muted text-xs font-bold px-3 py-2.5">You</span>
                      ) : (
                        <button
                          onClick={event => { event.stopPropagation(); event.preventDefault(); onGoToSellTab(); }}
                          className="px-5 py-2.5 rounded-xl text-sm font-bold border border-banana text-banana bg-[#08090c]/50 backdrop-blur-sm hover:bg-banana hover:text-black transition-all"
                        >
                          List
                        </button>
                      )
                    ) : team.price != null ? (
                      <button
                        onClick={event => { event.stopPropagation(); onOpenBuyModal(team); }}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold border border-banana text-banana bg-[#08090c]/50 backdrop-blur-sm hover:bg-banana hover:text-black transition-all"
                      >
                        Buy Now
                      </button>
                    ) : (
                      <button
                        onClick={event => { event.stopPropagation(); event.preventDefault(); onMakeOffer(team.tokenId); }}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold border border-banana text-banana bg-[#08090c]/50 backdrop-blur-sm hover:bg-banana hover:text-black transition-all"
                      >
                        Make Offer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canLoadMore && (
        <div className="text-center mb-12">
          <button
            onClick={onLoadMore}
            className="px-8 py-3 bg-bg-secondary border border-bg-tertiary text-text-primary rounded-xl hover:bg-bg-tertiary transition-colors text-sm font-medium"
          >
            Load More
          </button>
        </div>
      )}

      {/* Hidden pre-season — relies on rank/points/playoff stats that don't exist yet.
          Re-enable by removing the `false &&` once the season has real standings. */}
      {false && leaderboardTeams.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-text-primary flex items-center gap-3">
              <span className="text-2xl">🏆</span>
              Top Performing Teams for Sale
            </h2>
            <Link href="/standings" className="text-banana hover:underline text-sm font-medium transition-colors">
              View Full Standings
            </Link>
          </div>

          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl overflow-x-auto">
            <div className="grid grid-cols-7 gap-4 px-6 py-3 bg-bg-primary text-text-muted text-xs uppercase tracking-wider font-medium min-w-[600px]">
              <span>Rank</span>
              <span className="col-span-2">Team</span>
              <span>Points</span>
              <span>Playoff %</span>
              <span>Price</span>
              <span>Action</span>
            </div>

            {leaderboardTeams.map((team, index) => (
              <div
                key={`lb-${team.id}-${team.orderHash}`}
                className="grid grid-cols-7 gap-4 px-6 py-4 items-center border-t border-bg-tertiary hover:bg-bg-tertiary/50 transition-colors min-w-[600px]"
              >
                <span className={`font-mono font-bold ${index < 3 ? 'text-banana' : 'text-text-primary'}`}>
                  {team.rank > 0 ? `#${team.rank}` : `#${index + 1}`}
                </span>
                <div className="col-span-2 flex items-center gap-3">
                  {team.imageUrl ? (
                    <Image src={team.imageUrl} alt={team.name} width={40} height={40} className="rounded-xl" />
                  ) : (
                    <LeaderboardFallbackSvg gradientId={`lbGrad-${team.id}`} />
                  )}
                  <div>
                    <h4 className="text-text-primary font-medium text-sm font-mono">{team.name}</h4>
                    <span className="text-text-muted text-xs">{team.leagueNumber != null ? `League #${team.leagueNumber}` : team.owner}</span>
                  </div>
                  {(team.isHof || team.isJackpot) && (
                    <div className="flex gap-1">
                      {team.isJackpot && <span className="px-2 py-0.5 bg-error/20 text-error text-[9px] font-bold rounded">JP</span>}
                      {team.isHof && <span className="px-2 py-0.5 bg-hof/20 text-hof text-[9px] font-bold rounded">HOF</span>}
                    </div>
                  )}
                </div>
                <span className="text-text-primary font-mono text-sm">{team.points > 0 ? team.points.toLocaleString() : '--'}</span>
                <span className={`font-mono text-sm ${team.playoffOdds >= 50 ? 'text-success' : team.playoffOdds > 0 ? 'text-warning' : 'text-text-muted'}`}>
                  {team.playoffOdds > 0 ? `${team.playoffOdds}%` : '--'}
                </span>
                <span className="text-text-primary font-mono text-sm">${team.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                <div>
                  {walletAddress && team.ownerAddress?.toLowerCase() === walletAddress.toLowerCase() ? (
                    <span className="text-text-muted text-xs">Listed</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onMakeOffer(team.tokenId)}
                        className="px-4 py-1.5 border border-banana text-banana text-xs font-semibold rounded-lg hover:bg-banana/10 transition-all"
                      >
                        Make Offer
                      </button>
                      <button
                        onClick={() => onOpenBuyModal(team)}
                        className="px-4 py-1.5 bg-banana text-black text-xs font-semibold rounded-lg hover:brightness-110 transition-all"
                      >
                        Buy Now
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* "Why Trade Teams?" hidden per Richard 2026-06-07 — restore by removing the `false &&`
          (pending confirmation from Boris on the section). */}
      {false && (
        <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Why Trade Teams?</h3>
          <div className="grid md:grid-cols-3 gap-6">
            <InfoCard
              icon={<svg className="w-5 h-5 text-banana" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              iconClassName="bg-banana/20"
              title="Recoup Your Investment"
              description="Bad draft? Sell your team and get back some of your entry fee."
            />
            <InfoCard
              icon={<svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
              iconClassName="bg-success/20"
              title="Buy Contenders"
              description="Skip the draft and buy a team already performing well mid-season."
            />
            <InfoCard
              icon={<span className="text-error font-bold text-sm">JP</span>}
              iconClassName="bg-error/20"
              title="Get Jackpot Access"
              description="Buy a Jackpot team or unused Jackpot pass. Win the league and you skip straight to finals."
            />
          </div>
        </div>
      )}

      {sweepMode && sweepSelected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-bg-secondary/95 backdrop-blur-md border-t border-bg-tertiary px-4 sm:px-8 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-text-primary font-semibold text-sm">
                {sweepSelected.size} team{sweepSelected.size > 1 ? 's' : ''} selected
              </span>
              <span className="text-text-muted text-sm font-mono">Total: ${sweepTotal.toFixed(2)}</span>
              <button onClick={onClearSweep} className="text-text-muted text-xs hover:text-text-primary transition-colors">
                Clear all
              </button>
            </div>
            <button
              onClick={onOpenSweepModal}
              className="px-8 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all text-sm"
            >
              Buy {sweepSelected.size} Team{sweepSelected.size > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {showBuyModal && selectedTeam && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => buyStep === 'confirm' && onCloseBuyModal()}
        >
          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-md" onClick={event => event.stopPropagation()}>
            {buyStep === 'confirm' && (
              <>
                <div className="flex items-center justify-between p-6 border-b border-bg-tertiary">
                  <h2 className="text-lg font-semibold text-text-primary">Buy Team</h2>
                  <button
                    onClick={onCloseBuyModal}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-6">
                  <div className="flex items-center gap-4 p-4 bg-bg-primary rounded-xl mb-4">
                    {selectedTeam.imageUrl ? (
                      <Image src={selectedTeam.imageUrl} alt={selectedTeam.name} width={56} height={56} className="rounded-xl" />
                    ) : (
                      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${selectedTeam.color} flex items-center justify-center`}>
                        <span className="text-2xl">🍌</span>
                      </div>
                    )}
                    <div>
                      <h3 className="text-text-primary font-semibold font-mono">{selectedTeam.name}</h3>
                      <div className="flex gap-2 mt-1">
                        {selectedTeam.isJackpot && <span className="px-2 py-0.5 bg-error/20 text-error text-[10px] font-bold rounded">JACKPOT</span>}
                        {selectedTeam.isHof && <span className="px-2 py-0.5 bg-hof/20 text-hof text-[10px] font-bold rounded">HOF</span>}
                        {selectedTeam.rank >= 1 && selectedTeam.rank <= 10 && <span className="text-text-muted text-xs">Rank #{selectedTeam.rank}</span>}
                      </div>
                    </div>
                  </div>

                  {hasSeasonStarted() && (
                    <div className="grid grid-cols-3 gap-3 p-4 bg-bg-primary rounded-xl mb-4">
                      <StatSummary label="Points" value={selectedTeam.points.toLocaleString()} />
                      <StatSummary label="Wk Avg" value={String(selectedTeam.weeklyAvg)} valueClassName="text-success" />
                      <StatSummary label="Playoffs" value={`${selectedTeam.playoffOdds}%`} valueClassName="text-success" />
                    </div>
                  )}

                  {(selectedTeam.isJackpot || selectedTeam.isHof) && (
                    <div className={`p-4 rounded-xl mb-4 ${selectedTeam.isJackpot ? 'bg-error/10 border border-error/30' : 'bg-hof/10 border border-hof/30'}`}>
                      <p className={`text-sm font-medium ${selectedTeam.isJackpot ? 'text-error' : 'text-hof'}`}>
                        {selectedTeam.isJackpot
                          ? '🎰 Jackpot Perk: Win your league and skip straight to the finals!'
                          : '⭐ HOF Perk: Compete for bonus prizes on top of regular rewards!'}
                      </p>
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="block text-text-secondary text-sm mb-3">Payment Method</label>
                    <div className="grid gap-3 grid-cols-2">
                      <button
                        onClick={() => onSetPaymentMethod('card')}
                        className={`p-4 rounded-xl border-2 transition-all ${paymentMethod === 'card' ? 'border-banana bg-banana/10' : 'border-bg-tertiary hover:border-bg-elevated'}`}
                      >
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <svg className="w-6 h-4" viewBox="0 0 24 16" fill="none">
                            <rect width="24" height="16" rx="2" fill="#1A1F71" />
                            <path d="M9.5 10.5L10.5 5.5H12L11 10.5H9.5Z" fill="white" />
                            <path d="M15.5 5.5C15 5.5 14.5 5.7 14.3 6L12 10.5H13.7L14 9.7H16L16.2 10.5H17.7L16.5 5.5H15.5ZM14.5 8.5L15.2 6.7L15.6 8.5H14.5Z" fill="white" />
                            <path d="M8 5.5L6 10.5H7.5L7.8 9.5H9.5L9.8 10.5H11.3L9.3 5.5H8ZM8 8.3L8.5 6.7L9 8.3H8Z" fill="white" />
                          </svg>
                          <svg className="w-8 h-5" viewBox="0 0 32 20" fill="none">
                            <rect width="32" height="20" rx="2" fill="#EB001B" />
                            <circle cx="12" cy="10" r="6" fill="#EB001B" />
                            <circle cx="20" cy="10" r="6" fill="#F79E1B" />
                            <path d="M16 5.5C17.5 6.7 18.5 8.2 18.5 10C18.5 11.8 17.5 13.3 16 14.5C14.5 13.3 13.5 11.8 13.5 10C13.5 8.2 14.5 6.7 16 5.5Z" fill="#FF5F00" />
                          </svg>
                        </div>
                        <span className={`text-sm font-medium ${paymentMethod === 'card' ? 'text-text-primary' : 'text-text-secondary'}`}>Card</span>
                        <p className="text-text-muted text-[10px] mt-1">Powered by MoonPay</p>
                      </button>
                      <button
                        onClick={() => onSetPaymentMethod('usdc')}
                        className={`p-4 rounded-xl border-2 transition-all ${paymentMethod === 'usdc' ? 'border-banana bg-banana/10' : 'border-bg-tertiary hover:border-bg-elevated'}`}
                      >
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <span className="text-lg font-bold text-text-primary">$</span>
                        </div>
                        <span className={`text-sm font-medium ${paymentMethod === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>USDC</span>
                        {userUsdcBalance != null && <p className="text-text-muted text-[10px] mt-1">Balance: ${userUsdcBalance.toFixed(2)}</p>}
                      </button>
                    </div>
                  </div>

                  {txError && (
                    <div className="p-3 bg-error/10 border border-error/30 rounded-xl mb-4">
                      <p className="text-error text-sm">{txError}</p>
                    </div>
                  )}

                  <div className="p-4 bg-bg-primary rounded-xl space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Price</span>
                      <span className="text-text-primary font-mono">${(selectedTeam.price || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                    {paymentMethod === 'card' ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Processing Fee (3%)</span>
                        <span className="text-text-primary font-mono">${((selectedTeam.price || 0) * 0.03).toFixed(2)}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Network Fee (est.)</span>
                        <span className="text-text-primary font-mono">~$0.01</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm pt-3 border-t border-bg-tertiary font-semibold">
                      <span className="text-text-primary">Total</span>
                      <span className="text-text-primary font-mono">
                        {paymentMethod === 'card' ? `$${((selectedTeam.price || 0) * 1.03).toFixed(2)}` : `$${((selectedTeam.price || 0) + 0.01).toFixed(2)}`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-6 pt-0">
                  <button
                    onClick={onHandleBuy}
                    className="w-full py-4 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {paymentMethod === 'card' ? (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                        Pay ${((selectedTeam.price || 0) * 1.03).toFixed(2)}
                      </>
                    ) : (
                      <>Pay ${((selectedTeam.price || 0) + 0.01).toFixed(2)} USDC</>
                    )}
                  </button>
                  <p className="text-center text-text-muted text-xs mt-3">
                    {paymentMethod === 'card' ? 'Secure payment powered by MoonPay' : 'USDC payment on Base network'}
                  </p>
                </div>
              </>
            )}

            {buyStep === 'processing' && (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-6 relative">
                  <div className="absolute inset-0 border-4 border-bg-tertiary rounded-full" />
                  <div className="absolute inset-0 border-4 border-banana rounded-full border-t-transparent animate-spin" />
                </div>
                <h3 className="text-text-primary font-semibold text-lg mb-2">
                  {paymentMethod === 'card' ? cardFlowStep === 'funding' ? 'Completing Payment' : cardFlowStep === 'waiting' ? 'Waiting for Funds' : 'Purchasing Team' : 'Processing Payment'}
                </h3>
                <p className="text-text-secondary text-sm">
                  {paymentMethod === 'card'
                    ? cardFlowStep === 'funding'
                      ? 'Complete your payment in the MoonPay window...'
                      : cardFlowStep === 'waiting'
                        ? 'Your funds are on the way. This may take a moment...'
                        : 'Completing your purchase on Base...'
                    : 'Completing your purchase on Base...'}
                </p>
                {paymentMethod === 'card' && cardFlowStep !== 'idle' && (
                  <div className="mt-6 space-y-2 text-left max-w-[240px] mx-auto">
                    {[
                      { key: 'funding', label: 'Card payment' },
                      { key: 'waiting', label: 'Funds arriving' },
                      { key: 'buying', label: 'Purchase team' },
                    ].map(({ key, label }) => {
                      const stepOrder = ['funding', 'waiting', 'buying'];
                      const currentIndex = stepOrder.indexOf(cardFlowStep);
                      const stepIndex = stepOrder.indexOf(key);
                      const isComplete = stepIndex < currentIndex;
                      const isActive = key === cardFlowStep;

                      return (
                        <div key={key} className="flex items-center gap-2.5 text-sm">
                          {isComplete ? (
                            <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
                              <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          ) : isActive ? (
                            <div className="w-5 h-5 rounded-full border-2 border-banana/30 border-t-banana animate-spin" />
                          ) : (
                            <div className="w-5 h-5 rounded-full border border-bg-tertiary" />
                          )}
                          <span className={isComplete ? 'text-text-primary' : isActive ? 'text-text-secondary' : 'text-text-muted'}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {buyStep === 'complete' && (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-6 bg-success/20 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-text-primary font-semibold text-lg mb-2">Purchase Complete!</h3>
                <p className="text-text-secondary text-sm">{selectedTeam.name} is now yours</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl overflow-hidden animate-pulse">
      <div className="h-32 bg-bg-tertiary" />
      <div className="p-5 space-y-3">
        <div className="h-5 bg-bg-tertiary rounded w-1/2" />
        <div className="h-3 bg-bg-tertiary rounded w-1/3" />
        <div className="grid grid-cols-3 gap-3 p-3 bg-bg-primary rounded-xl">
          <div className="h-8 bg-bg-tertiary rounded" />
          <div className="h-8 bg-bg-tertiary rounded" />
          <div className="h-8 bg-bg-tertiary rounded" />
        </div>
        <div className="flex justify-between items-center">
          <div className="h-6 bg-bg-tertiary rounded w-20" />
          <div className="h-10 bg-bg-tertiary rounded w-24" />
        </div>
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-bg-tertiary" />
        <div className="h-3 bg-bg-tertiary rounded w-20" />
      </div>
      <div className="h-7 bg-bg-tertiary rounded w-24 mb-1" />
      <div className="h-3 bg-bg-tertiary rounded w-32" />
    </div>
  );
}

function StatCard({
  icon,
  iconClassName,
  label,
  value,
  detail,
  detailClassName,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  label: string;
  value: string;
  detail: string | null;
  detailClassName: string;
}) {
  return (
    <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconClassName}`}>{icon}</div>
        <span className="text-text-muted text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-text-primary font-mono">{value}</div>
      {detail && <div className={`text-xs mt-1 ${detailClassName}`}>{detail}</div>}
    </div>
  );
}

function InfoCard({
  icon,
  iconClassName,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${iconClassName}`}>{icon}</div>
      <h4 className="text-text-primary font-medium mb-2">{title}</h4>
      <p className="text-text-secondary text-sm">{description}</p>
    </div>
  );
}

function FallbackPassSvg({ gradientId }: { gradientId: string }) {
  return (
    <div className="flex items-center justify-center">
      <svg width="160" height="100" viewBox="0 0 160 100" className="drop-shadow-lg">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FBBF24" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="160" height="100" rx="12" fill={`url(#${gradientId})`} />
        <circle cx="0" cy="50" r="10" fill="#1a1a2e" />
        <circle cx="160" cy="50" r="10" fill="#1a1a2e" />
        <text x="80" y="55" textAnchor="middle" fill="#1C1C1E" fontSize="13" fontWeight="bold" fontFamily="system-ui">Banana Best Ball IV</text>
      </svg>
    </div>
  );
}

function LeaderboardFallbackSvg({ gradientId }: { gradientId: string }) {
  return (
    <svg width="40" height="28" viewBox="0 0 88 56" className="flex-shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="88" height="56" rx="6" fill={`url(#${gradientId})`} />
      <circle cx="0" cy="28" r="6" fill="#1a1a2e" />
      <circle cx="88" cy="28" r="6" fill="#1a1a2e" />
      <text x="44" y="38" textAnchor="middle" fill="#1C1C1E" fontSize="14" fontWeight="bold" fontFamily="system-ui">BBB IV</text>
    </svg>
  );
}

function StatSummary({
  label,
  value,
  valueClassName = 'text-text-primary',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="text-center">
      <p className="text-text-muted text-[10px] uppercase mb-1">{label}</p>
      <p className={`font-mono text-sm font-semibold ${valueClassName}`}>{value}</p>
    </div>
  );
}
