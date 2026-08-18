'use client';

// Compact promo card — the home carousel (208×240) and the draft-room sidebar
// (224 wide) share this one component: colored block on top with the kicker
// and the promo's indicator, then name, one line, and the live fact + action.
// Same hues / indicators / chip as the /promos page, no tilt, no sweep — the
// gradient drifts and that's it. Tap → the parent opens the promo modal.

import React from 'react';
import type { Promo } from '@/types';
import { PromoSwatch, PromoLive } from '@/components/promos/PromoVisuals';
import { promoKicker, promoName } from '@/lib/promoTheme';
import { firstPurchaseCardLines } from '@/lib/firstPurchaseCopy';
import { SpinExplainer } from '@/components/promos/SpinExplainer';

export interface PromoMiniCardProps {
  promo: Promo;
  wallet: string | null;
  isClaimed: boolean;
  hasVisibleClaim: boolean;
  onOpen: () => void;
  onClaim: (e: React.MouseEvent) => void;
  /** First-purchase copy variant (server-computed). */
  fpVariant?: 'new' | 'returning';
  fpShowNewPlayerTag?: boolean;
  /** Fixed card size for the carousel; the sidebar lets it grow. */
  fixed?: boolean;
  className?: string;
}

export function PromoMiniCard({
  promo,
  wallet,
  isClaimed,
  hasVisibleClaim,
  onOpen,
  onClaim,
  fpVariant = 'new',
  fpShowNewPlayerTag = false,
  fixed = true,
  className = '',
}: PromoMiniCardProps) {
  const passive = promo.type === 'pick-10' || promo.type === 'jackpot';
  const isFp = promo.type === 'first-purchase';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className={`relative group flex flex-col overflow-hidden rounded-[18px] bg-[#131318] border text-left cursor-pointer select-none
        transition-all duration-300 hover:-translate-y-[3px] hover:shadow-[0_16px_36px_rgba(0,0,0,.45)] active:scale-[.985]
        ${hasVisibleClaim ? 'border-banana/70 shadow-[0_0_0_1px_rgba(251,191,36,.3)]' : 'border-white/[0.08]'}
        ${passive && !hasVisibleClaim ? 'opacity-80' : ''}
        ${fixed ? 'w-52 h-[256px] shrink-0' : 'w-full min-h-[16rem]'} ${className}`}
    >
      {/* Colored block: kicker left, indicator right */}
      <div className="relative shrink-0 h-[96px]">
        <PromoSwatch promo={promo} size="md" wallet={wallet} isClaimed={isClaimed} align="right" className="h-full w-full" />
        <div className="absolute inset-0 z-[1] flex items-center justify-between px-3.5 pointer-events-none">
          <span className="promo-tx text-[9px] font-extrabold tracking-[1.3px] text-white leading-[1.35] max-w-[92px]">
            {promoKicker(promo)}
          </span>
        </div>
        {promo.isNew && (
          <span className="absolute top-2 right-2 z-[2] rounded-full bg-banana px-2 py-[3px] text-[9px] font-black tracking-[1.4px] text-black">
            NEW
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5 flex-1 min-h-0 px-3.5 pt-3 pb-3.5">
        <h4 className="text-[14.5px] font-extrabold text-white leading-tight tracking-[-.2px]">{promoName(promo)}</h4>
        {isFp ? (
          <div className="text-[11px] leading-snug text-[#c9c9d2]">
            {fpShowNewPlayerTag && (
              <span className="block text-[9px] font-extrabold uppercase tracking-[1.4px] text-white/80 mb-0.5">New players</span>
            )}
            {firstPurchaseCardLines(fpVariant, promo.description).slice(0, 2).map((line) => (
              <span key={line} className="block truncate">{line}</span>
            ))}
          </div>
        ) : (
          <>
            <p className="text-[11.5px] leading-snug text-[#c9c9d2] line-clamp-4 whitespace-pre-line">{promo.description}</p>
            <SpinExplainer promoTitle={promo.title} promoType={promo.type} className="block text-[10px] leading-snug text-banana/80" />
          </>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 min-h-[30px]">
          <div className="min-w-0 overflow-hidden">
            <PromoLive promo={promo} size="md" wallet={wallet} hasVisibleClaim={hasVisibleClaim} isClaimed={isClaimed} hideLabel={hasVisibleClaim} />
          </div>
          {hasVisibleClaim ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClaim(e); }}
              className="promo-glow shrink-0 rounded-full bg-banana px-3 py-1.5 text-[10.5px] font-extrabold text-black active:scale-[.97] transition-transform"
            >
              {promo.claimCount && promo.claimCount > 1 ? `Claim · ${promo.claimCount}` : 'Claim'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
