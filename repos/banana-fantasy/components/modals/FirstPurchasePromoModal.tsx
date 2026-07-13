'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSyncedFlag } from '@/hooks/useSyncedFlag';

// App-wide popup for the first-purchase promo, shown to NEW users (not
// returning players) the moment they finish their welcome-wheel free drafts
// and are looking at their team — REINSTATED 2026-07-12 (Boris): many new
// users leave right after their free draft, so they must see this offer
// before they go. Same copy as the unlock bell.
//
// Triggers:
//   1. LIVE — the `first-purchase-unlocked` stream event (CustomEvent
//      'sbs-first-purchase-unlocked' from useUserEventStream), fired the
//      moment their LAST free draft finishes and their roster/team page is
//      up. Opens IMMEDIATELY (Boris 2026-07-12): new users may leave that
//      page within seconds, so they must see the offer before they go.
//   2. RELOAD-SAFE — the persisted `user.firstPurchasePromoUnlocked` flag:
//      if they closed the tab before the popup fired (or unlocked before this
//      shipped — existing never-purchased accounts), it shows on their next
//      visit instead.
//
// Shows ONCE per account ("seen" flag synced across devices), never in the
// draft room, never for returning players or anyone who already purchased.

export function FirstPurchasePromoModal() {
  const { user, isBB3Holder, isLoggedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [seen, setSeen, seenLoaded] = useSyncedFlag<boolean>('firstPurchasePromoSeen', false);

  const wallet = user?.walletAddress;
  const inDraftRoom = (pathname ?? '').startsWith('/draft-room');

  const eligible = useCallback(() => {
    if (!isLoggedIn || !wallet) return false;
    if (isBB3Holder) return false; // returning players: no popup
    if (user?.firstPurchaseBonusGranted) return false; // already purchased
    if (!seenLoaded || seen) return false; // wait for synced flag; once per account
    return true;
  }, [isLoggedIn, wallet, isBB3Holder, user?.firstPurchaseBonusGranted, seen, seenLoaded]);

  // Live trigger: their last free draft just finished — they're on the roster
  // page looking at their team. Open right away, before they leave.
  useEffect(() => {
    const onUnlock = () => {
      if (eligible()) setOpen(true);
    };
    window.addEventListener('sbs-first-purchase-unlocked', onUnlock);
    return () => window.removeEventListener('sbs-first-purchase-unlocked', onUnlock);
  }, [eligible]);

  // Reload-safe fallback: the unlock already happened (left before the popup,
  // or an existing account from before this shipped). Show on this load.
  useEffect(() => {
    if (user?.firstPurchasePromoUnlocked && !inDraftRoom && eligible()) setOpen(true);
  }, [user?.firstPurchasePromoUnlocked, inDraftRoom, eligible]);

  const dismiss = useCallback(() => {
    setSeen(true);
    setOpen(false);
  }, [setSeen]);

  if (!open || inDraftRoom) return null;

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
        <h2 className="text-xl font-bold tracking-tight text-white">Thanks for drafting!</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          We&apos;ve got an awesome first-purchase promo for you — every Draft Pass you buy:{' '}
          <span className="font-semibold text-white">2 Free Drafts guaranteed</span> — and a shot at{' '}
          <span className="font-semibold text-banana">$1,000 in Drafts</span>.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-white/45">
          Buy 1 → 2 Free Drafts guaranteed · Buy 2 → 4 · Buy 4 → 8 — no cap.
          One-time offer: your first purchase only.
        </p>
        <button
          onClick={() => {
            dismiss();
            router.push('/buy-drafts');
          }}
          className="mt-6 w-full rounded-full bg-banana py-3 text-sm font-bold text-[#1d1d1f] transition-transform hover:scale-[1.03]"
        >
          Buy Drafts
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
