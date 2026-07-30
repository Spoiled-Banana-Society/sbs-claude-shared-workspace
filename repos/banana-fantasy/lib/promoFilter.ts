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
import { BANANA_DRAW_END_MS, MINT_PROMO_END_MS } from '@/lib/promoWindow';

/**
 * Promo types visible to users right now, in display order (after
 * any in-progress / claimable promos bubble to the top). Boris-picked
 * 6: new-user comes first (only shown to first-time users), then the
 * 5 standing promos in fixed order.
 */
export const VISIBLE_PROMO_TYPES_ORDER: PromoType[] = [
  // Boris's revenue-funnel order (2026-07-06): first-timer's welcome spin →
  // convert to a first paid buy → drive bulk buys (Buy 10) → repeat paid
  // drafting (4-in-24h) → engagement reward (Pick 6 & 10) → growth (referral)
  // → excitement (jackpot). Claim-ready / near-complete promos still bubble
  // above this fixed order, and new-user stays pinned #1 for first-timers.
  'new-user',       // first-timers only — outranks even the featured pin
  'first-purchase', // biggest conversion lever: free user → paying user
  'banana-draw',    // "Collect Bananas → JACKHOF SEAT" — LAUNCHED 2026-07-26
  'pick-chase',     // "Match Your Pick" limited-time promo — LAUNCHED 2026-07-23
  'mint',           // "Buy 10 → FREE SPIN" — biggest revenue per action
  'daily-drafts',   // "4 drafts in 24h" — repeat paid drafting = recurring rev
  'pick-10',        // "Pick 10 → FREE SPIN" — engagement reward
  'referral',       // "Refer a friend" — top-of-funnel growth
  'jackpot',        // excitement, least direct on revenue
];

export const VISIBLE_PROMO_TYPES = new Set<PromoType>(VISIBLE_PROMO_TYPES_ORDER);

/**
 * The only promo types a LOGGED-OUT visitor sees (Richard 2026-07-29).
 * A visitor can't have progress on Buy 10 / Match Your Pick / etc., so
 * those cards are noise before login — the logged-out carousel is purely
 * a conversion pitch: welcome free spin + the first-purchase offer
 * (rendered with new-player copy + "NEW PLAYERS" tag, since we can't
 * know new vs returning until they log in).
 */
export const LOGGED_OUT_PROMO_TYPES = new Set<PromoType>(['new-user', 'first-purchase']);

/**
 * Promo types visible ONLY to admin-allowlisted wallets (isWalletAdmin) —
 * a private on-site preview before a promo goes public. To launch one for
 * everyone, move its type from here into VISIBLE_PROMO_TYPES_ORDER.
 *
 * 'buy-bonus' = "Buy 2 → 1 Free" (July 4th weekend candidate). Inserted
 * right before 'mint' so it sits next to the Buy 10 card.
 */
// "Match Your Pick" (pick-chase) LAUNCHED 2026-07-23 — now in
// VISIBLE_PROMO_TYPES_ORDER above (right after first-purchase).
//
// 🍌 'banana-draw' LAUNCHED 2026-07-26 — now in VISIBLE_PROMO_TYPES_ORDER
// above, at index 2. Emptying this array also releases the draw cron, which
// holds itself while a promo is in admin preview (app/api/crons/banana-draw).
// Nothing staged for admin-only preview right now.
export const ADMIN_PREVIEW_PROMO_TYPES: PromoType[] = [];

/**
 * Limited-time featured promo: pinned to position 1 on every surface
 * (above claimable bubbling) and given the big NEW badge treatment.
 * Set to null when no promo is being featured — 'buy-bonus' was removed
 * here when the July 4th promo ended (2026-07-06).
 */
export const FEATURED_PROMO_TYPE: PromoType | null = null;

/**
 * Display order with the admin-preview types spliced in before 'pick-chase' —
 * i.e. near the front, behind only new-user and first-purchase. Previewing a
 * promo in the slot it will actually launch into means the admin preview shows
 * the real ordering, not a different one.
 */
function adminPreviewOrder(): PromoType[] {
  const order = [...VISIBLE_PROMO_TYPES_ORDER];
  const anchor = order.indexOf('pick-chase');
  order.splice(anchor === -1 ? order.length : anchor, 0, ...ADMIN_PREVIEW_PROMO_TYPES);
  return order;
}

/**
 * Promo types currently marked NEW (renders a small badge). Promos
 * stay in this set as long as Boris wants the highlight; remove when
 * the novelty fades.
 */
export const NEW_PROMO_TYPES = new Set<PromoType>([
  'banana-draw', // launches 2026-07-26 — drop this once the novelty fades
]);

export function isNewPromo(promo: Promo): boolean {
  return NEW_PROMO_TYPES.has(promo.type);
}

interface FilterOpts {
  isBB3Holder?: boolean;
  newUserPromoClaimed?: boolean;
  /**
   * True once the user has taken their welcome Banana Wheel spin. The new-user
   * promo is one-time and done the moment they win a prize from that spin — so
   * hide it FOR GOOD here. This is the reliable in-session signal (it flips via
   * the balance stream the instant they spin); `newUserPromoClaimed` only
   * refreshes on login, so it can't hide the box mid-session on its own.
   */
  hasSpunWheel?: boolean;
  /**
   * True once the user has made their first paid purchase. The first-purchase
   * promo is one-time: hide it once it's been used up (granted with nothing
   * left to claim). Still shown while there are spins waiting to be claimed.
   */
  firstPurchaseBonusGranted?: boolean;
  /**
   * True once a brand-new user has finished their welcome-wheel free drafts.
   * NO LONGER gates the card (2026-07-12: the card shows from day one) —
   * kept in the opts shape for callers; the flag still times the unlock
   * BELL and the post-draft POPUP (FirstPurchasePromoModal).
   */
  firstPurchasePromoUnlocked?: boolean;
  /**
   * True once the user's balance/promo flags have loaded from the server.
   * The gating flags above arrive a beat after first paint (via the balance
   * stream), so until they're known we hide the first-purchase card rather than
   * flash it for a user who has actually already purchased. Pass isBalanceLoaded.
   */
  flagsKnown?: boolean;
  /**
   * Explicit login state. Pass `false` for a LOGGED-OUT visitor: the
   * first-purchase card then renders (with the default new-player copy the
   * logged-out /api/promos payload carries) instead of being hidden by the
   * flagsKnown guard — a logged-out visitor has no balance stream, so their
   * flags are never "known" and the conversion card would otherwise never
   * show. Logged-in users (or unknown) keep the flagsKnown guard, so a
   * purchased user still never sees a flash of the card before their flags
   * load.
   */
  isLoggedIn?: boolean;
  /**
   * Predicate returning true when the promo has a visible CLAIM action
   * for this user. Promos satisfying this bubble to the top of the
   * sorted list — in-flight / actionable stuff always wins position 1.
   */
  hasVisibleClaim?: (p: Promo) => boolean;
  /**
   * True when the viewing wallet is on the admin allowlist. Unlocks the
   * ADMIN_PREVIEW_PROMO_TYPES so admins can see a not-yet-public promo
   * live on the site. Regular users are unaffected.
   */
  isAdminPreview?: boolean;
}

/**
 * Filter + sort the promo list for display. Returns only the
 * whitelisted types, in the order Boris specified, with claimable /
 * in-progress promos bubbled to the front.
 */
export function filterAndSortVisiblePromos(promos: Promo[], opts: FilterOpts = {}): Promo[] {
  const typeOrder = opts.isAdminPreview ? adminPreviewOrder() : VISIBLE_PROMO_TYPES_ORDER;
  const visibleTypes = opts.isAdminPreview ? new Set<PromoType>(typeOrder) : VISIBLE_PROMO_TYPES;
  const filtered = promos.filter((p) => {
    if (!visibleTypes.has(p.type)) return false;
    // Banana Draw ends with its 5th seat at noon PT Jul 31 (Boris 2026-07-30).
    if (p.type === 'banana-draw' && Date.now() >= BANANA_DRAW_END_MS) return false;
    // Logged-out visitors get ONLY the two conversion cards — everything
    // else requires an account to even have progress, so it's noise.
    if (opts.isLoggedIn === false && !LOGGED_OUT_PROMO_TYPES.has(p.type)) return false;
    // Buy 10 → FREE SPIN retirement — FINAL-LAP model (Boris 2026-07-27):
    // from the cutoff, the card survives ONLY for users mid-bar (≥1/10) or
    // holding an unclaimed spin. They finish their current 10, claim, and
    // the bar wraps to 0/10 with nothing claimable — which makes this same
    // check hide it forever. Fresh users (0/10) lose it at the cutoff.
    if (p.type === 'mint' && Date.now() >= MINT_PROMO_END_MS) {
      const midLap = (p.progressCurrent || 0) >= 1;
      const owed = (p.claimCount || 0) > 0 || p.claimable === true;
      if (!midLap && !owed) return false;
    }
    // New-user promo only renders for actual new users. Suppressed
    // for returning BB3 holders and anyone who already claimed it.
    if (p.type === 'new-user') {
      // Returning (BB3) players don't see the new-user promo — UNLESS an admin
      // force-granted it (p.forced, stamped server-side in getPromos). Claimed/
      // spun still hide it below, so a force-granted promo correctly DISAPPEARS
      // the moment they claim the spin or take their welcome wheel spin.
      if (opts.isBB3Holder && !p.forced) return false;
      if (opts.newUserPromoClaimed) return false;
      if (opts.hasSpunWheel) return false; // welcome spin used → promo done forever
    }
    // First-purchase promo is one-time. Once the user has purchased AND has
    // no spins left to claim, it's spent — hide it. The card itself renders
    // for both audiences — the SERVER decides which variant they get
    // (returning players receive the classic copy + classic grant rate; new
    // players the every-pass-2-spins / $1K version).
    //
    // Since 2026-07-12 (Boris): new users see the card from DAY ONE — it sits
    // right under the new-user welcome card. It used to wait for
    // firstPurchasePromoUnlocked (free drafts finished), but many new users
    // leave right after their free draft, so the offer must be visible from
    // the start. The unlock flag still times the BELL + post-draft POPUP.
    if (p.type === 'first-purchase') {
      // Don't render until the gating flags are known — avoids flashing the card
      // for a purchased user during the brief pre-balance window. EXCEPT for
      // explicitly LOGGED-OUT visitors (isLoggedIn === false): they have no
      // balance stream so flags can never load, and they should see the
      // new-player offer (the logged-out promos payload carries it).
      if (opts.flagsKnown === false && opts.isLoggedIn !== false) return false;
      if (opts.firstPurchaseBonusGranted && !p.claimable) return false;
    }
    return true;
  });

  const sorted = filtered.sort((a, b) => {
    // -1. The new-user welcome promo (only rendered for actual new users)
    //     outranks everything, including the featured pin — a first-timer's
    //     very first card is their free-spin welcome (Boris 2026-07-03).
    const aNU = a.type === 'new-user' ? 1 : 0;
    const bNU = b.type === 'new-user' ? 1 : 0;
    if (aNU !== bNU) return bNU - aNU;
    // 0. Featured promo is pinned next, above everything else —
    //    it's the limited-time card we're actively pushing.
    if (FEATURED_PROMO_TYPE) {
      const aFeat = a.type === FEATURED_PROMO_TYPE ? 1 : 0;
      const bFeat = b.type === FEATURED_PROMO_TYPE ? 1 : 0;
      if (aFeat !== bFeat) return bFeat - aFeat;
    }
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
    // 3. Then the fixed display order (admin preview types spliced in
    //    when unlocked).
    const aIdx = typeOrder.indexOf(a.type);
    const bIdx = typeOrder.indexOf(b.type);
    return aIdx - bIdx;
  });

  // The Pick-slot promo's NEW badge is now driven SERVER-SIDE by its live tier
  // (getPromos: base = no NEW, jp/all = NEW), so it's NOT forced here anymore —
  // the server value flows through. First-purchase KEEPS its NEW badge (it
  // upgraded to every-2-passes) — forced on here so every surface (home
  // carousel, drafting sidebar, /promos) stays in sync. Featured promo still
  // carries the big NEW badge when one is active (FEATURED is null now that
  // July 4th ended).
  return sorted.map((p) => {
    if (p.type === 'first-purchase') return { ...p, isNew: true };
    // New-user welcome card carries the NEW ribbon too (Boris 2026-07-12) —
    // forced here so already-seeded accounts match fresh seeds.
    if (p.type === 'new-user') return { ...p, isNew: true };
    // Match Your Pick is PERMANENT now, not a launch (Boris 2026-07-25) — drop
    // the NEW badge. Force-cleared rather than seed-only because every doc
    // seeded during launch stored isNew:true, and the getPromos overlay does
    // not copy isNew; without this those users keep the badge forever.
    if (p.type === 'pick-chase') return { ...p, isNew: false };
    // Featured promo always carries the (big) NEW badge on every surface.
    if (FEATURED_PROMO_TYPE && p.type === FEATURED_PROMO_TYPE) {
      return { ...p, isNew: true, featured: true };
    }
    return p;
  });
}
