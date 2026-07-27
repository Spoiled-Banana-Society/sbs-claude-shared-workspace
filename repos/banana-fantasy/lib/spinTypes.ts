// Two kinds of wheel spin, and the one rule that separates them.
//
// PROMO spins (`wheelSpins`) are gifts — share promos, first-purchase, event
// giveaways. They pay the wedge value in full, so the "1 Draft" wedge really
// does hand over a free draft. This is the legacy behaviour and it does not
// change.
//
// PURCHASE spins (`purchaseSpins`) ride along with a paid seat. The buyer
// already owns one draft, so the wheel can only add to it: the wedge value
// MINUS ONE. Landing on "1 Draft" means no bonus — that draft is the one they
// bought. Landing on "5 Drafts" credits 4.
//
// Keeping them as separate counters (rather than one counter plus a flag) is
// what makes the feature safe to ship dark: with SPIN_ON_PURCHASE off nothing
// ever grants a purchase spin, so nothing can ever take the subtract-1 path.

export type SpinSource = 'promo' | 'purchase';

/** Firestore field holding promo spins. Pays wedge value in full. */
export const PROMO_SPINS_FIELD = 'wheelSpins';
/** Firestore field holding purchase spins. Pays wedge value minus one. */
export const PURCHASE_SPINS_FIELD = 'purchaseSpins';

/**
 * Drafts actually credited for a spin. The ONLY place the subtract-1 rule
 * lives — API settlement, activity history and result copy all route through
 * here so they can never disagree about what a spin paid.
 */
export function bonusDraftsFor(source: SpinSource, wedgeValue: number): number {
  if (source === 'purchase') return Math.max(0, wedgeValue - 1);
  return Math.max(0, wedgeValue);
}

/**
 * Which spin to consume next. Promo spins go FIRST: they pay better, and promo
 * windows close and orphan them (there are already unclaimed July 4th spins
 * sitting in limbo). Burning the expiring stack first is the friendlier and
 * cheaper order. Returns null when the user has nothing to spend.
 */
export function nextSpinSource(promoSpins: number, purchaseSpins: number): SpinSource | null {
  if (promoSpins > 0) return 'promo';
  if (purchaseSpins > 0) return 'purchase';
  return null;
}

/**
 * Client-side half of the feature flag. The server half is
 * `isSpinOnPurchaseEnabled()` in lib/featureFlags.ts — both must be on.
 * Note a NEXT_PUBLIC_* var is inlined at build time, so flipping it needs a
 * redeploy, whereas the server flag takes effect on the next request.
 */
export const SPIN_ON_PURCHASE_UI_ENABLED =
  process.env.NEXT_PUBLIC_SPIN_ON_PURCHASE === 'true';

/** User-facing names for the two stacks. Never show the raw field names. */
export const SPIN_LABELS: Record<SpinSource, string> = {
  promo: 'Promo Spins',
  purchase: 'Bonus Spins',
};

/** Singular forms, for "1 Promo Spin left". */
export const SPIN_LABELS_SINGULAR: Record<SpinSource, string> = {
  promo: 'Promo Spin',
  purchase: 'Bonus Spin',
};

/**
 * Total spendable spins, for badges and tab-bar counts where the split doesn't
 * matter. Anywhere the user is about to SPEND one, show the stacks separately —
 * a promo spin always wins something and a bonus spin doesn't, so a merged
 * number would promise something the wheel won't pay.
 */
export function totalSpins(promoSpins?: number, purchaseSpins?: number): number {
  return Math.max(0, promoSpins ?? 0) + Math.max(0, purchaseSpins ?? 0);
}
