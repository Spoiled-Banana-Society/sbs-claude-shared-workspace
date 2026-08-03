export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { json, jsonError } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { runDropSchedule } from '@/lib/dropRun';
import { ADMIN_PREVIEW_PROMO_TYPES } from '@/lib/promoFilter';

/**
 * GET /api/crons/drop — locks the night at 8pm, sweeps at midnight.
 *
 * ⚠️ GREEN-LIGHT SWITCH: while 'drop' sits in ADMIN_PREVIEW_PROMO_TYPES this
 * holds completely — no lock, no prizes, no notifications. Packs still accrue
 * quietly (nobody can see them), so the first post-launch tick picks up a full
 * night rather than an empty one.
 */
function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  if (ADMIN_PREVIEW_PROMO_TYPES.includes('drop')) {
    return json({ ok: true, held: 'admin-preview' });
  }
  try {
    return json(await runDropSchedule(Date.now()));
  } catch (err) {
    logger.error('drop.cron_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
