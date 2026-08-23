'use client';

// First Purchase SPOTLIGHT — the 2026-08-23 redesign (Boris sign-off).
// FREE SPINS / FIRST PURCHASE header, deal + guarantee lines, BUY ladder in
// spins (white action / banana reward, quiet MAX tag), one Bonus Spin gift
// line (flag-gated), Buy Drafts CTA. Variant comes from the page\'s computed
// firstPurchaseVariant, same as every other first-purchase surface.

import React from 'react';
import type { Promo } from '@/types';
import { promoHueStyle } from '@/lib/promoTheme';
import { firstPurchaseRedesign } from '@/lib/firstPurchaseCopy';

export interface FirstPurchaseSpotlightProps {
  promo: Promo;
  variant: 'new' | 'returning';
  hasVisibleClaim: boolean;
  onClaim: () => void;
  onOpenModal: () => void;
}

export function FirstPurchaseSpotlight({ promo, variant, hasVisibleClaim, onClaim, onOpenModal }: FirstPurchaseSpotlightProps) {
  const r = firstPurchaseRedesign(variant);
  const claimCount = promo.claimCount || 0;
  return (
    <section
      className="promo-grad promo-sweep promo-rise rounded-[24px] p-6 sm:p-8 text-white"
      style={promoHueStyle('first-purchase', 0)}
      aria-label="First Purchase — featured promo"
    >
      <div className="relative z-[1]">
        <div className="flex items-start justify-between gap-3">
          <div className="promo-tx min-w-0">
            <h3 className="text-[30px] sm:text-[40px] font-extrabold leading-[1] tracking-[-.8px]">
              Free <span className="text-banana">Spins</span>
            </h3>
            <div className="mt-1.5 text-[13px] sm:text-[14px] font-extrabold tracking-[4px] text-white/90 uppercase">First Purchase</div>
          </div>
          <button
            type="button"
            onClick={onOpenModal}
            className="promo-tx text-[10px] font-extrabold tracking-[1px] text-white/70 hover:text-white whitespace-nowrap"
          >
            DETAILS ▾
          </button>
        </div>

        <p className="promo-tx mt-3 text-[15px] font-extrabold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.35)]">{r.line1}</p>
        <p className="promo-tx mt-1 text-[14.5px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,.35)]">{r.line2}</p>

        <div className="mt-4 grid grid-cols-3 gap-2 max-w-[440px]">
          {r.ladder.map((rung) => (
            <div
              key={rung.buy}
              className={`relative text-center rounded-[14px] px-1.5 py-3 border ${
                rung.max ? 'border-banana/60 bg-banana/[.08]' : 'border-white/[.16] bg-black/[.28]'
              }`}
            >
              {rung.max && (
                <span className="absolute -top-[7px] left-1/2 -translate-x-1/2 rounded-full border border-banana/45 bg-[#0f2f1e] px-1.5 py-px text-[6.5px] font-extrabold tracking-[.18em] text-banana">MAX</span>
              )}
              <div className="text-[12px] font-black tracking-[.12em] text-white [text-shadow:0_1px_2px_rgba(0,0,0,.4)]">{rung.buy}</div>
              <div className="mt-0.5 text-[16px] sm:text-[17px] font-black leading-[1.15] text-banana">{rung.get}</div>
            </div>
          ))}
        </div>

        {r.showBonus && (
          <p className="promo-tx mt-3 text-[12.5px] font-semibold text-white/85">Plus a <b className="text-banana">Bonus Spin</b> with every pass.</p>
        )}

        <div className="mt-4 flex items-center gap-2.5 flex-wrap">
          <a
            href="/buy-drafts"
            className="rounded-full bg-white px-6 py-2.5 text-[13px] font-extrabold text-black hover:-translate-y-px active:scale-[.97] transition-transform"
          >
            Buy Drafts
          </a>
          {hasVisibleClaim && (
            <button type="button" onClick={onClaim} className="promo-glow rounded-full bg-banana px-4 py-2.5 text-[12px] font-extrabold text-black hover:-translate-y-px active:scale-[.97] transition-transform">
              {claimCount > 1 ? `Claim · ${claimCount}` : 'Claim'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
