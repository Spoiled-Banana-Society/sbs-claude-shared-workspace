import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { FieldValue } from 'firebase-admin/firestore';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/wheel/spin/{spinId}/confirm-reveal
 *
 * Called by the frontend the moment the wheel animation finishes and
 * the user has seen their prize. Marks the spin as "feed-ready" by:
 *
 *   1. Setting wheelSpins/{...}/{spinId}.feedRevealedAt
 *   2. Incrementing wheel_periods/{N}.feedRevealCount
 *
 * The SSE feed (/api/wheel/feed/stream) listens to feedRevealCount and
 * filters its results to spins where feedRevealedAt is set — so other
 * users only see a spin in the live feed AFTER the spinner has finished
 * watching their own wheel land. Prevents the awkward case where
 * watchers see a result before the spinner does.
 *
 * Idempotent: if already confirmed, returns 200 without re-incrementing.
 */
export async function POST(req: Request, ctx: { params: { spinId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.wheel);
  if (rateLimited) return rateLimited;

  try {
    const spinId = ctx.params.spinId?.trim();
    if (!spinId) return jsonError('Missing spinId', 400);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const db = getAdminFirestore();
    const querySnap = await db
      .collectionGroup('wheelSpins')
      .where('spinId', '==', spinId)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return jsonError('Spin not found', 404);
    }
    const spinDoc = querySnap.docs[0];
    const data = spinDoc.data() as { feedRevealedAt?: number | null; periodNumber?: number };

    if (data.feedRevealedAt) {
      // Already confirmed — idempotent no-op.
      return json({ ok: true, alreadyConfirmed: true });
    }

    const periodNumber = data.periodNumber;
    if (!periodNumber) {
      // Pre-period-tracking spins won't have periodNumber — just stamp it
      // and skip the period bump.
      await spinDoc.ref.update({ feedRevealedAt: Date.now() });
      return json({ ok: true });
    }

    // Both writes in a batch so SSE wakes up only after the spin is
    // queryable as feedRevealed.
    const batch = db.batch();
    batch.update(spinDoc.ref, { feedRevealedAt: Date.now() });
    batch.set(
      db.collection('wheel_periods').doc(String(periodNumber)),
      { feedRevealCount: FieldValue.increment(1) },
      { merge: true },
    );
    await batch.commit();

    return json({ ok: true });
  } catch (err) {
    logger.error('wheel.spin.confirm_reveal.failed', {
      route: '/api/wheel/spin/[spinId]/confirm-reveal',
      err,
    });
    return jsonError('Internal Server Error', 500);
  }
}
