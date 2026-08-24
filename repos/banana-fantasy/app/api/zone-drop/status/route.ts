export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

/**
 * GET /api/zone-drop/status?wallet=0x…
 *
 * GOLDEN TICKETS state for the /drop page and the zone surfaces: the current
 * window's three bands (tickets, pack counts, lock/reveal state, this
 * wallet's sealed packs) plus a backlog of older bands where the wallet still
 * holds unopened packs. Winners are exposed only after a band's 9pm reveal.
 *
 * Ships dark: while system_config/zoneDrop is off this returns
 * { enabled:false } and nothing else — no surface can render the feature
 * early (same stance as /api/bonus-zone/status).
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  try {
    const wallet = getSearchParam(req, 'wallet');
    const { getZoneDropStatus } = await import('@/lib/zoneDrop');
    return json(await getZoneDropStatus(wallet), 200);
  } catch (err) {
    logger.warn('zone_drop.status_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
