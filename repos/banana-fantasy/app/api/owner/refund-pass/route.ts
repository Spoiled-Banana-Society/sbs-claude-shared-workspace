export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { buildActivityEventDoc } from '@/lib/activityEvents';
import { recountFromInventory } from '@/lib/passLedger';
import { logger } from '@/lib/logger';

/**
 * POST /api/owner/refund-pass
 *
 * Mirror of /api/owner/use-pass — increments `draftPasses` or `freeDrafts`
 * back by 1 when a user leaves a draft before it fills. The Go API's
 * RemoveUserFromDraft already returns the card to the user's available
 * pool, but the Firestore counter (the header / UI source of truth) was
 * never being incremented back, so the user appeared to lose a pass.
 *
 * Writes a `draft_left` activity event in the same transaction so the
 * audit log captures the refund alongside the counter bump.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    // Lowercase to the canonical doc — refund must hit the same doc the spend
    // and balance read use (all lowercase).
    const userId = requireString(body.userId, 'userId').toLowerCase();
    const clientPassType = body.passType === 'free' ? 'free' : 'paid';
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null;
    const tokenId = typeof body.tokenId === 'string' ? body.tokenId : null;

    if (!isFirestoreConfigured()) {
      return json({ success: true, note: 'Firestore not configured' });
    }

    const db = getAdminFirestore();

    // Authoritative type: read the EXACT token that was just returned to the
    // pool on leave (RemoveTokenFromLeague preserves its PassType) and refund
    // THAT type — never the client's remembered guess. Falls back to the
    // client-supplied passType only if the token can't be read.
    let passType: 'free' | 'paid' = clientPassType;
    if (tokenId) {
      try {
        const tokDoc =
          (await db.collection(`owners/${userId.toLowerCase()}/validDraftTokens`).doc(tokenId).get()).data() ??
          (await db.collection('draftTokens').doc(tokenId).get()).data();
        const real = tokDoc?.PassType;
        if (real === 'free' || real === 'paid') passType = real;
      } catch {
        /* fall back to clientPassType */
      }
    }

    const field = passType === 'paid' ? 'draftPasses' : 'freeDrafts';

    const activityDoc = await buildActivityEventDoc({
      type: 'draft_left',
      userId,
      walletAddress: userId,
      paymentMethod: passType === 'paid' ? null : 'free',
      quantity: 1,
      metadata: {
        passType,
        ...(leagueId ? { leagueId } : {}),
      },
    });

    // Set the counter to REAL spendable inventory (the token is already back in
    // validDraftTokens after the Go leave) instead of a blind +1 — so a retried
    // or double-fired leave can't push the counter above what the user can
    // actually spend. Self-healing, exactly like every other counter path.
    // recountFromInventory writes the draft_left activity event in the same tx.
    const counts = await recountFromInventory(userId, activityDoc);

    return json({
      success: true,
      field,
      refunded: true,
      draftPasses: counts.draftPasses,
      freeDrafts: counts.freeDrafts,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('refund-pass.unhandled', { route: '/api/owner/refund-pass', err });
    return jsonError('Internal Server Error', 500);
  }
}
