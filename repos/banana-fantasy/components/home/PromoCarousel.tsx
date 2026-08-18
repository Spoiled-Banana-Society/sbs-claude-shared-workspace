'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Promo } from '@/types';
import { PromoModal } from '../modals/PromoModal';
import { PromoMiniCard } from '@/components/promos/PromoMiniCard';
import { useAuth } from '@/hooks/useAuth';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { API_CONFIG } from '@/lib/api/config';

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
  // Pick-slot ladder removed 2026-07-26 — see app/promos/page.tsx.
  const VISIBLE_COUNT = useVisibleCount();

  const [currentIndex, setCurrentIndex] = useState(0);
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
              const isClaimed = claimedPromos.has(promo.id) || (promo.type === 'new-user' && newUserPromoClaimed);
              return (
                <PromoMiniCard
                  key={`${promo.id}-${index}`}
                  promo={promo}
                  wallet={user?.walletAddress ?? null}
                  isClaimed={isClaimed}
                  hasVisibleClaim={hasVisibleClaim(promo)}
                  onOpen={() => handlePromoClick(promo)}
                  onClaim={(e) => void handleClaim(promo, e)}
                  fpVariant={fpVariant}
                  fpShowNewPlayerTag={fpShowNewPlayerTag}
                  fixed
                />
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
