'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Promo } from '@/types';
import { PromoModal } from '../modals/PromoModal';
import { useAuth } from '@/hooks/useAuth';
import { useEliminatorMe } from '@/hooks/useEliminatorMe';
import { DropCountdown } from '@/components/promos/DropCountdown';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { API_CONFIG } from '@/lib/api/config';
import { SpinExplainer } from '@/components/promos/SpinExplainer';
import { deriveChaseState } from '@/lib/chasePromo';
import { firstPurchaseCardLines } from '@/lib/firstPurchaseCopy';

interface PromoCarouselProps {
  /** Section title — wheel page says 'Promos to Earn Spins', everywhere else plain 'Promos'. */
  heading?: string;
  promos: Promo[];
  autoPlay?: boolean;
  claimPromo?: (promoId: string) => Promise<{ spinsAdded: number } | Error | null>;
  onVerifyTweet?: (promoId: string) => Promise<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string } | null>;
  onGenerateReferralCode?: () => Promise<{ code: string; link: string } | null>;
}

const CARD_WIDTH = 208; // w-52 = 13rem = 208px
const GAP = 20; // gap-5 = 1.25rem = 20px

function useVisibleCount() {
  const [count, setCount] = useState(3);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setCount(w < 640 ? 1 : w < 900 ? 2 : 3);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return count;
}

export function PromoCarousel({ promos, claimPromo, onVerifyTweet, onGenerateReferralCode, heading = 'Promos' }: PromoCarouselProps) {
  const { user, updateUser, isLoggedIn, setShowLoginModal, newUserPromoClaimed, isTwitterVerified, isBB3Holder, isBalanceLoaded } = useAuth();
  // Live Eliminator standing for the card front — your Banana count and
  // whether you're holding one of the 5 seats (Richard 2026-07-31).
  const elimMe = useEliminatorMe(user?.walletAddress);
  // Pick-slot ladder removed 2026-07-26 — see app/promos/page.tsx.
  const VISIBLE_COUNT = useVisibleCount();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedPromo, setSelectedPromo] = useState<Promo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Sync selectedPromo with parent promos array (e.g. after verify sets claimable: true)
  useEffect(() => {
    if (selectedPromo) {
      const updated = promos.find((p) => p.id === selectedPromo.id);
      if (updated && (updated.claimable !== selectedPromo.claimable || updated.claimCount !== selectedPromo.claimCount)) {
        setSelectedPromo(updated);
      }
    }
  }, [promos, selectedPromo]);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [claimedPromos, setClaimedPromos] = useState<Set<string>>(new Set());
  const [_timerTick, setTimerTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if a promo's CLAIM button is actually visible in the UI
  const hasVisibleClaim = (p: Promo) => {
    if (!p.claimable || claimedPromos.has(p.id)) return false;
    if ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) return false;
    return true;
  };

  // Shared filter + sort: whitelist of 6 visible promo types, in
  // Boris's fixed order, with in-progress / claimable promos bubbled
  // to position 1. See lib/promoFilter.ts.
  const sortedPromos = filterAndSortVisiblePromos(promos, {
    isBB3Holder,
    newUserPromoClaimed,
    hasSpunWheel: !!user?.hasSpunWheel,
    firstPurchaseBonusGranted: !!user?.firstPurchaseBonusGranted,
    firstPurchasePromoUnlocked: !!user?.firstPurchasePromoUnlocked,
    flagsKnown: isBalanceLoaded,
    isLoggedIn,
    hasVisibleClaim: (p) => hasVisibleClaim(p),
    isAdminPreview: isWalletAdmin(user?.walletAddress),
  });

  // First-purchase card body copy tracks the server-computed variant (new /
  // returning). Logged-out or not-yet-loaded → new-player copy, explicitly
  // labeled "NEW PLAYERS" so a returning player who logs in later and gets
  // the classic rate never feels baited.
  const fpVariant = user?.firstPurchaseVariant === 'returning' ? 'returning' : 'new';
  const fpShowNewPlayerTag = !isLoggedIn || user?.firstPurchaseVariant == null;

  // When every card fits in the viewport (e.g. logged-out shows only the
  // 2 conversion cards), there's nothing to scroll: skip the clones and
  // arrows and let the viewport hug the cards so they sit centered.
  const isStatic = sortedPromos.length <= VISIBLE_COUNT;

  // Create extended array with clones for infinite loop
  const extendedPromos = isStatic ? sortedPromos : [...sortedPromos, ...sortedPromos, ...sortedPromos];
  const startOffset = isStatic ? 0 : sortedPromos.length; // Start at the middle copy

  // Snap back to the first promo ONLY when the ORDER / claim state actually
  // changes — a new claim becomes available, a promo is added/removed, or the
  // sort reorders (e.g. after minting). NOT on every parent re-render: the parent
  // hands down a NEW `promos` array reference on each refetch/poll even when the
  // content is identical, and depending on that raw reference yanked the user
  // back to promo #1 a second after they swiped (mobile bug). A stable signature
  // of the sorted id-order + claim state fires the reset only on a REAL change,
  // so a manual swipe sticks until refresh or a genuine reorder/claim — matching
  // desktop. (Progress ticking up within the same order does NOT snap back.)
  const orderSignature = sortedPromos
    .map((p) => `${p.id}:${p.claimable ? 1 : 0}:${p.claimCount ?? 0}`)
    .join('|');
  useEffect(() => {
    setCurrentIndex(startOffset);
  }, [orderSignature, startOffset]);

  // Timer tick for countdown updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTimerTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format time remaining - shows 24:00:00 if timer hasn't started
  const formatTimeRemaining = (endTime?: string) => {
    if (!endTime) return '24:00:00';

    const now = Date.now();
    const end = new Date(endTime).getTime();
    const diff = end - now;

    if (diff <= 0) return '0:00:00';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const goBack = () => {
    setIsTransitioning(true);
    setCurrentIndex(prev => prev - 1);
  };

  const goForward = () => {
    setIsTransitioning(true);
    setCurrentIndex(prev => prev + 1);
  };

  // Handle infinite loop reset
  useEffect(() => {
    if (isStatic) return; // no clones → nothing to jump between
    const handleTransitionEnd = () => {
      // If we've gone too far left, jump to middle copy
      if (currentIndex < VISIBLE_COUNT) {
        setIsTransitioning(false);
        setCurrentIndex(currentIndex + sortedPromos.length);
      }
      // If we've gone too far right, jump to middle copy
      else if (currentIndex >= sortedPromos.length * 2) {
        setIsTransitioning(false);
        setCurrentIndex(currentIndex - sortedPromos.length);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('transitionend', handleTransitionEnd);
      return () => container.removeEventListener('transitionend', handleTransitionEnd);
    }
  }, [currentIndex, sortedPromos.length, isStatic]);

  const handlePromoClick = (promo: Promo) => {
    setSelectedPromo(promo);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedPromo(null);
  };

  const handleClaim = async (promo: Promo, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // If not logged in, show login modal
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    const count = promo.claimCount || 1;
    // NOTE: a promo claim must NEVER pre-determine a draft's type. Draft type
    // (Jackpot/HOF/Pro) is decided solely by the backend's provably-fair
    // guaranteed distribution at fill time. The old reservePromoDraftType()
    // call here forced the next draft's outcome — removed as a rigging vector.

    // Use real backend claim if available — celebration modal fires
    // centrally from usePromos.claimPromo via ClaimCelebrationContext.
    if (claimPromo) {
      const result = await claimPromo(promo.id);
      if (result instanceof Error) return;
      return;
    }

    // Fallback: local-only claim (no backend). Still mark claimed
    // locally + bump balance optimistically; no celebration modal here
    // because we'd be lying about a backend reward.
    setClaimedPromos(prev => new Set([...Array.from(prev), promo.id]));
    if (user) {
      if (promo.type === 'buy-bonus' && API_CONFIG.promos.buyBonus.reward === 'draft') {
        updateUser({ freeDrafts: (user.freeDrafts || 0) + count });
      } else {
        updateUser({ wheelSpins: (user.wheelSpins || 0) + count });
      }
    }
  };

  const translateX = isStatic ? 0 : -(currentIndex * (CARD_WIDTH + GAP));
  // Viewport hugs the actual card count when everything fits (static mode),
  // so the outer justify-center centers 1–2 cards instead of leaving a
  // 3-wide viewport with dead space on the right.
  const viewportCards = Math.min(VISIBLE_COUNT, Math.max(sortedPromos.length, 1));

  return (
    <div className="space-y-4">
      {/* Section Title */}
      <h2 className="text-2xl font-bold text-text-primary text-center">{heading}</h2>

      {/* Carousel with arrows */}
      <div className="flex items-center justify-center gap-6">
        {/* Left Arrow */}
        {!isStatic && (
        <button
          onClick={goBack}
          className="p-2.5 rounded-full transition-all duration-200 flex-shrink-0 border border-white/30 text-white/60 hover:border-banana hover:text-banana active:scale-95"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        )}

        {/* Promo Cards Container */}
        <div
          className="overflow-hidden py-4 -my-4"
          style={{ width: `${viewportCards * CARD_WIDTH + (viewportCards - 1) * GAP + 16}px`, paddingLeft: '8px', paddingRight: '8px', marginLeft: '-8px', marginRight: '-8px' }}
        >
          <div
            ref={containerRef}
            className="flex gap-5"
            style={{
              transform: `translateX(${translateX}px)`,
              transition: isTransitioning ? 'transform 400ms ease-out' : 'none'
            }}
          >
            {extendedPromos.map((promo, index) => {
              const isHovered = index === hoveredIndex;
              const promoTitle = promo.title;
              const isClaimed = claimedPromos.has(promo.id) || (promo.type === 'new-user' && newUserPromoClaimed);
              const hasProgress = promo.progressMax !== undefined && promo.progressMax > 0;
              const showProgressBar = hasProgress || isClaimed;
              const progressMax = (promo.type === 'new-user' || promo.type === 'tweet-engagement') ? 0 : (promo.progressMax || 10);
              // Stacking promos (Buy-10 spin, buy-bonus) repeat — after a
              // claim the bar keeps showing real rolled-over progress (0/10),
              // never a forced full bar (reads as "done, can't earn again").
              const isStacking = promo.type === 'mint' || promo.type === 'buy-bonus';
              const progressCurrent = (promo.type === 'new-user' || promo.type === 'tweet-engagement') ? 0 : (isClaimed && !isStacking ? progressMax : (promo.progressCurrent || 0));
              const progressPercent = isClaimed && !isStacking ? 100 : (hasProgress
                ? ((promo.progressCurrent || 0) / promo.progressMax!) * 100
                : 0);
              // ⚠️ `featured` means PINNED TO POSITION 1 — it does not mean
              // Kickoff. This used to read `!!promo.featured`, so the moment
              // any other promo was featured it inherited the themed stripe,
              // corner marks and a literal event chip. That shipped on
              // 2026-07-31: THE ELIMINATOR went out featured and users
              // screenshotted it asking why a July promo said July 4th.
              // The Kickoff treatment belongs to buy-bonus and nothing else.
              const isKickoff = !!promo.featured && promo.type === 'buy-bonus';
              // Chase Your Pick live state — pick slot, next-hit spins, 24h clock.
              const isChase = promo.type === 'pick-chase';
              const chase = isChase ? deriveChaseState(promo) : null;
              return (
                <div
                  key={`${promo.id}-${index}`}
                  onClick={() => handlePromoClick(promo)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className={`
                    relative overflow-hidden rounded-[20px] p-5 w-52 h-60 flex-shrink-0 transition-all duration-200 cursor-pointer
                    bg-[#fbfbfd]
                    ${isHovered
                      ? 'border-2 border-banana shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                      : 'border border-[#d2d2d7] shadow-sm'}
                  `}
                >
                  {/* Kickoff featured treatment — turf stripe only (corner footballs
                      removed, Richard 2026-08-06: the chip's football is the only one). */}
                  {isKickoff && (
                    <div className="absolute inset-x-0 top-0 h-1.5 z-20 pointer-events-none bg-gradient-to-r from-[#22c55e] via-[#fbbf24] to-[#22c55e]" />
                  )}

                  {/* Hover overlay */}
                  <div className={`absolute inset-0 bg-[#f5f5f7] pointer-events-none transition-opacity duration-300 z-10 ${isHovered ? 'opacity-50' : 'opacity-0'}`} />

                  {/* Hover text - positioned between title and bottom content (for promos without progress bar or claim) */}
                  <div className={`absolute left-0 right-0 top-1/2 text-center pointer-events-none transition-opacity duration-300 z-20 ${isHovered && ((!promo.claimable && !showProgressBar) || ((promo.type === 'new-user' || promo.type === 'tweet-engagement') && (!(isLoggedIn && isTwitterVerified) || isClaimed))) ? 'opacity-100' : 'opacity-0'}`}>
                    <span className="text-[#1d1d1f] text-xs font-semibold">
                      Learn more
                    </span>
                  </div>

                  {/* NEW Badge */}
                  {promo.isNew && (
                    <div className="absolute -right-1 -top-1 z-30">
                      {/* One consistent banana-yellow NEW ribbon for every promo
                          (Boris 2026-07-03 — no per-promo color variants). */}
                      <span className="inline-block text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-lg transform rotate-12 border bg-banana text-[#1d1d1f] border-banana/50">
                        NEW
                      </span>
                    </div>
                  )}

                  <div className="relative flex flex-col h-full items-center justify-center text-center">
                    <h4 className="font-semibold text-[#1d1d1f] text-lg leading-snug tracking-tight">
                      {promoTitle.includes('→') ? (
                        <>
                          <span>{promoTitle.split('→')[0].trim()}</span>
                          <br/>
                          <span className="text-[#4a4a4a] text-sm mt-1 inline-block font-semibold">
                            → {promoTitle.split('→')[1].trim()}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm whitespace-nowrap">{promoTitle}</span>
                      )}
                    </h4>
                    {/* FIRST-PURCHASE ONLY (Boris 2026-07-13): full offer copy
                        on the box front as FIXED LINES — each line is one
                        complete idea and can never wrap mid-phrase ("40" on
                        one line, "Drafts" on the next read broken). Lines are
                        variant-aware (new vs returning classic rate) and the
                        logged-out default carries a NEW PLAYERS label. */}
                    {promo.type === 'first-purchase' && (
                      <div className="mt-1.5 px-1 text-center text-[10px] leading-relaxed text-[#4a4a4a]">
                        {fpShowNewPlayerTag && (
                          <span className="block whitespace-nowrap font-bold uppercase tracking-wider text-[9px] text-[#1d1d1f]">New players</span>
                        )}
                        {firstPurchaseCardLines(fpVariant, promo.description).map((line) => (
                          <span key={line} className="block whitespace-nowrap">{line}</span>
                        ))}
                      </div>
                    )}
                    {/* ELIMINATOR ONLY — your live standing on the card front.
                        The board lives on /promos, but the number people care
                        about is their own, so it rides here too: Banana count
                        plus whether they're currently holding a seat. */}
                    {promo.type === 'eliminator' && elimMe.bananas !== null && (
                      <div className="mt-1.5 flex flex-col items-center gap-1">
                        <span className="text-sm font-bold text-[#1d1d1f] tabular-nums">
                          🍌 {elimMe.bananas}
                        </span>
                        {elimMe.inTop5 ? (
                          <span className="inline-flex items-center rounded-full bg-[#1d1d1f] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">
                            Top 5 · surviving
                          </span>
                        ) : elimMe.onList ? (
                          <span className="text-[10px] text-[#4a4a4a]">
                            <span className="font-bold">{elimMe.bananasToSeat}</span> from a seat
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#4a4a4a]">Not on the list</span>
                        )}
                      </div>
                    )}
                    {/* THE DROP's countdown lives in the FOOTER with the other
                        promo timers — see the isDrop block below. */}
                    <SpinExplainer promoTitle={promoTitle} promoType={promo.type} className="mt-1.5 block px-2 text-center text-[10px] leading-snug text-[#4a4a4a]" />
                    {/* Full front info everywhere (Boris 2026-08-09): every card
                        carries the same description the /promos page card shows.
                        First-purchase keeps its bespoke fixed lines above. */}
                    {promo.type !== 'first-purchase' && promo.description && (
                      <p className="mt-1.5 px-1 text-center text-[10px] leading-snug text-[#4a4a4a] line-clamp-2">
                        {promo.description}
                      </p>
                    )}

                    <div className="mt-auto w-full flex flex-col justify-end">
                      {/* Daily drafts - show progress + timer + claim if available */}
                      {promo.type === 'daily-drafts' && (
                        <div className="-mt-2">
                          <div className="flex justify-center items-center gap-2 text-xs text-[#4a4a4a] mb-1">
                            <span className="font-semibold">{progressCurrent}/{progressMax}</span>
                            <span className="text-[#9a9a9a]">•</span>
                            <span className="text-[15px] font-bold tabular-nums text-[#1d1d1f]">{formatTimeRemaining(promo.timerEndTime)}</span>
                          </div>
                          <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#1d1d1f] rounded-full transition-all duration-500"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          {promo.claimable && !isClaimed ? (
                            <>
                              <button
                                onClick={(e) => handleClaim(promo, e)}
                                onMouseEnter={() => setHoveredIndex(index)}
                                className="relative w-full mt-2 py-1.5 bg-banana text-[#1d1d1f] text-[10px] font-bold rounded-full text-center active:scale-[0.98] transition-all duration-200 z-30 hover:scale-105 "
                              >
                                {promo.claimCount && promo.claimCount > 1 ? `CLAIM (${promo.claimCount})` : 'CLAIM'}
                              </button>
                              <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-1 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                                Learn more
                              </p>
                            </>
                          ) : (
                            <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                              Learn more
                            </p>
                          )}
                        </div>
                      )}

                      {/* Banana Draw — same bottom layout as Match Your Pick and
                          4-in-24h so the countdown lands at the SAME vertical spot:
                          optional stat row, timer row, then the invisible spacer
                          that matches the other promos' progress-bar height.
                          Was missing entirely, so the homepage card showed no clock
                          at all (Boris 2026-07-26). */}
                      {promo.type === 'banana-draw' && (
                        <div className="-mt-2">
                          {(promo.modalContent.bananaDraw?.bananas ?? 0) > 0 && (
                            <div className="flex items-center justify-center gap-1 text-[9.5px] text-[#4a4a4a] mb-0.5 whitespace-nowrap">
                              <span className="font-bold text-[#ef6c37]">🍌 {promo.modalContent.bananaDraw?.bananas}</span>
                              {(promo.modalContent.bananaDraw?.pending ?? 0) > 0 && (
                                <>
                                  <span className="text-[#c4c4c8]">·</span>
                                  <span className="font-semibold">{promo.modalContent.bananaDraw?.pending} filling</span>
                                </>
                              )}
                            </div>
                          )}
                          <div className="flex justify-center items-center mb-1">
                            <span className="text-[15px] font-bold tabular-nums text-[#1d1d1f]">{formatTimeRemaining(promo.timerEndTime) || '24:00:00'}</span>
                          </div>
                          <div className="h-1.5" aria-hidden="true" />
                          <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                            Learn more
                          </p>
                        </div>
                      )}

                      {/* THE DROP — same bottom layout as Match Your Pick so its
                          countdown lands at the SAME vertical spot (Richard
                          2026-08-02). It used to sit up under the title, which
                          left dead space at the bottom and made the card look
                          unlike every other promo in the row. */}
                      {promo.type === 'drop' && (
                        <div className="-mt-2">
                          <div className="flex justify-center items-center mb-1 text-[#1d1d1f]">
                            <DropCountdown className="text-[15px] font-bold" wallet={user?.walletAddress ?? null} />
                          </div>
                          {/* Invisible spacer = the 4-in-24h progress-bar height,
                              so every timer in the row sits at the same height. */}
                          <div className="h-1.5" aria-hidden="true" />
                          <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                            Learn more
                          </p>
                        </div>
                      )}

                      
                      {/* Around The Banana (Boris 2026-08-12): the covered pick
                          slots + live seats-left — same payload the /promos card
                          reads, restamped on every promos refresh. */}
                      {promo.type === 'around-the-banana' && (() => {
                        const atb = promo.modalContent?.aroundTheBanana;
                        const hitCount = (atb?.slotsHit ?? []).length;
                        const seatsLeft = Math.max(0, (atb?.seatsTotal ?? 10) - (atb?.seatsClaimed ?? 0));
                        return (
                          <div className="-mt-2">
                            <div className="grid grid-cols-10 gap-[3px] mb-1">
                              {Array.from({ length: 10 }, (_, i) => i + 1).map((sl) => {
                                const hit = (atb?.slotsHit ?? []).includes(sl);
                                return (
                                  <div key={sl} className="h-4 rounded flex items-center justify-center text-[7.5px] font-bold tabular-nums"
                                    style={hit ? { background: '#ef4444', color: '#fff' } : { background: '#e8e8ed', color: '#9a9a9a' }}>
                                    {sl}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex justify-center items-center gap-1 text-[11px] text-[#4a4a4a] mb-1 whitespace-nowrap">
                              {/* Winners can win again next round — keep the live race visible. */}
                              {atb?.won ? (
                                <>
                                  <span className="font-bold text-[#ef4444]">Won Seat {atb.seatNumber}</span>
                                  <span className="text-[#c4c4c8]">·</span>
                                  <span className="font-bold text-[#ef4444]">{hitCount}/10</span>
                                  <span className="text-[#c4c4c8]">·</span>
                                  <span className="font-semibold">{seatsLeft} seats left</span>
                                </>
                              ) : (
                                <>
                                  <span className="font-bold text-[#ef4444]">{hitCount}/10 slots</span>
                                  <span className="text-[#c4c4c8]">·</span>
                                  <span className="font-semibold">{seatsLeft} seats left</span>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Match Your Pick — mirrors the 4-in-24h bottom layout so the
                          countdown lands at the SAME vertical spot: timer row, then a
                          spacer the height of that promo's progress bar. Once a draft
                          locks a pick, the slot · attempt · next-hit Spins show above. */}
                      {isChase && (
                        <div className="-mt-2">
                          {chase?.active && (
                            <div className="flex items-center justify-center gap-1 text-[9.5px] text-[#4a4a4a] mb-0.5 whitespace-nowrap">
                              <span className="font-bold text-[#1d1d1f]">Pick {chase.slot}</span>
                              <span className="text-[#c4c4c8]">·</span>
                              <span className="font-semibold">Att {chase.attempt}</span>
                              <span className="text-[#c4c4c8]">→</span>
                              <span className="font-bold text-[#f97316]">{chase.nextHit} {chase.nextHit === 1 ? 'Spin' : 'Spins'}{chase.isMax ? ' MAX' : ''}</span>
                            </div>
                          )}
                          <div className="flex justify-center items-center mb-1">
                            <span className="text-[15px] font-bold tabular-nums text-[#1d1d1f]">{formatTimeRemaining(promo.timerEndTime)}</span>
                          </div>
                          {/* Invisible spacer = the 4-in-24h progress-bar height (h-1.5),
                              so both timers sit at the same height. */}
                          <div className="h-1.5" aria-hidden="true" />
                          <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                            Learn more
                          </p>
                        </div>
                      )}

                      {/* Mint & Pick 10 promo - show progress + claim if available.
                          Binary promos (max <= 1) skip the counter+bar — "0/1"
                          says nothing (Boris 2026-06-11). */}
                      {(promo.type === 'mint' || promo.type === 'pick-10') && (
                        <div className="-mt-2">
                          {progressMax > 1 && (
                            <>
                              <div className="flex justify-center text-xs text-[#4a4a4a] mb-1">
                                <span className="font-semibold">{progressCurrent}/{progressMax}</span>
                              </div>
                              <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#1d1d1f] rounded-full transition-all duration-500"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                            </>
                          )}
                          {promo.claimable && !isClaimed ? (
                            <>
                              <button
                                onClick={(e) => handleClaim(promo, e)}
                                onMouseEnter={() => setHoveredIndex(index)}
                                className="relative w-full mt-2 py-1.5 bg-banana text-[#1d1d1f] text-[10px] font-bold rounded-full text-center active:scale-[0.98] transition-all duration-200 z-30 hover:scale-105 "
                              >
                                {promo.claimCount && promo.claimCount > 1 ? `CLAIM (${promo.claimCount})` : 'CLAIM'}
                              </button>
                              <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-1 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                                Learn more
                              </p>
                            </>
                          ) : (
                            <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                              Learn more
                            </p>
                          )}
                        </div>
                      )}

                      {/* Progress bar - show for other promos with progress (not daily-drafts, mint, pick-10, pick-chase, new-user, tweet-engagement) */}
                      {promo.type !== 'daily-drafts' && promo.type !== 'mint' && promo.type !== 'pick-10' && promo.type !== 'pick-chase' && promo.type !== 'around-the-banana' && promo.type !== 'new-user' && promo.type !== 'tweet-engagement' && (showProgressBar && (!promo.claimable || isClaimed)) && (
                        <div className="-mt-2">
                          {/* Kickoff: drafts counted toward the 20-draft cap + live
                              countdown to the Sunday-night cutoff (timerEndTime is
                              stamped server-side while the window is open). */}
                          {isKickoff && (
                            <div className="mb-0.5 flex flex-col items-center gap-0.5">
                              <span className="text-xs font-semibold whitespace-nowrap text-[#4a4a4a]">{progressCurrent}/{progressMax} · {Math.min(promo.modalContent?.totalMinted || 0, API_CONFIG.promos.buyBonus.maxPassesCounted)}/{API_CONFIG.promos.buyBonus.maxPassesCounted} drafts · Max {API_CONFIG.promos.buyBonus.maxPassesCounted}</span>
                              {promo.timerEndTime && (
                                <span className="text-[15px] font-bold tabular-nums text-[#1d1d1f]">{formatTimeRemaining(promo.timerEndTime)}</span>
                              )}
                            </div>
                          )}
                          {progressMax > 1 && (
                            <>
                              {/* Kickoff hides this counter — its stat row above already
                                  carries the numbers; two number lines overflowed the
                                  fixed-height card (Richard 2026-08-06). */}
                              {!isKickoff && (
                                <div className="flex justify-center text-xs text-[#4a4a4a] mb-1">
                                  <span className="font-semibold">{progressCurrent}/{progressMax}</span>
                                </div>
                              )}
                              <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${isKickoff ? 'bg-gradient-to-r from-[#22c55e] to-[#fbbf24]' : 'bg-[#1d1d1f]'}`}
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                            </>
                          )}
                          <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                            Learn more
                          </p>
                        </div>
                      )}

                      {/* Claimable button - for other promos (not daily-drafts, mint, pick-10) */}
                      {promo.type !== 'daily-drafts' && promo.type !== 'mint' && promo.type !== 'pick-10' && promo.claimable && !isClaimed && ((promo.type !== 'new-user' && promo.type !== 'tweet-engagement') || (isLoggedIn && isTwitterVerified)) && (
                        <div className="pt-6">
                          <button
                            onClick={(e) => handleClaim(promo, e)}
                            onMouseEnter={() => setHoveredIndex(index)}
                            className="relative w-full py-2.5 bg-banana text-[#1d1d1f] text-xs font-bold rounded-full text-center active:scale-[0.98] transition-all duration-200 z-30 hover:scale-110 "
                          >
                            {promo.claimCount && promo.claimCount > 1 ? `CLAIM (${promo.claimCount})` : 'CLAIM'}
                          </button>
                          <p className={`text-center text-xs text-[#1d1d1f] font-semibold mt-1 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                            Learn more
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Arrow */}
        {!isStatic && (
        <button
          onClick={goForward}
          className="p-2.5 rounded-full transition-all duration-200 flex-shrink-0 border border-white/30 text-white/60 hover:border-banana hover:text-banana active:scale-95"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        )}
      </div>

      {/* Promo Modal */}
      <PromoModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        promo={selectedPromo}
        onClaim={handleClaim}
        isPromoClaimed={selectedPromo ? claimedPromos.has(selectedPromo.id) : false}
        onVerifyTweet={onVerifyTweet}
        onGenerateReferralCode={onGenerateReferralCode}
      />
      {/* The "Claimed" celebration modal used to render here inline.
          It's now centralized in ClaimCelebrationProvider (app/providers.tsx)
          + fired from usePromos.claimPromo on success, so every claim
          path across the app produces the same banana-shower celebration. */}
    </div>
  );
}
