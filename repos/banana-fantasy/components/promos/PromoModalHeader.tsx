'use client';

// Promo modal header — the promo's color band with its indicator, kicker, and
// name, so the modal opens as the same object you tapped (card → modal reads
// as one thing). Still: no drift, no sweep — the content below is the point.

import React from 'react';
import type { Promo } from '@/types';
import { PromoSwatch, PromoLive } from '@/components/promos/PromoVisuals';
import { promoHueStyle, promoKicker, promoName } from '@/lib/promoTheme';

export function PromoModalHeader({
  promo,
  wallet,
  onClose,
  hasVisibleClaim = false,
  isClaimed = false,
}: {
  promo: Promo;
  wallet: string | null;
  onClose: () => void;
  hasVisibleClaim?: boolean;
  isClaimed?: boolean;
}) {
  return (
    <div className="promo-grad !animate-none text-white" style={promoHueStyle(promo.type)}>
      <div className="relative z-[1] flex items-center gap-4 px-5 py-4 sm:px-6">
        <div className="shrink-0 w-[84px] rounded-[14px] bg-black/25 border border-white/15 py-2.5 grid place-items-center">
          <PromoSwatch promo={promo} size="sm" wallet={wallet} isClaimed={isClaimed} className="!bg-none !animate-none w-full" />
        </div>
        <div className="min-w-0 flex-1 promo-tx">
          <div className="text-[10px] font-extrabold tracking-[2px] text-white/85">{promoKicker(promo)}</div>
          <h2 className="mt-1 text-[20px] sm:text-[22px] font-extrabold leading-tight tracking-[-.3px]">{promoName(promo)}</h2>
          <div className="mt-2">
            <PromoLive promo={promo} size="md" wallet={wallet} hasVisibleClaim={hasVisibleClaim} isClaimed={isClaimed} />
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 self-start -mr-1 -mt-1 rounded-full p-1.5 text-white/80 hover:text-white hover:bg-white/15 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
