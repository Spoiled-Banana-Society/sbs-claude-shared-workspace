'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSyncedFlag } from '@/hooks/useSyncedFlag';

// Persistent top-of-homepage nudge for the first-purchase bonus. Complements
// the one-time popup (FirstPurchasePromoModal): the popup is the reveal moment,
// this banner keeps reminding until they buy or dismiss it.
//
// TWO variants since 2026-07-10 (Boris): returning players (isBB3Holder =
// on-chain BBB3 + past-player snapshot + web2 identity match) keep the
// CLASSIC promo — shown right away with the classic copy (every 2 passes =
// 1 spin). New users get the upgraded copy (every pass = 2 Free Spins, win
// up to $1K) once they've finished their welcome-wheel winnings
// (firstPurchasePromoUnlocked). Dismissible per account (synced across
// devices). Hidden once they purchase.

export function FirstPurchaseBanner() {
  const { user, isBB3Holder, isLoggedIn } = useAuth();
  const router = useRouter();
  const wallet = user?.walletAddress;
  // Account-synced dismissal. `loaded` gates the first render so the banner
  // doesn't flash before the synced flag resolves on a fresh device. The
  // unlock re-show is now reactive: inWindow flips true when the user's
  // firstPurchasePromoUnlocked field updates, so no event listener is needed.
  const [dismissed, setDismissed, loaded] = useSyncedFlag<boolean>('firstPurchaseBannerDismissed', false);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, [setDismissed]);

  const inWindow = isBB3Holder || !!user?.firstPurchasePromoUnlocked;
  const eligible =
    isLoggedIn && !!wallet && !user?.firstPurchaseBonusGranted && inWindow && loaded && !dismissed;

  if (!eligible) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-banana/40 bg-banana/10 px-4 py-3">
      <span className="text-xl">🍌</span>
      <button
        onClick={() => router.push('/buy-drafts')}
        className="flex-1 text-left"
      >
        {isBB3Holder ? (
          <>
            <p className="text-sm font-semibold text-text-primary">
              First Deposit Free Spins — every $50 deposited = 1 free spin
            </p>
            <p className="text-xs text-text-secondary">
              One-time offer on your first deposit. Deposit it all at once to stack the most spins.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-text-primary">
              Deposit $25 → win up to $1K in Drafts
            </p>
            <p className="text-xs text-text-secondary">
              Every $25 deposited = 2 Free Spins · $50 in Drafts guaranteed · first deposit only
            </p>
          </>
        )}
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
