import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STREAM_LIFETIME_MS = 55_000;
const KEEPALIVE_INTERVAL_MS = 15_000;
const FEED_LIMIT = 50;

interface FeedSpin {
  spinId: string;
  spinIndex: number;
  result: string;
  timestamp: string;
}

interface FeedPayload {
  periodNumber: number;
  count: number;
  spins: FeedSpin[];
}

/**
 * GET /api/wheel/feed/stream?period=N
 *
 * Server-Sent Events stream of wheel spins for the given period. Subscribes
 * to wheel_periods/{N}.spinCount via Firestore onSnapshot — whenever a
 * new spin lands, refetches the top FEED_LIMIT spins and pushes an
 * update. Latency from spin-complete to feed-update is <200ms vs the 15s
 * polling cadence we were running on /wheel-batches.
 *
 * Returns empty list (200) when the wheelSpins composite index hasn't been
 * built — see /api/wheel/feed for the same fallback behavior.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const periodNumber = parseInt(url.searchParams.get('period') ?? '', 10);
  if (!Number.isInteger(periodNumber) || periodNumber < 1) {
    return new Response('Missing or invalid `period` query param', { status: 400 });
  }

  if (!isFirestoreConfigured()) {
    const empty: FeedPayload = { periodNumber, count: 0, spins: [] };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(empty)}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const db = getAdminFirestore();
  const periodRef = db.collection('wheel_periods').doc(String(periodNumber));
  const encoder = new TextEncoder();

  const fetchSpins = async (): Promise<FeedSpin[]> => {
    try {
      // Fetch a generous buffer because we filter to revealed-only in code.
      // Cheaper than adding a composite index that filters on feedRevealedAt.
      const snap = await db
        .collectionGroup('wheelSpins')
        .where('periodNumber', '==', periodNumber)
        .orderBy('spinIndexInPeriod', 'desc')
        .limit(FEED_LIMIT * 2)
        .get();
      // Hide spins that are still mid-animation on the spinner's side —
      // watchers should only see results after the spinner has seen them.
      // Grace period: spins older than REVEAL_BACKSTOP_MS are treated as
      // implicitly revealed (covers spins from before confirm-reveal
      // existed, and the rare case where confirm-reveal didn't fire e.g.
      // tab closed mid-celebration).
      const REVEAL_BACKSTOP_MS = 30_000;
      const cutoff = Date.now() - REVEAL_BACKSTOP_MS;
      const revealed: FeedSpin[] = [];
      for (const d of snap.docs) {
        const data = d.data() as {
          spinId: string;
          result: string;
          timestamp: string;
          spinIndexInPeriod: number;
          feedRevealedAt?: number | null;
        };
        const isExplicitlyRevealed = !!data.feedRevealedAt;
        const isOldEnough = data.timestamp ? new Date(data.timestamp).getTime() < cutoff : false;
        if (!isExplicitlyRevealed && !isOldEnough) continue;
        revealed.push({
          spinId: data.spinId,
          spinIndex: data.spinIndexInPeriod,
          result: data.result,
          timestamp: data.timestamp,
        });
        if (revealed.length >= FEED_LIMIT) break;
      }
      return revealed;
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? String(err);
      const code = (err as { code?: number })?.code;
      if (code === 9 || /FAILED_PRECONDITION|requires an index/i.test(msg)) {
        logger.error('wheel.feed.stream.missing_index', {
          route: '/api/wheel/feed/stream',
          periodNumber,
          err: new Error(msg),
        });
        return [];
      }
      throw err;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let firstSnapshotSent = false;
      let lastRevealCount = -1;

      try {
        const initial = await fetchSpins();
        const periodSnap = await periodRef.get();
        const revealCount = Number((periodSnap.data() as { feedRevealCount?: number } | undefined)?.feedRevealCount ?? 0);
        lastRevealCount = revealCount;
        send('snapshot', { periodNumber, count: initial.length, spins: initial });
        firstSnapshotSent = true;
      } catch (err) {
        logger.warn('wheel.feed.stream.initial_failed', {
          route: '/api/wheel/feed/stream',
          periodNumber,
          err: (err as Error).message,
        });
      }

      // Listen on the period doc — feedRevealCount bumps when the user's
      // wheel finishes spinning + they've seen their prize (via the
      // confirm-reveal endpoint). On each change, re-query the feed and
      // push. spinCount (which bumps at spin-request time) is intentionally
      // NOT the trigger: it would surface results to watchers before the
      // spinner sees their own wheel land.
      const unsubscribe = periodRef.onSnapshot(
        async (snap) => {
          if (!firstSnapshotSent) {
            firstSnapshotSent = true;
            return;
          }
          const data = snap.exists ? (snap.data() ?? {}) : {};
          const revealCount = Number((data as { feedRevealCount?: number }).feedRevealCount ?? 0);
          if (revealCount === lastRevealCount) return;
          lastRevealCount = revealCount;
          try {
            const fresh = await fetchSpins();
            send('update', { periodNumber, count: fresh.length, spins: fresh });
          } catch (err) {
            logger.warn('wheel.feed.stream.refetch_failed', {
              route: '/api/wheel/feed/stream',
              periodNumber,
              err: (err as Error).message,
            });
          }
        },
        (err) => {
          logger.warn('wheel.feed.stream.snapshot_err', {
            route: '/api/wheel/feed/stream',
            periodNumber,
            err: err.message,
          });
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
