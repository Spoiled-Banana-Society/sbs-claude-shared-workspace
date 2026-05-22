import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/debug/log
 *
 * Accepts client-side diagnostic events and writes them to the
 * `v2_debug_events` Firestore collection. Lets me read what's happening
 * in the user's browser without asking them to open devtools.
 *
 * Body: { events: Array<{ tag, event, payload, ts }> }
 *
 * Tags are short namespaces (e.g. "league#") so we can filter on read.
 * Volume is controlled client-side: only meaningful state transitions
 * are sent, not every render. Hard cap of 50 events per request.
 *
 * Retention: TTL on the collection cleans up after 24h (set up
 * separately via Firestore TTL policy). Until then, recent events are
 * queryable from the inspect-debug-logs.mjs script.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const body = await req.json().catch(() => ({}));
    const events = Array.isArray(body?.events) ? body.events.slice(0, 50) : [];
    if (events.length === 0) return json({ written: 0 });

    const db = getAdminFirestore();
    const batch = db.batch();
    const now = new Date();
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.slice(0, 64) : '';
    const wallet = typeof body?.wallet === 'string' ? body.wallet.toLowerCase().slice(0, 64) : '';

    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      const doc = {
        tag: typeof e.tag === 'string' ? e.tag.slice(0, 64) : 'unknown',
        event: typeof e.event === 'string' ? e.event.slice(0, 128) : 'unknown',
        payload: e.payload ?? null,
        clientTs: typeof e.ts === 'number' ? e.ts : Date.now(),
        serverTs: now.toISOString(),
        sessionId,
        wallet,
        path: typeof e.path === 'string' ? e.path.slice(0, 256) : '',
        ua: (req.headers.get('user-agent') || '').slice(0, 200),
      };
      const ref = db.collection('v2_debug_events').doc();
      batch.set(ref, doc);
    }

    await batch.commit();
    return json({ written: events.length });
  } catch (err) {
    logger.warn('debug.log.write.failed', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('failed', 500);
  }
}
