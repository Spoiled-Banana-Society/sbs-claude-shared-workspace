'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSyncedFlag } from '@/hooks/useSyncedFlag';
import { FirstPurchaseSpotlight } from '@/components/promos/FirstPurchaseSpotlight';
import type { Promo } from '@/types';


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
        className="relative w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
        // The Buy Drafts CTA inside the card is a plain <a> — mark seen before
        // navigation so the popup never re-fires after they come back.
        onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) { setSeen(true); setOpen(false); } }}
      >
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-3 top-3 z-[2] flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-lg leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
        {/* THE ACTUAL first-purchase promo card (Boris 2026-08-26): the popup
            IS the /promos spotlight — one component, identical copy + visuals
            forever, no drift. Popup only fires for NEW users → variant 'new'. */}
        <FirstPurchaseSpotlight
          promo={{ claimCount: 0 } as Promo}
          variant="new"
          hasVisibleClaim={false}
          onClaim={() => {}}
          onOpenModal={() => { dismiss(); router.push('/promos?promo=first-purchase'); }}
        />
      </div>
    </div>
  );
}
