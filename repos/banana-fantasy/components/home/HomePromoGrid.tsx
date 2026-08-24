'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Promo } from '@/types';
import { PromoModal } from '../modals/PromoModal';
import { PromoLongCard } from '@/components/promos/PromoCards';
import { useAuth } from '@/hooks/useAuth';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import { API_CONFIG } from '@/lib/api/config';

interface HomePromoGridProps {
  promos: Promo[];
  claimPromo?: (promoId: string) => Promise<{ spinsAdded: number } | Error | null>;
  onVerifyTweet?: (promoId: string) => Promise<{ verified: boolean; alreadyVerified?: boolean; hasReplied?: boolean; hasQuoted?: boolean; message?: string } | null>;
  onGenerateReferralCode?: () => Promise<{ code: string; link: string } | null>;
}

/**
 * Homepage promos — the same rectangle cards as /promos (Richard 2026-08-23),
 * replacing the left/right PromoCarousel. Every visible promo renders at once
 * in the two-column grid; no arrows, no clones, no swiping.
 */
export function HomePromoGrid({ promos, claimPromo, onVerifyTweet, onGenerateReferralCode }: HomePromoGridProps) {
  const router = useRouter();
  const { user, updateUser, isLoggedIn, setShowLoginModal, newUserPromoClaimed, isTwitterVerified, isBB3Holder, isBalanceLoaded } = useAuth();

  const [selectedPromo, setSelectedPromo] = useState<Promo | null>(null);
  const [claimedPromos, setClaimedPromos] = useState<Set<string>>(new Set());

  // Sync the open modal with promo updates (e.g. after verify sets claimable).
  useEffect(() => {
    if (!selectedPromo) return;
    const updated = promos.find((p) => p.id === selectedPromo.id);
    if (updated && (updated.claimable !== selectedPromo.claimable || updated.claimCount !== selectedPromo.claimCount)) {
      setSelectedPromo(updated);
    }
  }, [promos, selectedPromo]);

  const isClaimed = (p: Promo) =>
    claimedPromos.has(p.id) || (p.type === 'new-user' && newUserPromoClaimed);

  const hasVisibleClaim = (p: Promo) => {
    if (!p.claimable || claimedPromos.has(p.id)) return false;
    if ((p.type === 'new-user' || p.type === 'tweet-engagement') && !isTwitterVerified) return false;
    return true;
  };

  // Shared filter + sort — identical rules to the carousel and /promos.
  const sortedPromos = filterAndSortVisiblePromos(promos, {
    isBB3Holder,
    newUserPromoClaimed,
    hasSpunWheel: !!user?.hasSpunWheel,
    firstPurchaseBonusGranted: !!user?.firstPurchaseBonusGranted,
    firstPurchasePromoUnlocked: !!user?.firstPurchasePromoUnlocked,
    flagsKnown: isBalanceLoaded,
    isLoggedIn,
    hasVisibleClaim,
  });

  // First-purchase copy variant — same rule as the carousel and /promos.
  const fpVariant: 'new' | 'returning' = user?.firstPurchaseVariant === 'returning' ? 'returning' : 'new';
  const fpShowNewPlayerTag = !isLoggedIn || user?.firstPurchaseVariant == null;

  const handleClaim = async (promo: Promo) => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    const count = promo.claimCount || 1;
    // NOTE: a promo claim must NEVER pre-determine a draft's type — backend
    // guaranteed distribution only (see PromoCarousel history).
    if (claimPromo) {
      const result = await claimPromo(promo.id);
      if (result instanceof Error) return;
      return;
    }
    // Fallback: local-only claim (no backend).
    setClaimedPromos((prev) => new Set([...Array.from(prev), promo.id]));
    if (user) {
      if (promo.type === 'buy-bonus' && API_CONFIG.promos.buyBonus.reward === 'draft') {
        updateUser({ freeDrafts: (user.freeDrafts || 0) + count });
      } else {
        updateUser({ wheelSpins: (user.wheelSpins || 0) + count });
      }
    }
  };

  if (sortedPromos.length === 0) return null;

  return (
    <div>
      {/* Section header — matches the /promos hero language. */}
      <div className="flex items-end justify-between mb-4">
        <h2 className="text-2xl font-bold text-text-primary">Promos</h2>
        <button
          type="button"
          onClick={() => router.push('/promos')}
          className="text-sm font-medium text-white/45 hover:text-banana transition-colors"
        >
          View all →
        </button>
      </div>

      {/* The /promos rectangle cards: two columns on desktop, one on phones. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {sortedPromos.map((promo, i) => (
          <PromoLongCard
            key={promo.id}
            promo={promo}
            index={i}
            wallet={user?.walletAddress ?? null}
            isClaimed={isClaimed(promo)}
            hasVisibleClaim={hasVisibleClaim(promo)}
            onOpenModal={() => setSelectedPromo(promo)}
            onClaim={() => void handleClaim(promo)}
            fpVariant={fpVariant}
            fpShowNewPlayerTag={fpShowNewPlayerTag}
          />
        ))}
      </div>

      <PromoModal
        isOpen={!!selectedPromo}
        onClose={() => setSelectedPromo(null)}
        promo={selectedPromo}
        onClaim={(p) => {
          setSelectedPromo(null);
          void handleClaim(p);
        }}
        isPromoClaimed={selectedPromo ? isClaimed(selectedPromo) : false}
        onVerifyTweet={onVerifyTweet}
        onGenerateReferralCode={onGenerateReferralCode}
      />
    </div>
  );
}
