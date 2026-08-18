import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { countSpendableTokens, recountFromInventory } from '@/lib/passLedger';
import { firstPurchaseVariant } from '@/lib/promoMath';
import { isReturningWalletSync } from '@/lib/returningUsers';
import { logger } from '@/lib/logger';

const USERS_COLLECTION = 'v2_users';

/**
 * GET /api/owner/balance?userId=<wallet>
 *
 * Returns `wheelSpins`, `freeDrafts`, `jackpotEntries`, `hofEntries`,
 * `draftPasses`, `cardPurchaseCount` for a user. Firestore is the
 * single user-facing source of truth — every endpoint that mints, grants,
 * spends, or burns passes writes through to `v2_users/{userId}` so the
 * SSE stream can push the change.
 *
 * No on-chain `BBB4.balanceOf` ratchet here on purpose: BBB4 doesn't burn
 * NFTs on use, so balanceOf includes consumed tokens. Reading it after a
 * pass was correctly decremented would always look like "Firestore is
 * behind, fix it" and undo the decrement. Drift recovery on missed
 * Alchemy webhooks goes through the explicit `/api/admin/reconcile-passes`
 * endpoint instead.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(req.url);
    // Lowercase the wallet so we always read the canonical doc. A handful of
    // legacy users have a checksummed-cased v2_users doc shadowing their
    // lowercase one; the SSE stream already lowercases, so without this the
    // initial GET could read a stale checksummed doc and disagree with the
    // live stream. validDraftTokens / recount are all lowercase too.
    const userId = (searchParams.get('userId') ?? '').trim().toLowerCase();
    if (!userId) return jsonError('Missing userId', 400);

    if (!isFirestoreConfigured()) {
      return json({ wheelSpins: 0, purchaseSpins: 0, freeDrafts: 0, jackpotEntries: 0, hofEntries: 0, draftPasses: 0, cardPurchaseCount: 0, cardFeeCreditCents: 0, cardFeeFrontGranted: false, firstPurchaseBonusGranted: false, firstPurchasePromoUnlocked: false, firstPurchaseVariant: 'new', hasSpunWheel: false, draftBlocked: false });
    }

    const db = getAdminFirestore();
    const snap = await db.collection(USERS_COLLECTION).doc(userId).get();
    const data = snap.exists ? (snap.data() ?? {}) : {};

    // Clamp at 0 — defense in depth. The use-pass endpoint already refuses
    // to decrement below 0, but legacy docs may have negative values from
    // before that fix landed.
    const nonNeg = (v: unknown): number => Math.max(0, (typeof v === 'number' ? v : 0));

    // Make the pass counters authoritative against the REAL spendable inventory
    // (owners/{wallet}/validDraftTokens — the exact collection the Go engine's
    // JoinLeagues spends from). The stored `draftPasses`/`freeDrafts` are a
    // mirror that every pass path is supposed to recount — EXCEPT a draft JOIN,
    // which consumes the token via the Go engine without recounting, so the
    // mirror can read one-too-high after an entry. Here we return the real
    // inventory and, on any drift, heal the stored mirror (one write, idempotent)
    // so the SSE stream + admin views converge too. NOTE: validDraftTokens IS
    // decremented on use — unlike on-chain BBB4.balanceOf (see header comment),
    // so counting it never "undoes" a correct spend.
    let paidPasses = nonNeg(data.draftPasses);
    let freeDraftsCount = nonNeg(data.freeDrafts);
    try {
      const inv = await countSpendableTokens(userId);
      if (inv.paid !== paidPasses || inv.free !== freeDraftsCount) {
        await recountFromInventory(userId);
        paidPasses = inv.paid;
        freeDraftsCount = inv.free;
      }
    } catch (e) {
      logger.warn('owner.balance.recount_skipped', {
        userId,
        err: e instanceof Error ? e.message : String(e),
      });
      // Fall back to the stored mirror values already in paid/free.
    }

    return json({
      wheelSpins: nonNeg(data.wheelSpins),
      purchaseSpins: nonNeg(data.purchaseSpins),
      freeDrafts: freeDraftsCount,
      jackpotEntries: nonNeg(data.jackpotEntries),
      hofEntries: nonNeg(data.hofEntries),
      draftPasses: paidPasses,
      cardPurchaseCount: nonNeg(data.cardPurchaseCount),
      cardFeeCreditCents: nonNeg(data.cardFeeCreditCents),
      // Gates the one-time "we cover your card fees" explainer in the buy
      // modal — false until the user's fronted card-fee draft has been granted.
      cardFeeFrontGranted: !!data.cardFeeFrontGranted,
      nflTeam: typeof data.nflTeam === 'string' ? data.nflTeam : null,
      // First-purchase promo gating flags — the promo carousel / banner / popup
      // read these off the client user object. Without them the first-purchase
      // card never hides after a purchase and never unlocks for new users.
      firstPurchaseBonusGranted: !!data.firstPurchaseBonusGranted,
      firstPurchasePromoUnlocked: !!data.firstPurchasePromoUnlocked,
      // Which first-purchase offer this user should be pitched ('new' |
      // 'returning' | 'done') — same inputs computeFirstPurchaseGrant judges
      // with server-side, so client copy always matches the actual grant.
      firstPurchaseVariant: firstPurchaseVariant(
        !!data.firstPurchaseBonusGranted,
        data.isReturningPlayer === true || isReturningWalletSync(userId),
      ),
      // Drives the spin-explainer text — must reach the client or the "a spin
      // wins up to 20…" line never disappears after a new user spins.
      hasSpunWheel: !!data.hasSpunWheel,
      draftBlocked: data.draftBlocked === true,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('owner.balance.unhandled', { route: '/api/owner/balance', err });
    return jsonError('Internal Server Error', 500);
  }
}
