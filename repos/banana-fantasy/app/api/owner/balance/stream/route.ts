import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { countSpendableTokens, recountFromInventory } from '@/lib/passLedger';
import { firstPurchaseVariant, type FirstPurchaseVariant } from '@/lib/promoMath';
import { isReturningWalletSync } from '@/lib/returningUsers';
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
  purchaseSpins: number;
  freeDrafts: number;
  jackpotEntries: number;
  hofEntries: number;
  draftPasses: number;
  cardPurchaseCount: number;
  cardFeeCreditCents: number;
  // Fronted card-fee draft flag — pushed live so the buy modal's one-time
  // "we cover your card fees" explainer disappears right after the grant.
  cardFeeFrontGranted: boolean;
  // First-purchase promo gating — pushed live so the promo card hides the
  // moment a purchase is recorded, and unlocks when a new user finishes their
  // free drafts. Without these on the client the first-purchase flow is blind.
  firstPurchaseBonusGranted: boolean;
  firstPurchasePromoUnlocked: boolean;
  // Which first-purchase offer to pitch ('new' | 'returning' | 'done') —
  // derived from the SAME inputs computeFirstPurchaseGrant judges with, so
  // client copy always matches the grant the server would actually pay.
  firstPurchaseVariant: FirstPurchaseVariant;
  hasSpunWheel: boolean;
}

function buildPayload(data: Record<string, unknown> | undefined, userId: string): BalancePayload {
  const d = data ?? {};
  // Clamp at 0 — defense in depth so legacy negative values can't surface.
  const nonNeg = (v: unknown): number => Math.max(0, (typeof v === 'number' ? v : 0));
  return {
    wheelSpins: nonNeg(d.wheelSpins),
    purchaseSpins: nonNeg(d.purchaseSpins),
    freeDrafts: nonNeg(d.freeDrafts),
    jackpotEntries: nonNeg(d.jackpotEntries),
    hofEntries: nonNeg(d.hofEntries),
    draftPasses: nonNeg(d.draftPasses),
    cardPurchaseCount: nonNeg(d.cardPurchaseCount),
    cardFeeCreditCents: nonNeg(d.cardFeeCreditCents),
    cardFeeFrontGranted: !!d.cardFeeFrontGranted,
    firstPurchaseBonusGranted: !!d.firstPurchaseBonusGranted,
    firstPurchasePromoUnlocked: !!d.firstPurchasePromoUnlocked,
    firstPurchaseVariant: firstPurchaseVariant(
      !!d.firstPurchaseBonusGranted,
      d.isReturningPlayer === true || isReturningWalletSync(userId),
    ),
    hasSpunWheel: !!d.hasSpunWheel,
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
      wheelSpins: 0, purchaseSpins: 0, freeDrafts: 0, jackpotEntries: 0, hofEntries: 0, draftPasses: 0, cardPurchaseCount: 0, cardFeeCreditCents: 0,
      cardFeeFrontGranted: false, firstPurchaseBonusGranted: false, firstPurchasePromoUnlocked: false, firstPurchaseVariant: 'new', hasSpunWheel: false,
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

      // DRIFT GUARD (2026-07-27, the AceJohn incident): this stream is what
      // the header actually displays, and it used to push the stored mirror
      // RAW — so any writer that left the paid/free split wrong kept lying on
      // screen until a full page reload hit the GET's heal. AceJohn watched
      // "0 paid" for an afternoon while genuinely owning a paid pass.
      //
      // Now every pushed value is verified against the REAL spendable
      // inventory (owners/{w}/validDraftTokens — the collection the engine
      // spends from). On drift we heal the stored mirror; that write re-fires
      // onSnapshot, which pushes the corrected numbers. Throttled so a burst
      // of snapshots costs one inventory read, and self-limiting: after a
      // heal the values match, so the next check is a no-op.
      const VERIFY_MIN_INTERVAL_MS = 5_000;
      let lastVerifyAt = 0;
      let verifying = false;
      const verifyCounters = (data: Record<string, unknown>) => {
        const now = Date.now();
        if (verifying || now - lastVerifyAt < VERIFY_MIN_INTERVAL_MS) return;
        verifying = true;
        lastVerifyAt = now;
        void countSpendableTokens(userId)
          .then(async (inv) => {
            const nn = (v: unknown) => Math.max(0, typeof v === 'number' ? v : 0);
            if (inv.paid !== nn(data.draftPasses) || inv.free !== nn(data.freeDrafts)) {
              logger.warn('balance.stream.drift_healed', {
                userId,
                stored: { paid: nn(data.draftPasses), free: nn(data.freeDrafts) },
                real: inv,
              });
              await recountFromInventory(userId); // re-fires onSnapshot with truth
            }
          })
          .catch(() => { /* verification is best-effort — never break the stream */ })
          .finally(() => { verifying = false; });
      };

      // 1. Initial snapshot — pure Firestore read, no on-chain mutation.
      let firstSnapshotSent = false;
      try {
        const snap = await userRef.get();
        const data = snap.exists ? (snap.data() ?? {}) : {};
        send('snapshot', buildPayload(data, userId));
        verifyCounters(data);
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
          send('update', buildPayload(data, userId));
          verifyCounters(data);
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
