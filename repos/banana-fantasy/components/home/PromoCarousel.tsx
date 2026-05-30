'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Promo } from '@/types';
import { PromoModal } from '../modals/PromoModal';
import { useAuth } from '@/hooks/useAuth';
import { reservePromoDraftType } from '@/lib/promoDraftType';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import { SpinExplainer } from '@/components/promos/SpinExplainer';

interface PromoCarouselProps {
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

export function PromoCarousel({ promos, claimPromo, onVerifyTweet, onGenerateReferralCode }: PromoCarouselProps) {
  const { user, updateUser, isLoggedIn, setShowLoginModal, newUserPromoClaimed, isTwitterVerified, isBB3Holder } = useAuth();
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
    firstPurchaseBonusGranted: !!user?.firstPurchaseBonusGranted,
    hasVisibleClaim: (p) => hasVisibleClaim(p),
  });

  // Create extended array with clones for infinite loop
  const extendedPromos = [...sortedPromos, ...sortedPromos, ...sortedPromos];
  const startOffset = sortedPromos.length; // Start at the middle copy

  // Reset carousel position when promos re-sort (e.g., after minting)
  useEffect(() => {
    setCurrentIndex(startOffset);
  }, [promos, startOffset]);

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
  }, [currentIndex, sortedPromos.length]);

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
    if (promo.type === 'jackpot' || promo.type === 'hof') {
      reservePromoDraftType(promo.type, count);
    }

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
      if (promo.type === 'buy-bonus') {
        updateUser({ freeDrafts: (user.freeDrafts || 0) + count });
      } else {
        updateUser({ wheelSpins: (user.wheelSpins || 0) + count });
      }
    }
  };

  const translateX = -(currentIndex * (CARD_WIDTH + GAP));

  return (
    <div className="space-y-4">
      {/* Section Title */}
      <h2 className="text-2xl font-bold text-text-primary text-center">Promos</h2>

      {/* Carousel with arrows */}
      <div className="flex items-center justify-center gap-6">
        {/* Left Arrow */}
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

        {/* Promo Cards Container */}
        <div
          className="overflow-hidden py-4 -my-4"
          style={{ width: `${VISIBLE_COUNT * CARD_WIDTH + (VISIBLE_COUNT - 1) * GAP + 16}px`, paddingLeft: '8px', paddingRight: '8px', marginLeft: '-8px', marginRight: '-8px' }}
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
              const isClaimed = claimedPromos.has(promo.id) || (promo.type === 'new-user' && newUserPromoClaimed);
              const hasProgress = promo.progressMax !== undefined && promo.progressMax > 0;
              const showProgressBar = hasProgress || isClaimed;
              const progressMax = (promo.type === 'new-user' || promo.type === 'tweet-engagement') ? 0 : (promo.progressMax || 10);
              const progressCurrent = (promo.type === 'new-user' || promo.type === 'tweet-engagement') ? 0 : (isClaimed ? progressMax : (promo.progressCurrent || 0));
              const progressPercent = isClaimed ? 100 : (hasProgress
                ? ((promo.progressCurrent || 0) / promo.progressMax!) * 100
                : 0);
              return (
                <div
                  key={`${promo.id}-${index}`}
                  onClick={() => handlePromoClick(promo)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className={`
                    relative overflow-hidden rounded-[20px] p-5 w-52 h-44 flex-shrink-0 transition-all duration-200 cursor-pointer
                    bg-[#fbfbfd]
                    ${isHovered
                      ? 'border-2 border-banana shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                      : 'border border-[#d2d2d7] shadow-sm'}
                  `}
                >
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
                      <span className="inline-block bg-banana text-[#1d1d1f] text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-lg transform rotate-12 border border-banana/50">
                        NEW
                      </span>
                    </div>
                  )}

                  <div className="relative flex flex-col h-full items-center justify-center text-center">
                    <h4 className="font-semibold text-[#1d1d1f] text-lg leading-snug tracking-tight">
                      {promo.title.includes('→') ? (
                        <>
                          <span>{promo.title.split('→')[0].trim()}</span>
                          <br/>
                          <span className="text-[#4a4a4a] text-sm mt-1 inline-block font-semibold">
                            → {promo.title.split('→')[1].trim()}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm whitespace-nowrap">{promo.title}</span>
                      )}
                    </h4>
                    <SpinExplainer promoTitle={promo.title} className="mt-1.5 block px-2 text-center text-[10px] leading-snug text-[#4a4a4a]" />

                    <div className="mt-auto w-full flex flex-col justify-end">
                      {/* Daily drafts - show progress + timer + claim if available */}
                      {promo.type === 'daily-drafts' && (
                        <div className="-mt-2">
                          <div className="flex justify-center items-center gap-2 text-xs text-[#4a4a4a] mb-1">
                            <span className="font-semibold">{progressCurrent}/{progressMax}</span>
                            <span className="text-[#9a9a9a]">•</span>
                            <span className="font-semibold">{formatTimeRemaining(promo.timerEndTime)}</span>
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

                      {/* Mint & Pick 10 promo - show progress + claim if available */}
                      {(promo.type === 'mint' || promo.type === 'pick-10') && (
                        <div className="-mt-2">
                          <div className="flex justify-center text-xs text-[#4a4a4a] mb-1">
                            <span className="font-semibold">{progressCurrent}/{progressMax}</span>
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

                      {/* Progress bar - show for other promos with progress (not daily-drafts, mint, pick-10, new-user, tweet-engagement) */}
                      {promo.type !== 'daily-drafts' && promo.type !== 'mint' && promo.type !== 'pick-10' && promo.type !== 'new-user' && promo.type !== 'tweet-engagement' && (showProgressBar && (!promo.claimable || isClaimed)) && (
                        <div className="-mt-2">
                          <div className="flex justify-center text-xs text-[#4a4a4a] mb-1">
                            <span className="font-semibold">{progressCurrent}/{progressMax}</span>
                          </div>
                          <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#1d1d1f] rounded-full transition-all duration-500"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
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
