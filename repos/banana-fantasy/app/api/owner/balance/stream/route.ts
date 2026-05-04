import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
// SSE must run on the Node runtime (edge lacks firebase-admin).
export const runtime = 'nodejs';

const USERS_COLLECTION = 'v2_users';

// Vercel serverless functions time out (60s on Pro). We proactively close
// slightly before that so EventSource cleanly reconnects instead of the
// platform killing us mid-stream. The client auto-reconnects transparently.
const STREAM_LIFETIME_MS = 55_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

interface BalancePayload {
  wheelSpins: number;
  freeDrafts: number;
  jackpotEntries: number;
  hofEntries: number;
  draftPasses: number;
  cardPurchaseCount: number;
}

function buildPayload(data: Record<string, unknown> | undefined): BalancePayload {
  const d = data ?? {};
  // Clamp at 0 — defense in depth so legacy negative values can't surface.
  const nonNeg = (v: unknown): number => Math.max(0, (typeof v === 'number' ? v : 0));
  return {
    wheelSpins: nonNeg(d.wheelSpins),
    freeDrafts: nonNeg(d.freeDrafts),
    jackpotEntries: nonNeg(d.jackpotEntries),
    hofEntries: nonNeg(d.hofEntries),
    draftPasses: nonNeg(d.draftPasses),
    cardPurchaseCount: nonNeg(d.cardPurchaseCount),
  };
}

/**
 * GET /api/owner/balance/stream?userId=<wallet>
 *
 * Server-Sent Events stream of a user's balance. Firestore is the single
 * source of truth — every endpoint that mints / grants / spends / burns a
 * pass writes through to `v2_users/{userId}`, and this stream pushes those
 * writes to the client via Firestore onSnapshot.
 *
 * Replaces the 15s client-side polling. Typical push latency: <200ms from
 * the moment a Firestore write commits to the UI updating.
 *
 * No on-chain reads here on purpose: BBB4 doesn't burn NFTs on use, so
 * `balanceOf` would inflate the count after a pass is consumed and undo
 * the use endpoint's correct decrement.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = (searchParams.get('userId') ?? '').trim().toLowerCase();
  if (!userId) {
    return new Response('Missing userId', { status: 400 });
  }

  if (!isFirestoreConfigured()) {
    // Degraded mode: send one empty snapshot and close.
    const empty: BalancePayload = {
      wheelSpins: 0, freeDrafts: 0, jackpotEntries: 0, hofEntries: 0, draftPasses: 0, cardPurchaseCount: 0,
    };
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
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const encoder = new TextEncoder();

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

      // 1. Initial snapshot — pure Firestore read, no on-chain mutation.
      let firstSnapshotSent = false;
      try {
        const snap = await userRef.get();
        const data = snap.exists ? (snap.data() ?? {}) : {};
        send('snapshot', buildPayload(data));
        firstSnapshotSent = true;
      } catch (err) {
        logger.warn('balance.stream.initial_failed', { userId, err: (err as Error).message });
      }

      // 2. Real-time Firestore listener. Each change pushes a fresh payload.
      const unsubscribe = userRef.onSnapshot(
        (snap) => {
          // Skip the very first onSnapshot fire — Firestore always emits
          // an initial value when subscribing, but we already sent that
          // above as the `snapshot` event.
          if (!firstSnapshotSent) {
            firstSnapshotSent = true;
            return;
          }
          const data = snap.exists ? (snap.data() ?? {}) : {};
          send('update', buildPayload(data));
        },
        (err) => {
          logger.warn('balance.stream.snapshot_err', { userId, err: err.message });
        },
      );

      // 3. Keepalive ping every 15s so proxies don't drop the connection.
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, KEEPALIVE_INTERVAL_MS);

      // 4. Graceful close before Vercel's serverless timeout. Client EventSource
      //    reconnects automatically, so the user never sees a gap.
      const lifetime = setTimeout(() => {
        if (closed) return;
        closed = true;
        try { unsubscribe(); } catch { /* ignore */ }
        clearInterval(keepalive);
        try { controller.close(); } catch { /* ignore */ }
      }, STREAM_LIFETIME_MS);

      // 5. Client disconnect cleanup.
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
