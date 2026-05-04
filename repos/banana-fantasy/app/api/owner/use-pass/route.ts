export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { addActivityEventToTx, buildActivityEventDoc } from '@/lib/activityEvents';
import { logger } from '@/lib/logger';

const USERS_COLLECTION = 'v2_users';

/**
 * POST /api/owner/use-pass
 *
 * Decrements `draftPasses` or `freeDrafts` in Firestore when a user enters
 * a draft. The Go API handles the actual token consumption (marking a card
 * active in a league); this endpoint keeps the Firestore counter — the
 * user-facing source of truth — in sync, and writes a `draft_entered`
 * activity event in the SAME transaction so the audit log and the header
 * counter can never disagree.
 *
 * Floor of 0: if the counter is already 0 (or missing), the transaction
 * no-ops and returns `decremented: false`. The activity event is also
 * skipped in that case (no actual consumption happened).
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const passType = body.passType === 'free' ? 'free' : 'paid';
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null;

    if (!isFirestoreConfigured()) {
      return json({ success: true, note: 'Firestore not configured' });
    }

    const field = passType === 'paid' ? 'draftPasses' : 'freeDrafts';
    const db = getAdminFirestore();
    const userRef = db.collection(USERS_COLLECTION).doc(userId);

    // Pre-build the activity event doc OUTSIDE the transaction (Firestore
    // transactions disallow new reads after writes). The transaction will
    // either commit both the counter decrement AND this activity event, or
    // commit neither.
    const activityDoc = await buildActivityEventDoc({
      type: 'draft_entered',
      userId,
      walletAddress: userId,
      paymentMethod: passType === 'paid' ? null : 'free',
      quantity: 1,
      metadata: {
        passType,
        ...(leagueId ? { leagueId } : {}),
      },
    });

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const current = (snap.exists ? (snap.data()?.[field] as number | undefined) : undefined) ?? 0;
      if (current <= 0) {
        return { decremented: false, before: current, after: current };
      }
      tx.set(userRef, { [field]: current - 1 }, { merge: true });
      addActivityEventToTx(tx, activityDoc);
      return { decremented: true, before: current, after: current - 1 };
    });

    return json({
      success: true,
      field,
      decremented: result.decremented,
      before: result.before,
      after: result.after,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('use-pass.unhandled', { route: '/api/owner/use-pass', err });
    return jsonError('Internal Server Error', 500);
  }
}
