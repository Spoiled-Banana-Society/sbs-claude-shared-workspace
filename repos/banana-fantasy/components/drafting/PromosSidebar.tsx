'use client';

import React from 'react';
import type { Promo } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { PromoMiniCard } from '@/components/promos/PromoMiniCard';

interface PromosSidebarProps {
  promos: Promo[];
  promoIndex: number;
  promoCount: number;
  /** True while promos are still loading (e.g. on refresh, before auth/promos
   *  resolve) — so we show a loading state instead of flashing "No promos". */
  loading?: boolean;
  claimedPromos: Set<string>;
  onSelectPromo: (promo: Promo) => void;
  onClaim: (promo: Promo, e?: React.MouseEvent) => void | Promise<void>;
  onSelectIndex: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function PromosSidebar({
  promos,
  promoIndex,
  promoCount,
  loading,
  claimedPromos,
  onSelectPromo,
  onClaim,
  onSelectIndex,
  onPrev,
  onNext,
}: PromosSidebarProps) {
  // First-purchase card body copy tracks the server-computed variant (new /
  // returning). Logged-out / not-yet-loaded → new-player copy with an explicit
  // NEW PLAYERS label, so a returning player never feels baited after login.
  const { user, isLoggedIn } = useAuth();
  const fpVariant = user?.firstPurchaseVariant === 'returning' ? 'returning' : 'new';
  const fpShowNewPlayerTag = !isLoggedIn || user?.firstPurchaseVariant == null;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Promos</h3>
        <span className="text-xs text-white/30">
          {promoCount === 0 ? '0/0' : `${promoIndex + 1}/${promoCount}`}
        </span>
      </div>

      {loading ? (
        // Skeleton silhouette while promos resolve — no text flash.
        <div className="rounded-[18px] min-h-[15.5rem] bg-[#131318] border border-white/[0.08] overflow-hidden animate-pulse" aria-hidden="true">
          <div className="h-[96px] bg-white/[0.06]" />
          <div className="p-3.5">
            <div className="h-3.5 w-3/5 rounded-full bg-white/[0.08]" />
            <div className="mt-2 h-3 w-4/5 rounded-full bg-white/[0.06]" />
            <div className="mt-2 h-3 w-2/5 rounded-full bg-white/[0.06]" />
          </div>
        </div>
      ) : promoCount === 0 ? (
        <div className="rounded-[18px] min-h-[15.5rem] bg-[#131318] border border-white/[0.08] flex items-center justify-center text-sm text-white/40">
          No promos available
        </div>
      ) : (
        (() => {
          const promo = promos[promoIndex];
          const isClaimed = claimedPromos.has(promo.id);
          return (
            <PromoMiniCard
              promo={promo}
              wallet={user?.walletAddress ?? null}
              isClaimed={isClaimed}
              hasVisibleClaim={!!promo.claimable && !isClaimed}
              onOpen={() => onSelectPromo(promo)}
              onClaim={(e) => { void onClaim(promo, e); }}
              fpVariant={fpVariant}
              fpShowNewPlayerTag={fpShowNewPlayerTag}
              fixed={false}
            />
          );
        })()
      )}

      {/* Dots + nav only once real promos are present — never under the skeleton/empty. */}
      {!loading && promoCount > 0 && (
        <>
          <div className="flex justify-center gap-1.5 mt-3">
            {promos.map((_, idx) => (
              <button
                key={idx}
                onClick={() => onSelectIndex(idx)}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === promoIndex ? 'bg-banana w-4' : 'bg-white/20 hover:bg-white/40'
                }`}
              />
            ))}
          </div>

          <div className="flex justify-between mt-3">
            <button onClick={onPrev} className="px-3 py-1.5 text-white/40 hover:text-white/70 transition-colors text-sm">
              ← Prev
            </button>
            <button onClick={onNext} className="px-3 py-1.5 text-white/40 hover:text-white/70 transition-colors text-sm">
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
