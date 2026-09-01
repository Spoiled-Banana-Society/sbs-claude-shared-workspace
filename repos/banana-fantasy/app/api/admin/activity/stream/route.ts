import { requireAdmin } from '@/lib/adminAuth';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STREAM_LIFETIME_MS = 55_000;
const KEEPALIVE_INTERVAL_MS = 15_000;
// 25, not 100: the only consumer left is LiveActivityMini's 5-row feed, and
// every SSE reconnect re-reads PAGE_SIZE docs — with always-open admin tabs
// that was 100 docs per tab per reconnect, 24/7 (Aug 2026 cost audit).
const PAGE_SIZE = 25;

/**
 * GET /api/admin/activity/stream
 *
 * SSE stream of the latest commerce / gameplay events across all users.
 * Uses Firestore onSnapshot on v2_activity_events sorted by createdAt
 * descending — any new event fires an `update` push within ~200ms.
 *
 * Admin-only. Auth is verified on connect (admin wallet via the same
 * requireAdmin check used by every other admin endpoint).
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof ApiError) return new Response(err.message, { status: err.status });
    return new Response('Unauthorized', { status: 401 });
  }

  if (!isFirestoreConfigured()) {
    return new Response('Firestore not configured', { status: 503 });
  }

  const db = getAdminFirestore();
  const colRef = db
    .collection(ACTIVITY_EVENTS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(PAGE_SIZE);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = colRef.onSnapshot(
        (snap) => {
          const events = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              // Serialize Firestore Timestamp for JSON transport.
              createdAt: data.createdAt?.toMillis?.() ?? null,
            };
          });
          send('snapshot', { events });
        },
        (err) => {
          logger.warn('admin.activity.stream.err', { err: err.message });
        },
      );

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, KEEPALIVE_INTERVAL_MS);

      const lifetime = setTimeout(() => {
        if (closed) return;
        closed = true;
        try { unsubscribe(); } catch { /* ignore */ }
        clearInterval(keepalive);
        try { controller.close(); } catch { /* ignore */ }
      }, STREAM_LIFETIME_MS);

      req.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        try { unsubscribe(); } catch { /* ignore */ }
        clearInterval(keepalive);
        clearTimeout(lifetime);
        try { controller.close(); } catch { /* ignore */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
