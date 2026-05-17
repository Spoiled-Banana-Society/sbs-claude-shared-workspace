import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STREAM_LIFETIME_MS = 55_000;
const KEEPALIVE_INTERVAL_MS = 15_000;
const FEED_LIMIT = 50;
const SPEEDS = ['fast', 'slow'] as const;

interface FeedDraft {
  draftId: string;
  draftNumber: number;
  level: 'Jackpot' | 'Hall of Fame' | 'Pro' | null;
  displayName: string;
  speed: 'fast' | 'slow';
}

interface RoundSummary {
  roundNumber: number;
  status: string;
  merkleRoot: string | null;
  merkleRootTxHash: string | null;
  commitTxHashVrf: string | null;
}

interface FeedPayload {
  drafts: FeedDraft[];
  round: RoundSummary | null;
}

/**
 * GET /api/drafts/proof-feed/stream
 *
 * Server-Sent Events stream of recently filled leagues. Subscribes to the
 * drafts/draftTracker doc — every time a new draft fills (FilledLeaguesCount
 * increments), refetches the top FEED_LIMIT drafts and pushes an update.
 *
 * The trigger fires the moment the slot-machine reveal writes the draft
 * doc's Level field, so the live feed updates in <200ms (vs the 15s
 * polling cadence we were running before).
 */
export async function GET(req: Request) {
  if (!isFirestoreConfigured()) {
    const empty: FeedPayload = { drafts: [], round: null };
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
  const trackerRef = db.collection('drafts').doc('draftTracker');
  const encoder = new TextEncoder();

  const buildPayload = async (filled: number): Promise<FeedPayload> => {
    if (filled <= 0) {
      return { drafts: [], round: await loadRound(db) };
    }

    // Try multiple year prefixes per candidate — see the non-stream
    // route for the rationale (orderBy __name__ desc on `drafts` needs
    // a descending single-field index that isn't worth creating).
    const currentYear = new Date().getUTCFullYear();
    const yearPrefixes = [currentYear, currentYear - 1, currentYear - 2].map(String);

    const candidates: Array<{ draftId: string; draftNumber: number; speed: 'fast' | 'slow' }> = [];
    for (let i = 0; i < FEED_LIMIT; i++) {
      const num = filled - i;
      if (num <= 0) break;
      for (const speed of SPEEDS) {
        for (const year of yearPrefixes) {
          candidates.push({ draftId: `${year}-${speed}-draft-${num}`, draftNumber: num, speed });
        }
      }
    }

    const snaps = await Promise.all(
      candidates.map((c) => db.collection('drafts').doc(c.draftId).get().catch(() => null)),
    );

    // Same source-of-truth fix as the non-stream route: derive the
    // global league number from DisplayName, not the slot id.
    const seen = new Set<number>();
    const drafts: FeedDraft[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const snap = snaps[i];
      if (!snap?.exists) continue;
      const data = snap.data() as { Level?: string; DisplayName?: string } | undefined;
      const dn = data?.DisplayName ?? '';
      const m = /^BBB\s*#(\d+)$/i.exec(dn);
      const globalNumber = m ? Number(m[1]) : c.draftNumber;
      if (seen.has(globalNumber)) continue;
      seen.add(globalNumber);
      drafts.push({
        draftId: String(globalNumber),
        draftNumber: globalNumber,
        level: normalizeLevel(data?.Level),
        displayName: dn || `BBB #${globalNumber}`,
        speed: c.speed,
      });
    }
    drafts.sort((a, b) => b.draftNumber - a.draftNumber);
    if (drafts.length > FEED_LIMIT) drafts.length = FEED_LIMIT;
    return { drafts, round: await loadRound(db) };
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
      let lastFilled = -1;

      try {
        const snap = await trackerRef.get();
        const filled = Number((snap.data() as { FilledLeaguesCount?: number } | undefined)?.FilledLeaguesCount ?? 0);
        lastFilled = filled;
        const payload = await buildPayload(filled);
        send('snapshot', payload);
        firstSnapshotSent = true;
      } catch (err) {
        logger.warn('drafts.feed.stream.initial_failed', {
          route: '/api/drafts/proof-feed/stream',
          err: (err as Error).message,
        });
      }

      // The draftTracker doc is the cheapest "something happened" signal —
      // it increments the moment a draft fills, before per-draft state
      // propagates. By the time we re-query the drafts collection, the
      // Level / DisplayName fields are written (set in the same flow).
      const unsubscribe = trackerRef.onSnapshot(
        async (snap) => {
          if (!firstSnapshotSent) {
            firstSnapshotSent = true;
            return;
          }
          const data = snap.exists ? (snap.data() ?? {}) : {};
          const filled = Number((data as { FilledLeaguesCount?: number }).FilledLeaguesCount ?? 0);
          if (filled === lastFilled) return;
          lastFilled = filled;
          try {
            const payload = await buildPayload(filled);
            send('update', payload);
          } catch (err) {
            logger.warn('drafts.feed.stream.refetch_failed', {
              route: '/api/drafts/proof-feed/stream',
              err: (err as Error).message,
            });
          }
        },
        (err) => {
          logger.warn('drafts.feed.stream.snapshot_err', {
            route: '/api/drafts/proof-feed/stream',
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

function normalizeLevel(raw: string | undefined): FeedDraft['level'] {
  if (!raw) return 'Pro';
  const v = raw.toLowerCase();
  if (v.includes('jackpot')) return 'Jackpot';
  if (v.includes('hall of fame') || v === 'hof') return 'Hall of Fame';
  return 'Pro';
}

async function loadRound(db: FirebaseFirestore.Firestore): Promise<RoundSummary | null> {
  try {
    const stateSnap = await db.collection('system_config').doc('merkleRoundState').get();
    if (!stateSnap.exists) return null;
    const state = stateSnap.data() as { currentRoundNumber?: number } | undefined;
    if (!state?.currentRoundNumber) return null;
    const roundSnap = await db.collection('merkle_rounds').doc(String(state.currentRoundNumber)).get();
    if (!roundSnap.exists) return null;
    const data = roundSnap.data() as {
      roundNumber?: number;
      status?: string;
      merkleRoot?: string;
      merkleRootTxHash?: string;
      commitTxHashVrf?: string;
    } | undefined;
    if (!data) return null;
    return {
      roundNumber: data.roundNumber ?? state.currentRoundNumber,
      status: data.status ?? 'unknown',
      merkleRoot: data.merkleRoot ?? null,
      merkleRootTxHash: data.merkleRootTxHash ?? null,
      commitTxHashVrf: data.commitTxHashVrf ?? null,
    };
  } catch {
    return null;
  }
}
