'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useNftOffers, type MyNftOffer } from '@/hooks/useMarketplace';
import type { CollectionStats, MarketplaceTeam } from '@/lib/opensea';
import { isDraftingOpen, hasSeasonStarted } from '@/lib/draftTypes';
import { SbsPassThumb } from '@/components/marketplace/SbsPassThumb';
import { FounderTeamBadge } from '@/components/marketplace/FounderTeamBadge';
import { useFounderTeams } from '@/hooks/useFounderTeams';
import { buildTieredDraftPassUrl } from '@/lib/nftCard';

type SuccessType = 'buy' | 'sell' | 'list';

// Sort order for "Sell Your Teams", per product:
//   0. Drafted teams you CAN sell        (has roster, not a free pass mid-season)
//   1. Drafted teams you CAN'T sell yet  (free team, drafting still open)
//   2. Draft passes you CAN sell         (unused paid pass)
//   3. Draft passes you CAN'T sell yet   (free pass, drafting still open)
// A "team" = has a backend roster record; otherwise it's an unused draft pass.
// "Can't sell" = a free pass/team while drafting is still open.
function sellTierRank(team: MarketplaceTeam): number {
  const isTeam = team.hasBackendRecord === true;
  // A wheel-won JP/HOF pass that's still filling is sellable even though it's free
  // (the slot follows the NFT, so a sale hands the draft to the buyer). It waives
  // the normal free-pass listing block until its draft fills.
  const fillingWheelPass = !!team.fillingWheelLevel;
  // The free-entry lock applies ONLY to an undrafted free PASS. A DRAFTED team
  // (hasBackendRecord === true) is a real team — sellable regardless of whether
  // it was entered with a free or paid pass. So a drafted team is never blocked.
  const blocked = !fillingWheelPass && !isTeam && team.passType === 'free' && isDraftingOpen();
  if (isTeam && !blocked) return 0;
  if (isTeam && blocked) return 1;
  if (!isTeam && !blocked) return 2;
  return 3;
}

/** Can this team/pass be listed right now? (Free passes are locked until the season
 *  starts — EXCEPT a wheel-won JP/HOF pass while its draft is still filling.) */
function canSellTeam(team: MarketplaceTeam): boolean {
  if (team.fillingWheelLevel) return true;
  // A DRAFTED team (has a backend roster record) is a real team, not a pass —
  // always sellable, even one entered with a FREE pass. Only an UNDRAFTED free
  // PASS is locked (you can't sell a free draft pass). This is why a free-draft
  // team like League #11 must show + be listable on My Teams.
  if (team.hasBackendRecord === true) return true;
  return !(team.passType === 'free' && isDraftingOpen());
}

// A drafted team's roster is EMPTY while its draft is in progress and only
// populates once the draft completes. (A finished team's marketplace roster is
// ~12 display slots, not the raw 15 best-ball picks — so check for ANY roster,
// not a count of 15.) Empty roster + a backend record = still drafting.
function draftInProgress(team: MarketplaceTeam): boolean {
  return team.hasBackendRecord === true && (team.roster?.length ?? 0) === 0;
}

interface SellTabProps {
  myNfts: MarketplaceTeam[];
  myNftsLoading: boolean;
  myNftOffers: MyNftOffer[];
  myNftOffersLoading: boolean;
  collectionStats: CollectionStats | null;
  showSellModal: boolean;
  showFreePassInfo: 'team' | 'pass' | null;
  showSuccessModal: boolean;
  successType: SuccessType;
  selectedTeam: MarketplaceTeam | null;
  listPrice: string;
  listDurationSeconds: number;
  txError: string | null;
  cancelConfirmTeam: MarketplaceTeam | null;
  cancellingTokenId: string | null;
  onOpenSellModal: (team: MarketplaceTeam) => void;
  onCloseSellModal: () => void;
  onSetListPrice: (value: string) => void;
  onSetListDurationSeconds: (value: number) => void;
  onHandleList: () => void;
  onShowFreePassInfo: (value: 'team' | 'pass' | null) => void;
  onHandleCancel: (team: MarketplaceTeam | null) => void;
  onExecuteCancel: (team: MarketplaceTeam) => void;
  onCloseSuccessModal: () => void;
}

export function SellTab({
  myNfts,
  myNftsLoading,
  myNftOffers,
  myNftOffersLoading,
  collectionStats,
  showSellModal,
  showFreePassInfo,
  showSuccessModal,
  successType,
  selectedTeam,
  listPrice,
  listDurationSeconds,
  txError,
  cancelConfirmTeam,
  cancellingTokenId,
  onOpenSellModal,
  onCloseSellModal,
  onSetListPrice,
  onSetListDurationSeconds,
  onHandleList,
  onShowFreePassInfo,
  onHandleCancel,
  onExecuteCancel,
  onCloseSuccessModal,
}: SellTabProps) {
  // Team # / League # search (Boris 2026-06-10) — same instant client-side
  // filter style as the Buy tab's inputs. Team # = token id; league # comes
  // from the marketplace index overlay.
  const [teamSearch, setTeamSearch] = useState('');
  const [leagueSearch, setLeagueSearch] = useState('');
  // Which of my teams came from a Founder Draft (one batched check).
  const founderTeamIds = useFounderTeams(
    myNfts.map(t => ({ tokenId: t.tokenId, owner: t.ownerAddress, leagueId: t.leagueId })),
  );
  // Inventory view toggle. DEFAULT = drafted TEAMS (the thing people actually
  // sell). Passes live behind toggles, split paid vs free, plus an All view.
  // A "pass" = an NFT with no backend roster record (hasBackendRecord === false);
  // a "team" = a drafted roster record. Once a pass is drafted it gains a roster
  // record → hasBackendRecord flips true → it shows up in the default Teams view
  // automatically. No special wiring needed for that transition.
  // Only DRAFTED TEAMS are sellable/shown here — undrafted passes are never listed
  // (a pass becomes a team once drafted: it gains a backend roster record, so
  // hasBackendRecord flips true and it appears). No view toggle.
  // ...plus wheel-won JP/HOF passes that are still filling — those are sellable
  // now (until their draft fills), so surface them even without a roster record.
  const searched = myNfts.filter(t =>
    (!teamSearch || String(t.tokenId) === teamSearch.trim()) &&
    (!leagueSearch || String(t.leagueNumber ?? '') === leagueSearch.trim()),
  );
  const inView = searched.filter(t => t.hasBackendRecord !== false || t.fillingWheelLevel != null);

  // Tier first, then NEWEST first (highest token id) within a tier, so the team
  // you just drafted sits at the very top.
  const byTierThenNewest = (a: typeof myNfts[number], b: typeof myNfts[number]) =>
    (sellTierRank(a) - sellTierRank(b)) || ((Number(b.tokenId) || 0) - (Number(a.tokenId) || 0));
  const sellable = inView.filter(canSellTeam).sort(byTierThenNewest);
  const unsellable = inView.filter(t => !canSellTeam(t)).sort(byTierThenNewest);
  // Unsellable teams (free entries pre-season) are never listed here — they're
  // not actionable on the Sell tab. The empty-state line below explains why.
  const fullList = sellable;
  // Cap rendered rows so a whale's hundreds of identical passes don't jank the
  // page. Teams are few so they're effectively never capped.
  const RENDER_CAP = 60;
  const visibleNfts = fullList.slice(0, RENDER_CAP);
  const hiddenCount = fullList.length - visibleNfts.length;

  return (
    <>
      <div>
        <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h3 className="text-lg font-semibold text-text-primary">Sell Your Teams</h3>
            {/* Equal-width inputs that stay inside the card on mobile (2-col
                grid), fixed compact widths on desktop. */}
            <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:items-center sm:w-auto">
              <input
                type="number"
                inputMode="numeric"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Team #"
                className="w-full sm:w-28 px-3 py-1.5 rounded-lg bg-bg-primary border border-bg-tertiary text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-banana outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <input
                type="number"
                inputMode="numeric"
                value={leagueSearch}
                onChange={(e) => setLeagueSearch(e.target.value)}
                placeholder="League #"
                className="w-full sm:w-28 px-3 py-1.5 rounded-lg bg-bg-primary border border-bg-tertiary text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-banana outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <p className="text-text-secondary text-sm mb-6">List any of your teams for sale. Set your price and buyers can purchase instantly.</p>

          {myNftsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="bg-[#0d0d12] border border-bg-tertiary rounded-2xl overflow-hidden animate-pulse">
                  <div className="aspect-[3/4] bg-bg-tertiary/40" />
                  <div className="p-4 space-y-3">
                    <div className="h-5 bg-bg-tertiary rounded w-28" />
                    <div className="h-3 bg-bg-tertiary rounded w-20" />
                    <div className="h-10 bg-bg-tertiary rounded-xl w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Same 3-up big-card grid as the Buy sections.
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {visibleNfts.map(team => (
                <Link
                  key={team.id}
                  href={`/marketplace/${team.tokenId}`}
                  className={`group relative block bg-[#0d0d12] border rounded-2xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg ${team.isJackpot ? 'border-error/30 hover:shadow-error/20' : team.isHof ? 'border-hof/30 hover:shadow-hof/20' : 'border-bg-tertiary hover:border-bg-elevated'}`}
                >
                  <div className="relative aspect-[4/5] bg-[#0d0d12]">
                    {draftInProgress(team) ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
                        <Image src="/sbs-banana-logo.png" alt="Drafting in progress" width={64} height={64} className="object-contain opacity-80" />
                        <span className="text-text-muted text-xs">Drafting…</span>
                      </div>
                    ) : team.fillingWheelLevel ? (
                      // Wheel-won JP/HOF pass: render the tier-styled pass art (gold
                      // HOF / red Jackpot) instead of the generic grey pass image.
                      <Image src={buildTieredDraftPassUrl(team.tokenId, team.fillingWheelLevel)} alt={team.name} fill className="object-contain" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                    ) : team.imageUrl ? (
                      <Image src={team.imageUrl} alt={team.name} fill className="object-contain" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center"><SbsPassThumb label={`#${team.tokenId}`} size={160} roster={team.roster} /></div>
                    )}

                    {/* level badge (top-left) */}
                    <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                      {team.fillingWheelLevel ? (
                        // Wheel-won JP/HOF pass still filling. Its NFT metadata isn't
                        // stamped JP/HOF until the draft reveals, so team.isHof/isJackpot
                        // are still false here — drive the badge off the known wheel
                        // level so it never wrongly falls back to "PRO".
                        <span
                          className={`px-3 py-1 text-[10px] font-bold uppercase rounded-full text-white ${team.fillingWheelLevel === 'jackpot' ? 'bg-error' : 'bg-hof'}`}
                          title="Wheel-won pass — the only sellable draft pass on SBS. Sell it any time before the draft fills; once it fills, the seat is yours for good (team listable after the season)."
                        >
                          {team.fillingWheelLevel === 'jackpot' ? 'JACKPOT' : 'HOF'} · In Lobby{typeof team.lobbyCount === 'number' ? ` ${team.lobbyCount}/10` : ''}
                        </span>
                      ) : team.isJackpot ? (
                        <span className="px-3 py-1 bg-error text-white text-[10px] font-bold uppercase rounded-full">JACKPOT</span>
                      ) : team.isHof ? (
                        <span className="px-3 py-1 bg-hof text-white text-[10px] font-bold uppercase rounded-full">HOF</span>
                      ) : (
                        <span className="px-3 py-1 bg-pro text-white text-[10px] font-bold uppercase rounded-full">PRO</span>
                      )}
                      {founderTeamIds.has(team.tokenId) && <FounderTeamBadge />}
                    </div>
                  </div>

                  {/* Footer below the card — info + action sit on their own row so
                      the action button never covers the roster numbers on the card
                      art (gives the card breathing room). */}
                  <div className="flex items-center justify-between gap-2.5 px-3.5 py-3 border-t border-bg-tertiary">
                    <div className="min-w-0">
                      <p className="font-mono font-semibold text-sm text-text-primary truncate">
                        {team.fillingWheelLevel ? `${team.fillingWheelLevel === 'jackpot' ? 'Jackpot' : 'HOF'} Pass #${team.tokenId}` : `Team #${team.tokenId}`}
                      </p>
                      <p className={`font-mono text-[10.5px] truncate ${team.fillingWheelLevel ? (team.fillingWheelLevel === 'jackpot' ? 'text-error' : 'text-hof') : 'text-text-muted'}`}>
                        {team.fillingWheelLevel
                          ? `From wheel · Filling${typeof team.lobbyCount === 'number' ? ` ${team.lobbyCount}/10` : ''}`
                          : hasSeasonStarted() && team.points > 0 ? `${team.points.toLocaleString()} pts` : team.leagueNumber != null ? `League #${team.leagueNumber}` : 'Not listed'}
                      </p>
                      {/* Best offer — only for LISTED teams; fetching offers per
                          card for every owned team flooded the rate limiter. */}
                      {team.orderHash && <SellTabOfferBadge tokenId={team.tokenId} />}
                    </div>
                    <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
                      {team.orderHash ? (
                        <button
                          onClick={e => { e.preventDefault(); onHandleCancel(team); }}
                          disabled={cancellingTokenId === team.tokenId}
                          className="px-4 py-2 rounded-xl text-xs font-bold border border-red-500/50 text-red-400 hover:bg-red-500/15 transition-all disabled:opacity-50"
                        >
                          {cancellingTokenId === team.tokenId ? 'Cancelling…' : 'Delist'}
                        </button>
                      ) : team.passType === 'free' && isDraftingOpen() && !team.fillingWheelLevel && team.hasBackendRecord !== true ? (
                        // Only an UNDRAFTED free PASS is locked until the season.
                        // A drafted free TEAM (hasBackendRecord) falls through to
                        // "List for Sale" — it's a real, sellable team.
                        <button
                          onClick={e => { e.preventDefault(); onShowFreePassInfo('team'); }}
                          className="px-4 py-2 rounded-xl text-xs font-bold border border-white/15 text-white/50 transition-all"
                        >
                          Season Soon
                        </button>
                      ) : draftInProgress(team) ? (
                        <span className="px-4 py-2 rounded-xl text-xs font-bold border border-white/15 text-white/45 cursor-default">Drafting…</span>
                      ) : (
                        <button
                          onClick={e => { e.preventDefault(); onOpenSellModal(team); }}
                          className="px-4 py-2 rounded-xl text-xs font-bold border border-banana text-banana hover:bg-banana hover:text-black transition-all"
                        >
                          List for Sale
                        </button>
                      )}
                    </div>
                  </div>
                </Link>
                ))}
            </div>
          )}

          {!myNftsLoading && (teamSearch || leagueSearch) && fullList.length === 0 && myNfts.length > 0 && (
            <p className="text-text-muted text-sm text-center py-6">
              No teams match your search.
            </p>
          )}

          {!myNftsLoading && !(teamSearch || leagueSearch) && sellable.length === 0 && unsellable.length > 0 && (
            <p className="text-text-muted text-sm text-center py-6">
              Nothing you can list right now — your teams/passes are free entries, listable once the season starts.
            </p>
          )}

          {!myNftsLoading && hiddenCount > 0 && (
            <p className="text-text-muted text-xs text-center mt-3">Showing {visibleNfts.length} of {fullList.length}.</p>
          )}

          {txError && !showSellModal && (
            <div className="mt-4 p-3 bg-error/10 border border-error/30 rounded-xl">
              <p className="text-error text-sm">{txError}</p>
            </div>
          )}

          {!myNftsLoading && myNfts.length === 0 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🍌</div>
              <h4 className="text-text-primary font-semibold mb-2">No Teams Yet</h4>
              <p className="text-text-secondary text-sm mb-4">Draft some teams to start selling!</p>
              <Link href="/" className="inline-block px-6 py-2 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all">
                Enter a Draft
              </Link>
            </div>
          )}
        </div>

        <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            Offers on Your Teams
            {myNftOffers.length > 0 && (
              <span className="text-xs bg-success/20 text-success px-2 py-0.5 rounded-full font-normal">
                {myNftOffers.length}
              </span>
            )}
          </h3>

          {myNftOffersLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, index) => (
                <div key={index} className="h-16 bg-bg-tertiary rounded-xl animate-pulse" />
              ))}
            </div>
          ) : myNftOffers.length === 0 ? (
            <p className="text-text-muted text-sm py-4 text-center">No active offers on your teams</p>
          ) : (
            <div className="space-y-3">
              {myNftOffers.map((offer, index) => (
                <div
                  key={`offer-${offer.orderHash}`}
                  className={`flex items-center justify-between p-4 rounded-xl border ${index === 0 ? 'border-banana/20 bg-banana/5' : 'border-bg-tertiary bg-bg-primary'}`}
                >
                  <div className="flex items-center gap-4">
                    {offer.imageUrl ? (
                      <Image src={offer.imageUrl} alt={offer.teamName} width={48} height={48} className="rounded-xl" />
                    ) : (
                      <SbsPassThumb label={offer.teamName?.startsWith('BBB') ? offer.teamName.replace('BBB ', '') : `#${offer.tokenId}`} size={48} />
                    )}
                    <div>
                      <h4 className="text-text-primary font-semibold font-mono text-sm">{offer.teamName}</h4>
                      <p className="text-text-muted text-xs mt-0.5">
                        <span className="text-banana font-mono font-semibold">${offer.amount.toFixed(2)}</span> from {offer.offererName}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/marketplace/${offer.tokenId}?review=offers`}
                    className="px-4 py-2 bg-success text-white text-xs font-semibold rounded-xl hover:brightness-110 transition-all"
                  >
                    Review
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showFreePassInfo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => onShowFreePassInfo(null)}>
          <div className="bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 max-w-sm w-full cursor-default" onClick={event => event.stopPropagation()}>
            <h3 className="text-xl font-bold text-white mb-3">{showFreePassInfo === 'team' ? 'Free Draft Team' : 'Free Draft Pass'}</h3>
            <p className="text-white/60 text-[14px] leading-[1.7] mb-2">
              {showFreePassInfo === 'team'
                ? 'This team was drafted using a free pass. Free draft teams can be listed on the marketplace once drafting closes and the season begins.'
                : 'Free draft passes cannot be sold on the marketplace. They can only be used to enter drafts.'}
            </p>
            <p className="text-white/40 text-[13px] leading-[1.6] mb-6">
              {showFreePassInfo === 'team'
                ? 'Teams drafted with paid passes can be listed at any time.'
                : 'Once you draft a team with a free pass, that team becomes listable once the season starts.'}
            </p>
            <button onClick={() => onShowFreePassInfo(null)} className="w-full px-4 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all">
              Got It
            </button>
          </div>
        </div>
      )}

      {showSellModal && selectedTeam && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onCloseSellModal}>
          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-md" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-bg-tertiary">
              <h2 className="text-lg font-semibold text-text-primary">List for Sale</h2>
              <button
                onClick={onCloseSellModal}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-4 p-4 bg-bg-primary rounded-xl mb-6">
                {selectedTeam.imageUrl ? (
                  <Image src={selectedTeam.imageUrl} alt={selectedTeam.name} width={56} height={56} className="rounded-xl" />
                ) : (
                  <SbsPassThumb label={selectedTeam.name?.startsWith('BBB') ? selectedTeam.name.replace('BBB ', '') : `#${selectedTeam.tokenId}`} size={56} />
                )}
                <div>
                  <h3 className="text-text-primary font-semibold font-mono">Team #{selectedTeam.tokenId}</h3>
                  <p className="text-text-muted text-xs">
                    {hasSeasonStarted() && selectedTeam.rank >= 1 && selectedTeam.rank <= 10 ? `Rank #${selectedTeam.rank} • ` : ''}
                    {hasSeasonStarted() && selectedTeam.playoffOdds > 0 ? `${selectedTeam.playoffOdds}% playoffs` : selectedTeam.leagueNumber != null ? `League #${selectedTeam.leagueNumber}` : `Token #${selectedTeam.tokenId}`}
                  </p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-text-secondary text-sm mb-2">Set your price</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted font-mono">$</span>
                  <input
                    type="number"
                    step="1"
                    value={listPrice}
                    onChange={event => onSetListPrice(event.target.value)}
                    placeholder="0"
                    className="w-full bg-bg-primary border border-bg-tertiary rounded-xl pl-8 pr-4 py-3 text-text-primary font-mono text-lg focus:outline-none focus:border-banana"
                  />
                </div>
                {collectionStats && collectionStats.floorPrice > 0 && (
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                    <span>Floor: <span className="text-banana font-mono font-medium">${collectionStats.floorPrice.toFixed(2)}</span></span>
                    <span>&middot;</span>
                    <span>Avg: <span className="text-text-secondary font-mono font-medium">${collectionStats.averagePrice.toFixed(2)}</span></span>
                    <button type="button" onClick={() => onSetListPrice(collectionStats.floorPrice.toFixed(2))} className="text-banana hover:underline ml-auto">
                      Use floor
                    </button>
                  </div>
                )}
              </div>

              <ListingDurationPicker
                durationSeconds={listDurationSeconds}
                onChange={onSetListDurationSeconds}
              />

              {txError && (
                <div className="p-3 bg-error/10 border border-error/30 rounded-xl mb-4">
                  <p className="text-error text-sm">{txError}</p>
                </div>
              )}

              {listPrice && parseFloat(listPrice) > 0 && (
                <div className="p-4 bg-bg-primary border border-bg-tertiary rounded-xl mb-6 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Listing price</span>
                    <span className="text-text-primary font-mono">${parseFloat(listPrice).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">OpenSea fee (1%)</span>
                    <span className="text-text-muted font-mono">-${(parseFloat(listPrice) * 0.01).toFixed(2)}</span>
                  </div>
                  <div className="border-t border-bg-tertiary pt-2 flex justify-between text-sm font-medium">
                    <span className="text-text-secondary">You receive</span>
                    <span className="text-success font-mono">${(parseFloat(listPrice) * 0.99).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 pt-0">
              <button
                onClick={onHandleList}
                disabled={!listPrice || parseFloat(listPrice) <= 0}
                className="w-full py-4 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                List for ${listPrice ? parseFloat(listPrice).toLocaleString() : '0'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && successType === 'list' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onCloseSuccessModal}>
          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-sm p-8 text-center" onClick={event => event.stopPropagation()}>
            <div className="w-16 h-16 mx-auto mb-6 bg-success/20 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-text-primary font-semibold text-lg mb-2">Team Listed!</h3>
            <p className="text-text-secondary text-sm mb-6">Your team is now live on the marketplace.</p>
            {selectedTeam && (
              <Link
                href={`/marketplace/${selectedTeam.tokenId}`}
                onClick={onCloseSuccessModal}
                className="w-full py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all block mb-3"
              >
                View Listing
              </Link>
            )}
            <button onClick={onCloseSuccessModal} className="w-full py-3 border border-bg-tertiary text-text-secondary rounded-xl hover:bg-bg-tertiary transition-all text-sm">
              Back to Marketplace
            </button>
          </div>
        </div>
      )}

      {cancelConfirmTeam && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => onHandleCancel(null)}>
          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-sm p-6" onClick={event => event.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-4 bg-error/10 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-text-primary font-semibold text-lg mb-2">Cancel Listing?</h3>
              <p className="text-text-secondary text-sm">
                Remove <span className="text-text-primary font-mono font-medium">{cancelConfirmTeam.name}</span> from sale at ${cancelConfirmTeam.price?.toFixed(2)}?
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => onHandleCancel(null)}
                className="flex-1 py-3 border border-bg-tertiary text-text-secondary rounded-xl hover:bg-bg-tertiary transition-all text-sm font-medium"
              >
                Keep Listed
              </button>
              <button
                onClick={() => onExecuteCancel(cancelConfirmTeam)}
                disabled={cancellingTokenId === cancelConfirmTeam.tokenId}
                className="flex-1 py-3 bg-error text-white rounded-xl hover:brightness-110 transition-all text-sm font-semibold disabled:opacity-50"
              >
                {cancellingTokenId === cancelConfirmTeam.tokenId ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SellTabOfferBadge({ tokenId }: { tokenId: string }) {
  const { bestOffer } = useNftOffers(tokenId);
  if (!bestOffer) return null;
  return <p className="mt-0.5 text-[10.5px] text-text-muted font-mono">Best offer <span className="text-banana font-semibold">${bestOffer.amount.toFixed(2)}</span></p>;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
// ~100 years — Seaport orderbook treats this as effectively permanent.
const NO_EXPIRY_SECONDS = 100 * 365 * DAY;

const PRESETS: Array<{ label: string; seconds: number }> = [
  { label: '1 hour', seconds: HOUR },
  { label: '24 hours', seconds: DAY },
  { label: '3 days', seconds: 3 * DAY },
  { label: '1 week', seconds: 7 * DAY },
  { label: '1 month', seconds: 30 * DAY },
  { label: 'No expiry', seconds: NO_EXPIRY_SECONDS },
];

function splitDuration(totalSeconds: number): { days: number; hours: number; minutes: number } {
  let s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / DAY); s -= days * DAY;
  const hours = Math.floor(s / HOUR); s -= hours * HOUR;
  const minutes = Math.floor(s / 60);
  return { days, hours, minutes };
}

function ListingDurationPicker({
  durationSeconds,
  onChange,
}: {
  durationSeconds: number;
  onChange: (seconds: number) => void;
}) {
  const matchedPreset = PRESETS.find(p => p.seconds === durationSeconds);
  const [showCustom, setShowCustom] = useState(!matchedPreset);
  const initial = splitDuration(durationSeconds === NO_EXPIRY_SECONDS ? 30 * DAY : durationSeconds);
  const [days, setDays] = useState<string>(String(initial.days));
  const [hours, setHours] = useState<string>(String(initial.hours));
  const [minutes, setMinutes] = useState<string>(String(initial.minutes));

  const applyCustom = (d: string, h: string, m: string) => {
    const dn = Math.max(0, Math.floor(parseFloat(d) || 0));
    const hn = Math.max(0, Math.floor(parseFloat(h) || 0));
    const mn = Math.max(0, Math.floor(parseFloat(m) || 0));
    const seconds = dn * DAY + hn * HOUR + mn * 60;
    if (seconds < 60) return; // Seaport floor; createListing also enforces this
    onChange(seconds);
  };

  const totalSeconds = (Math.max(0, parseInt(days) || 0) * DAY)
    + (Math.max(0, parseInt(hours) || 0) * HOUR)
    + (Math.max(0, parseInt(minutes) || 0) * 60);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-text-secondary text-sm">Listing duration</label>
        <button
          type="button"
          onClick={() => setShowCustom(s => !s)}
          className="text-banana hover:underline text-xs"
        >
          {showCustom ? 'Use preset' : 'Custom'}
        </button>
      </div>
      {!showCustom ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {PRESETS.map(({ label, seconds }) => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(seconds)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                durationSeconds === seconds
                  ? 'bg-banana/15 border-banana text-banana'
                  : 'bg-bg-primary border-bg-tertiary text-text-secondary hover:border-bg-elevated hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['Days', days, setDays, '0'],
              ['Hours', hours, setHours, '0'],
              ['Minutes', minutes, setMinutes, '0'],
            ] as const).map(([label, value, setter, placeholder]) => (
              <label key={label} className="block">
                <span className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">{label}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={value}
                  placeholder={placeholder}
                  onChange={e => {
                    const next = e.target.value;
                    setter(next);
                    if (label === 'Days') applyCustom(next, hours, minutes);
                    else if (label === 'Hours') applyCustom(days, next, minutes);
                    else applyCustom(days, hours, next);
                  }}
                  className="w-full bg-bg-primary border border-bg-tertiary rounded-lg px-3 py-2 text-text-primary font-mono text-sm focus:outline-none focus:border-banana"
                />
              </label>
            ))}
          </div>
          <p className="text-text-muted text-[11px] mt-2">
            {totalSeconds < 60
              ? 'Minimum 1 minute.'
              : `Listing will end ${new Date(Date.now() + totalSeconds * 1000).toLocaleString()}`}
          </p>
        </>
      )}
    </div>
  );
}
