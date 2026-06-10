'use client';

import Image from 'next/image';
import type { MarketplaceTeam } from '@/lib/opensea';
import { buildTieredDraftPassUrl } from '@/lib/nftCard';
import { hasSeasonStarted } from '@/lib/draftTypes';
import { FallbackPassSvg } from './BuyTab';

interface WatchlistItem {
  id: string;
  tokenId: string;
  lastKnownPrice: number | null;
  addedAt: string;
}

interface WatchlistTabProps {
  watchlist: WatchlistItem[];
  watchlistSet: Set<string>;
  deduplicatedTeams: MarketplaceTeam[];
  walletAddress: string | null;
  /** tokenId → USD of the viewer's own live offer — same chip as the Buy grid. */
  myMadeOffers?: Record<string, number>;
  onBrowseTeams: () => void;
  onViewTeam: (tokenId: string) => void;
  onToggleWatchlist: (tokenId: string, price?: number | null) => void;
  onOpenBuyModal: (team: MarketplaceTeam) => void;
  onMakeOffer: (tokenId: string) => void;
  onGoToSellTab: () => void;
  onViewAllTeams: () => void;
}

/**
 * Watchlist grid — the SAME card visual as the Buy grid (image-fill card,
 * overlay badges, bottom gradient with price + action). Keep the two in sync
 * when the card design changes.
 */
export function WatchlistTab({
  watchlist,
  watchlistSet,
  deduplicatedTeams,
  walletAddress,
  myMadeOffers,
  onBrowseTeams,
  onViewTeam,
  onToggleWatchlist,
  onOpenBuyModal,
  onMakeOffer,
  onGoToSellTab,
  onViewAllTeams,
}: WatchlistTabProps) {
  if (watchlist.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 mx-auto mb-6 bg-bg-secondary rounded-full flex items-center justify-center border border-bg-tertiary">
          <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </div>
        <h3 className="text-text-primary font-semibold text-lg mb-2">No teams watchlisted yet</h3>
        <p className="text-text-secondary text-sm mb-6">Tap the heart icon on any team card to add it to your watchlist.</p>
        <button
          onClick={onBrowseTeams}
          className="px-6 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all text-sm"
        >
          Browse Teams
        </button>
      </div>
    );
  }

  const visibleWatchlistTeams = deduplicatedTeams.filter(team => watchlistSet.has(team.tokenId));
  const unloadedWatchlistCount = watchlist.filter(item => !deduplicatedTeams.some(team => team.tokenId === item.tokenId)).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
      {visibleWatchlistTeams.map(team => (
        <div
          key={`wl-${team.id}-${team.orderHash}`}
          onClick={() => onViewTeam(team.tokenId)}
          className={`group relative bg-[#0d0d12] border rounded-2xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg cursor-pointer ${(team.isJackpot || team.fillingWheelLevel === 'jackpot') ? 'border-error/30 hover:shadow-error/20' : (team.isHof || team.fillingWheelLevel === 'hof') ? 'border-hof/30 hover:shadow-hof/20' : 'border-bg-tertiary hover:border-bg-elevated'}`}
        >
          <div className="relative aspect-[4/5] bg-[#0d0d12]">
            {team.fillingWheelLevel ? (
              <Image src={buildTieredDraftPassUrl(team.tokenId, team.fillingWheelLevel)} alt={team.name} fill className="object-contain" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
            ) : team.imageUrl ? (
              <Image src={team.imageUrl} alt={team.name} fill className="object-contain" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center"><FallbackPassSvg gradientId={`wlPassGrad-${team.id}`} /></div>
            )}

            <div className="absolute top-5 right-3 flex flex-col gap-3 z-10">
              <button
                onClick={event => {
                  event.stopPropagation();
                  event.preventDefault();
                  onToggleWatchlist(team.tokenId, team.price);
                }}
                className="flex items-center justify-center transition-transform hover:scale-110"
                title="Remove from watchlist"
              >
                <svg className="w-5 h-5 text-red-500 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              {team.fillingWheelLevel ? (
                <span className={`px-3 py-1 text-[10px] font-bold uppercase rounded-full text-white ${team.fillingWheelLevel === 'jackpot' ? 'bg-error' : 'bg-hof'}`}>
                  {team.fillingWheelLevel === 'jackpot' ? 'JACKPOT' : 'HOF'} · Filling
                </span>
              ) : team.isJackpot ? (
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

            {/* bottom overlay: price/name + action — mirrors the Buy grid card */}
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
                {myMadeOffers?.[team.tokenId] != null && (
                  <p className="font-mono text-[10.5px] text-banana font-semibold truncate">
                    Your offer ${myMadeOffers[team.tokenId].toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                {walletAddress && team.ownerAddress?.toLowerCase() === walletAddress.toLowerCase() ? (
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

      {unloadedWatchlistCount > 0 && (
        <div className="col-span-full text-center py-6">
          <p className="text-text-muted text-sm">
            {unloadedWatchlistCount} watchlisted teams not currently loaded.
            <button onClick={onViewAllTeams} className="text-banana hover:underline ml-1">View All Teams</button>
          </p>
        </div>
      )}
    </div>
  );
}
