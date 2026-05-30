'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

// Persistent top-of-homepage nudge for the first-purchase bonus. Complements
// the one-time popup (FirstPurchasePromoModal): the popup is the reveal moment,
// this banner keeps reminding until they buy or dismiss it.
//
// Shown to anyone who hasn't made their first paid purchase yet and is "in the
// window": returning BB3 players see it right away; brand-new users see it once
// they've finished their welcome-wheel winnings (firstPurchasePromoUnlocked).
// Dismissible per wallet. Hidden entirely once they purchase.
const dismissKey = (wallet?: string) => `sbs-first-purchase-banner-dismissed-${wallet ?? 'anon'}`;

export function FirstPurchaseBanner() {
  const { user, isBB3Holder, isLoggedIn } = useAuth();
  const router = useRouter();
  const wallet = user?.walletAddress;
  const [dismissed, setDismissed] = useState(true); // default hidden until we check storage

  // Sync dismissed state from storage whenever the wallet changes.
  useEffect(() => {
    if (typeof window === 'undefined' || !wallet) {
      setDismissed(true);
      return;
    }
    setDismissed(!!window.localStorage.getItem(dismissKey(wallet)));
  }, [wallet]);

  // A new user just finished their winnings — make sure the banner re-shows
  // (unless they already dismissed it).
  useEffect(() => {
    const onUnlock = () => {
      if (wallet && !window.localStorage.getItem(dismissKey(wallet))) setDismissed(false);
    };
    window.addEventListener('sbs-first-purchase-unlocked', onUnlock);
    return () => window.removeEventListener('sbs-first-purchase-unlocked', onUnlock);
  }, [wallet]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined' && wallet) {
      window.localStorage.setItem(dismissKey(wallet), '1');
    }
    setDismissed(true);
  }, [wallet]);

  const inWindow = isBB3Holder || !!user?.firstPurchasePromoUnlocked;
  const eligible =
    isLoggedIn && !!wallet && !user?.firstPurchaseBonusGranted && inWindow && !dismissed;

  if (!eligible) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-banana/40 bg-banana/10 px-4 py-3">
      <span className="text-xl">🍌</span>
      <button
        onClick={() => router.push('/buy-drafts')}
        className="flex-1 text-left"
      >
        <p className="text-sm font-semibold text-text-primary">
          First Purchase Bonus — every 4 passes = 1 free spin
        </p>
        <p className="text-xs text-text-secondary">
          One-time offer on your first buy. Grab them in one transaction to stack the most spins.
        </p>
      </button>
      <button
        onClick={() => router.push('/buy-drafts')}
        className="hidden sm:block rounded-full bg-banana px-4 py-1.5 text-xs font-bold text-[#1d1d1f] transition-transform hover:scale-[1.03]"
      >
        Buy Drafts
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-text-secondary hover:text-text-primary text-lg leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}
