'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSyncedFlag } from '@/hooks/useSyncedFlag';

// App-wide popup introducing the first-purchase bonus to NEW users (not BB3
// returning players). It opens once, after the user finishes their welcome-
// wheel winnings — driven by the `first-purchase-unlocked` stream event
// (CustomEvent 'sbs-first-purchase-unlocked' from useUserEventStream) and, as
// a reload-safe fallback, by the persisted `user.firstPurchasePromoUnlocked`
// flag. Returning (BB3) players and anyone who already purchased never see it.
// The "seen" flag is account-synced so dismissing it on one device keeps it
// dismissed everywhere.

export function FirstPurchasePromoModal() {
  const { user, isBB3Holder, isLoggedIn } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seen, setSeen, seenLoaded] = useSyncedFlag<boolean>('firstPurchasePromoSeen', false);

  const wallet = user?.walletAddress;

  const eligible = useCallback(() => {
    if (!isLoggedIn || !wallet) return false;
    if (isBB3Holder) return false; // returning players: no popup
    if (user?.firstPurchaseBonusGranted) return false; // already purchased
    if (!seenLoaded || seen) return false; // wait for synced flag; skip if already seen on any device
    return true;
  }, [isLoggedIn, wallet, isBB3Holder, user?.firstPurchaseBonusGranted, seen, seenLoaded]);

  // Live trigger: the server fired first-purchase-unlocked while we're open.
  useEffect(() => {
    const onUnlock = () => {
      if (eligible()) setOpen(true);
    };
    window.addEventListener('sbs-first-purchase-unlocked', onUnlock);
    return () => window.removeEventListener('sbs-first-purchase-unlocked', onUnlock);
  }, [eligible]);

  // Reload-safe fallback: the unlock happened while we were away, but the
  // persisted flag is set. Show it on next load.
  useEffect(() => {
    if (user?.firstPurchasePromoUnlocked && eligible()) setOpen(true);
  }, [user?.firstPurchasePromoUnlocked, eligible]);

  const dismiss = useCallback(() => {
    setSeen(true);
    setOpen(false);
  }, [setSeen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl border border-banana/30 bg-[#15151c] p-7 text-center shadow-[0_0_40px_rgba(251,191,36,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-banana/15 text-3xl">
          🍌
        </div>
        <h2 className="text-xl font-bold tracking-tight text-white">First Purchase Free Spins</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Nice run on your free drafts! Here&apos;s a one-time welcome gift: on your
          <span className="font-semibold text-banana"> first purchase</span>, every
          <span className="font-semibold text-white"> 4 draft passes = 1 free spin</span>.
          Buy&nbsp;8 for 2 spins, 12 for 3 — no limit.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-white/45">
          It only counts your first purchase, so grab them all in one go to stack the most spins.
        </p>
        <button
          onClick={() => {
            dismiss();
            router.push('/buy-drafts');
          }}
          className="mt-6 w-full rounded-full bg-banana py-3 text-sm font-bold text-[#1d1d1f] transition-transform hover:scale-[1.03]"
        >
          Buy Drafts &amp; Earn Spins
        </button>
        <button
          onClick={dismiss}
          className="mt-2 w-full rounded-full py-2 text-xs font-semibold text-white/50 hover:text-white/80"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
