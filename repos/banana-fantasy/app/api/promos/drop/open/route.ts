export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { openAndSettle } from '@/lib/dropRun';
import { revealNightIdFor } from '@/lib/dropMath';

/**
 * POST /api/promos/drop/open — open one pack, or all of them.
 *
 * Body: { userId, packId?, nightId? }. Omit packId to open everything sealed
 * (the "open all fast" path). nightId targets a PREVIOUS night's sealed packs
 * (there's no auto-open, so a backlog is normal); omitted, it's tonight.
 * Opening is pure reveal — every prize was assigned when the night locked at
 * 8pm — so this cannot be raced into a better outcome, and an arbitrary
 * nightId can't cheat: openPacks only ever opens the caller's own packs and
 * refuses any night that hasn't locked.
 *
 * Idempotent per pack: `opened` flips inside a transaction, so a double-tap or
 * a retried request can never pay the same pack twice.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    const packId = typeof body.packId === 'string' ? body.packId : undefined;
    // ⚠️ Default is revealNightIdFor, NOT nightFor. nightFor rolls forward at
    // 8pm, so from the moment packs unlock this resolved to TOMORROW's empty
    // night and every open returned 'no-night' — "pack won't open" for
    // everybody, at the one hour the promo exists for (launch night,
    // 2026-08-02). An explicit nightId opens a previous night's backlog.
    const nightId = typeof body.nightId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.nightId)
      ? body.nightId
      : revealNightIdFor(Date.now());

    const res = await openAndSettle({
      userId, nightId, packIds: packId ? [packId] : undefined,
    });
    return json(res);
  } catch (err) {
    logger.error('drop.open_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
