'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSyncedFlag } from '@/hooks/useSyncedFlag';

// App-wide popup for the first-purchase promo, shown to NEW users (not
// returning players) when they finish their welcome-wheel free drafts —
// REINSTATED 2026-07-12; since 2026-07-13 it opens DURING the "Generating
// your Digital Team" screen (Boris: they're guaranteed to be watching it).
// Same copy as the unlock bell, which the same server event fires at the
// same instant.
//
// Triggers:
//   1. LIVE — the `first-purchase-unlocked` stream event (CustomEvent
//      'sbs-first-purchase-unlocked' from useUserEventStream). The draft room
//      pings the server at isDraftClosed (when the generating screen mounts),
//      so the event lands ~a second into generation. The LIVE path is allowed
//      to render inside the draft room — the event only ever fires for a
//      CLOSED draft, so it can never cover live picking.
//   2. RELOAD-SAFE — the persisted `user.firstPurchasePromoUnlocked` flag:
//      if they closed the tab before the popup fired (or unlocked before this
//      shipped — existing never-purchased accounts), it shows on their next
//      visit. This path stays OUTSIDE the draft room (no closed-draft
//      guarantee there).
//
// Shows ONCE per account ("seen" flag synced across devices), dismissible via
// ×, "Maybe later", or clicking anywhere outside the card. Never for
// returning players or anyone who already purchased.

const GENERATION_BEAT_MS = 1_000;

export function FirstPurchasePromoModal() {
  const { user, isBB3Holder, isLoggedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [seen, setSeen, seenLoaded] = useSyncedFlag<boolean>('firstPurchasePromoSeen', false);
  // True when the LIVE event opened us — the only path allowed to render
  // inside the draft room (the draft is provably closed/generating).
  const liveOpenRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wallet = user?.walletAddress;
  const inDraftRoom = (pathname ?? '').startsWith('/draft-room');

  const eligible = useCallback(() => {
    if (!isLoggedIn || !wallet) return false;
    if (isBB3Holder) return false; // returning players: no popup
    if (user?.firstPurchaseBonusGranted) return false; // already purchased
    if (!seenLoaded || seen) return false; // wait for synced flag; once per account
    return true;
  }, [isLoggedIn, wallet, isBB3Holder, user?.firstPurchaseBonusGranted, seen, seenLoaded]);

  // Live trigger: their last free draft just closed — the generating-team
  // screen is up and they're watching it. One short beat, then open on top.
  useEffect(() => {
    const onUnlock = () => {
      if (!eligible()) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!eligible()) return;
        liveOpenRef.current = true;
        setOpen(true);
      }, GENERATION_BEAT_MS);
    };
    window.addEventListener('sbs-first-purchase-unlocked', onUnlock);
    return () => {
      window.removeEventListener('sbs-first-purchase-unlocked', onUnlock);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [eligible]);

  // Reload-safe fallback: the unlock already happened (left before the popup,
  // or an existing account from before this shipped). Show on this load —
  // outside the draft room only.
  useEffect(() => {
    if (user?.firstPurchasePromoUnlocked && !inDraftRoom && eligible()) setOpen(true);
  }, [user?.firstPurchasePromoUnlocked, inDraftRoom, eligible]);

  const dismiss = useCallback(() => {
    setSeen(true);
    setOpen(false);
  }, [setSeen]);

  if (!open) return null;
  if (inDraftRoom && !liveOpenRef.current) return null;

  // Overlay: moderate dim, NO blur (Boris 2026-07-14) — the popup is the
  // clear focus, but the generating-team animation stays lightly visible and
  // moving behind it. No backdrop-blur: blur hides "what's going on".

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl border border-banana/30 bg-[#15151c] p-7 text-center shadow-[0_0_40px_rgba(251,191,36,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-banana/15 text-3xl">
          🍌
        </div>
        <h2 className="text-xl font-bold tracking-tight text-white">First Purchase Promo</h2>
        {/* Fixed lines — each one a complete idea, never wrapping mid-phrase
            ("40" / "Drafts" on separate lines read broken). Sized to fit a
            320px-wide phone inside the card padding. */}
        <div className="mt-3 text-sm leading-relaxed text-white/70">
          <span className="block whitespace-nowrap font-semibold text-white">Every Draft Pass = 2 Free Spins</span>
          <span className="block whitespace-nowrap">Buy 1 → <span className="font-semibold text-white">2 Free Drafts guaranteed</span></span>
          <span className="block whitespace-nowrap">Win up to <span className="font-semibold text-banana">40 Free Drafts</span> ($1,000 in Drafts)</span>
        </div>
        <div className="mt-3 text-xs leading-relaxed text-white/45">
          <span className="block whitespace-nowrap">Buy 2 → 4 Spins · Buy 4 → 8 Spins — no cap</span>
          <span className="block whitespace-nowrap">One-time offer: your first purchase only</span>
        </div>
        <button
          onClick={() => {
            dismiss();
            router.push('/buy-drafts');
          }}
          className="mt-6 w-full rounded-full bg-banana py-3 text-sm font-bold text-[#1d1d1f] transition-transform hover:scale-[1.03]"
        >
          Buy Now
        </button>
      </div>
    </div>
  );
}
