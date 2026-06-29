'use client';

/**
 * Instant, acting-device feedback for promo milestones earned by a purchase.
 *
 * The purchase routes (staging-mint / card-mint) return `promoAwards` so the
 * device that just bought can toast the milestones IMMEDIATELY from the API
 * response — instead of waiting on the RTDB stream, which iOS PWAs suspend
 * (that was the "bought 10, no toast, noti showed up late" bug). Each toast
 * is registered in localSurfaceDedupe so the stream copy of the same event
 * (arriving ~100ms later on desktop) doesn't double-toast.
 *
 * The persistent bell entries are created server-side either way; this also
 * nudges the bell to refetch so they're visible the moment the user opens it.
 */

import { markLocalSurface, requestBellRefetch, wasRecentLocalSurface } from '@/lib/localSurfaceDedupe';

export interface PurchasePromoAwards {
  mintMilestonesEarned?: number;
  buyBonusMilestonesEarned?: number;
  firstPurchaseSpinsEarned?: number;
}

interface ToastShow {
  (opts: {
    level: 'success';
    message: string;
    action?: { label: string; onClick: () => void };
  }): void;
}

function toast(show: ToastShow, message: string, link: string) {
  show({
    level: 'success',
    message,
    action: { label: 'View', onClick: () => { window.location.href = link; } },
  });
}

/** Fire milestone toasts from a purchase response. Safe with undefined/empty. */
export function surfacePurchasePromoAwards(
  awards: PurchasePromoAwards | undefined | null,
  show: ToastShow,
  opts: { cardFreeDraftsEarned?: number } = {},
): void {
  if (typeof window === 'undefined') return;

  const firstPurchase = awards?.firstPurchaseSpinsEarned ?? 0;
  if (firstPurchase > 0 && !wasRecentLocalSurface('promo-first-purchase')) {
    markLocalSurface('promo-first-purchase');
    toast(
      show,
      firstPurchase === 1
        ? 'First purchase — free spin earned!'
        : `First purchase — ${firstPurchase} free spins earned!`,
      '/promos',
    );
  }

  const buy10 = awards?.mintMilestonesEarned ?? 0;
  if (buy10 > 0 && !wasRecentLocalSurface('promo-buy-10')) {
    markLocalSurface('promo-buy-10');
    toast(
      show,
      buy10 === 1 ? 'Buy 10 milestone — free spin earned!' : `Buy 10 — ${buy10} free spins earned!`,
      '/promos',
    );
  }

  // buy-bonus (Buy 2 → 1 Free) intentionally gets NO toast — that promo is
  // hidden from the UI (retired); surfacing it here would confuse users.

  const cardFree = opts.cardFreeDraftsEarned ?? 0;
  if (cardFree > 0 && !wasRecentLocalSurface('promo-card-free-draft')) {
    markLocalSurface('promo-card-free-draft');
    toast(
      show,
      cardFree === 1
        ? '🎁 You earned a free draft — your card fees covered it!'
        : `🎁 You earned ${cardFree} free drafts — your card fees covered them!`,
      '/drafting',
    );
  }

  if (firstPurchase > 0 || buy10 > 0 || cardFree > 0) {
    requestBellRefetch();
  }
}
