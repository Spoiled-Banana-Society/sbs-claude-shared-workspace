'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setPurchaseFlow } from '@/lib/purchaseFlow';
import { FIRST_PURCHASE_SPINS_PER_PASS, FIRST_PURCHASE_CLASSIC_PASSES_PER_SPIN } from '@/lib/promoMath';

/**
 * Post-deposit claim prompt (Boris 2026-08-07): the moment a deposit lands,
 * pitch the best promo the user can act on while the money is hot —
 * first-purchase bonus if it\'s still unclaimed, otherwise the live Kickoff
 * buy-bonus. Quantity DEFAULTS TO WHAT THEY JUST DEPOSITED (Boris: "$100 in →
 * prompt them to buy 4"), steppable down (or up to 20), one tap into the buy
 * flow with the quantity preloaded.
 */
const MAX_QTY = 20;
const PASS_USD = 25;

export type ClaimVariant = 'new' | 'returning' | 'kickoff';

export function FirstPurchaseClaimModal({
  isOpen,
  onClose,
  variant,
  depositUsd,
}: {
  isOpen: boolean;
  onClose: () => void;
  variant: ClaimVariant;
  depositUsd?: number;
}) {
  const router = useRouter();
  const defaultQty = depositUsd && depositUsd >= PASS_USD
    ? Math.min(MAX_QTY, Math.floor(depositUsd / PASS_USD))
    : MAX_QTY;
  const [qty, setQty] = useState(defaultQty);
  // Re-derive whenever the modal (re)opens with a fresh deposit amount.
  useEffect(() => { if (isOpen) setQty(defaultQty); }, [isOpen, defaultQty]);
  if (!isOpen) return null;

  const title = variant === 'kickoff'
    ? 'Kickoff Weekend Bonus 🏈'
    : variant === 'returning'
      ? 'Claim your Returning Player Bonus'
      : 'Claim your New User Bonus';
  const sub = variant === 'kickoff'
    ? 'Every 2 buys = 1 Promo Spin + 2 Bonus Spins. Your money just landed — put it to work. Ends tonight.'
    : variant === 'returning'
      ? 'Every 2 passes on your first purchase = 1 Free Banana Spin. Your money just landed — put it to work.'
      : `Every pass on your first purchase = ${FIRST_PURCHASE_SPINS_PER_PASS} Free Banana Spins. Your money just landed — put it to work.`;
  const rewardLine = (() => {
    if (variant === 'kickoff') {
      const promo = Math.floor(qty / 2);
      return `${promo} Promo Spin${promo === 1 ? '' : 's'} + ${qty} Bonus Spin${qty === 1 ? '' : 's'}`;
    }
    const spins = variant === 'returning'
      ? Math.floor(qty / FIRST_PURCHASE_CLASSIC_PASSES_PER_SPIN)
      : qty * FIRST_PURCHASE_SPINS_PER_PASS;
    return `${spins} Free Spin${spins === 1 ? '' : 's'}`;
  })();

  const goBuy = () => {
    setPurchaseFlow({ quantity: qty });
    onClose();
    router.push('/buy-drafts');
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-sm rounded-3xl border border-banana/30 bg-[#15151c] p-7 text-center shadow-[0_0_40px_rgba(251,191,36,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-3xl mb-2">🍌</p>
        <h2 className="text-white text-xl font-bold tracking-tight mb-1">{title}</h2>
        <p className="text-white/55 text-sm leading-relaxed mb-5">{sub}</p>

        <div className="flex items-center justify-center gap-4 mb-2">
          <button
            type="button"
            aria-label="Fewer drafts"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="w-10 h-10 rounded-full border border-white/15 text-white/70 text-xl font-bold hover:border-banana/60 hover:text-banana transition-colors"
          >
            −
          </button>
          <div className="min-w-[88px]">
            <p className="text-4xl font-black text-banana tabular-nums leading-none">{qty}</p>
            <p className="text-[11px] uppercase tracking-widest text-white/40 mt-1">drafts</p>
          </div>
          <button
            type="button"
            aria-label="More drafts"
            onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))}
            className="w-10 h-10 rounded-full border border-white/15 text-white/70 text-xl font-bold hover:border-banana/60 hover:text-banana transition-colors"
          >
            +
          </button>
        </div>
        <p className="text-white/70 text-sm mb-6">
          = <span className="text-banana font-bold">{rewardLine}</span>
          <span className="text-white/40"> · ${qty * PASS_USD} total</span>
        </p>

        <button
          type="button"
          onClick={goBuy}
          className="w-full h-12 rounded-full bg-banana text-black font-bold text-[15px] hover:brightness-110 active:scale-[0.98] transition-all"
        >
          Buy {qty} Draft{qty === 1 ? '' : 's'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 text-white/40 text-sm hover:text-white/70 transition-colors"
        >
          Not now
        </button>
        {variant !== 'kickoff' && (
          <p className="mt-4 text-[11px] leading-relaxed text-white/35">
            Bonus window runs for 24 hours from your first purchase.
          </p>
        )}
      </div>
    </div>
  );
}
