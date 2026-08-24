export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/zone-drop/open — rip one Golden Ticket pack, or all of them.
 *
 * Body: { userId, bandId, packId? }. Omit packId to open everything sealed in
 * the band. Opening is pure reveal — the band's tickets were assigned at lock
 * from pre-committed randomness — and it refuses before the band's 9pm reveal
 * instant. An arbitrary bandId can't cheat: only the caller's own packs open,
 * and a Golden Ticket settles a JackHOF seat exactly like a drop win.
 * Idempotent per pack (the `opened` flip is transactional).
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    const bandId = requireString(body.bandId, 'bandId');
    if (!/^\d+__b[123]$/.test(bandId)) return jsonError('bad bandId', 400);
    const packId = typeof body.packId === 'string' ? body.packId : undefined;
    const { openZonePacks } = await import('@/lib/zoneDrop');
    const res = await openZonePacks({ userId, bandId, packIds: packId ? [packId] : undefined });
    return json(res);
  } catch (err) {
    logger.error('zone_drop.open_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
