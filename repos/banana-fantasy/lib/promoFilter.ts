// Shared promo visibility + ordering.
//
// Single source of truth for which promos render across the app:
//   - /promos page (full grid)
//   - homepage PromoCarousel (horizontal 3-up carousel)
//   - drafting PromosSidebar (one-at-a-time)
//
// To unhide a new promo type later:
//   1. Add its PromoType to VISIBLE_PROMO_TYPES_ORDER at the desired
//      position (front of array = first to render after in-progress
//      promos).
//   2. Optionally mark it new by adding to NEW_PROMO_TYPES — renders
//      a "NEW" badge until the user has seen it.
// Both arrays drive every consumer simultaneously.

import type { Promo, PromoType } from '@/types';

/**
 * Promo types visible to users right now, in display order (after
 * any in-progress / claimable promos bubble to the top). Boris-picked
 * 6: new-user comes first (only shown to first-time users), then the
 * 5 standing promos in fixed order.
 */
export const VISIBLE_PROMO_TYPES_ORDER: PromoType[] = [
  'first-purchase', // "First Purchase → BONUS SPINS" — leads the not-yet-started
                    // group (claimable + in-progress promos still bubble above it)
  'new-user',
  'mint',          // "Buy 10 → FREE SPIN" — buy 10 passes, earn a spin
  'daily-drafts',  // "4 drafts daily"
  'pick-10',
  'jackpot',
  'referral',      // "Refer a friend"
];

export const VISIBLE_PROMO_TYPES = new Set<PromoType>(VISIBLE_PROMO_TYPES_ORDER);

/**
 * Promo types currently marked NEW (renders a small badge). Promos
 * stay in this set as long as Boris wants the highlight; remove when
 * the novelty fades.
 */
export const NEW_PROMO_TYPES = new Set<PromoType>([
  // Empty for now — populate when a fresh promo is unhidden.
]);

export function isNewPromo(promo: Promo): boolean {
  return NEW_PROMO_TYPES.has(promo.type);
}

interface FilterOpts {
  isBB3Holder?: boolean;
  newUserPromoClaimed?: boolean;
  /**
   * True once the user has made their first paid purchase. The first-purchase
   * promo is one-time: hide it once it's been used up (granted with nothing
   * left to claim). Still shown while there are spins waiting to be claimed.
   */
  firstPurchaseBonusGranted?: boolean;
  /**
   * True once a brand-new user has finished their welcome-wheel free drafts.
   * Returning (BB3) players see the first-purchase promo immediately; new users
   * only see it once this unlocks — so the card appears as their first box right
   * after they've used up their free drafts (matching the banner/popup).
   */
  firstPurchasePromoUnlocked?: boolean;
  /**
   * Predicate returning true when the promo has a visible CLAIM action
   * for this user. Promos satisfying this bubble to the top of the
   * sorted list — in-flight / actionable stuff always wins position 1.
   */
  hasVisibleClaim?: (p: Promo) => boolean;
}

/**
 * Filter + sort the promo list for display. Returns only the
 * whitelisted types, in the order Boris specified, with claimable /
 * in-progress promos bubbled to the front.
 */
export function filterAndSortVisiblePromos(promos: Promo[], opts: FilterOpts = {}): Promo[] {
  const filtered = promos.filter((p) => {
    if (!VISIBLE_PROMO_TYPES.has(p.type)) return false;
    // New-user promo only renders for actual new users. Suppressed
    // for returning BB3 holders and anyone who already claimed it.
    if (p.type === 'new-user') {
      if (opts.isBB3Holder) return false;
      if (opts.newUserPromoClaimed) return false;
    }
    // First-purchase promo is one-time. Once the user has purchased AND has
    // no spins left to claim, it's spent — hide it.
    if (p.type === 'first-purchase') {
      if (opts.firstPurchaseBonusGranted && !p.claimable) return false;
      // New users (non-BB3) only see it after they've used up their welcome-
      // wheel free drafts. Returning players see it from the start.
      if (
        !opts.isBB3Holder &&
        !opts.firstPurchasePromoUnlocked &&
        !opts.firstPurchaseBonusGranted
      ) {
        return false;
      }
    }
    return true;
  });

  const sorted = filtered.sort((a, b) => {
    // 1. Claimable / actionable promos first — user can hit the button now.
    if (opts.hasVisibleClaim) {
      const aClaim = opts.hasVisibleClaim(a) ? 1 : 0;
      const bClaim = opts.hasVisibleClaim(b) ? 1 : 0;
      if (aClaim !== bClaim) return bClaim - aClaim;
    }
    // 2. Closest-to-claim next: a promo at 9/10 sits above one at 1/10.
    //    Only applies to promos with progressMax; non-progress promos
    //    fall through to the fixed type order below.
    const aProgress = a.progressMax ? (a.progressCurrent || 0) / a.progressMax : 0;
    const bProgress = b.progressMax ? (b.progressCurrent || 0) / b.progressMax : 0;
    if (bProgress !== aProgress) return bProgress - aProgress;
    // 3. Then the fixed display order from VISIBLE_PROMO_TYPES_ORDER.
    const aIdx = VISIBLE_PROMO_TYPES_ORDER.indexOf(a.type);
    const bIdx = VISIBLE_PROMO_TYPES_ORDER.indexOf(b.type);
    return aIdx - bIdx;
  });

  // The first-purchase promo shows a NEW badge only for new users; returning
  // (BB3) players get the same box without the badge. Derived here so every
  // surface (home carousel, drafting sidebar, /promos) stays in sync.
  return sorted.map((p) =>
    p.type === 'first-purchase' ? { ...p, isNew: !opts.isBB3Holder } : p,
  );
}
