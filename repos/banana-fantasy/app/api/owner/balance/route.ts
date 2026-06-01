import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
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
      return json({ wheelSpins: 0, freeDrafts: 0, jackpotEntries: 0, hofEntries: 0, draftPasses: 0, cardPurchaseCount: 0, cardFeeCreditCents: 0 });
    }

    const db = getAdminFirestore();
    const snap = await db.collection(USERS_COLLECTION).doc(userId).get();
    const data = snap.exists ? (snap.data() ?? {}) : {};

    // Clamp at 0 — defense in depth. The use-pass endpoint already refuses
    // to decrement below 0, but legacy docs may have negative values from
    // before that fix landed.
    const nonNeg = (v: unknown): number => Math.max(0, (typeof v === 'number' ? v : 0));

    return json({
      wheelSpins: nonNeg(data.wheelSpins),
      freeDrafts: nonNeg(data.freeDrafts),
      jackpotEntries: nonNeg(data.jackpotEntries),
      hofEntries: nonNeg(data.hofEntries),
      draftPasses: nonNeg(data.draftPasses),
      cardPurchaseCount: nonNeg(data.cardPurchaseCount),
      cardFeeCreditCents: nonNeg(data.cardFeeCreditCents),
      nflTeam: typeof data.nflTeam === 'string' ? data.nflTeam : null,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('owner.balance.unhandled', { route: '/api/owner/balance', err });
    return jsonError('Internal Server Error', 500);
  }
}
