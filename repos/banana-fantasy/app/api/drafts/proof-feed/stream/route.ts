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
  filledAt: string | null;
  /** Jackpot drafts only: the recorded Spin Draw + its on-chain receipt. */
  draw?: {
    winnerName: string | null;
    paidCount: number;
    reward: number;
    receiptTxHash: string | null;
    vrfPeriod: number | null;
  } | null;
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

  // Earliest league # that's part of a merkle round. Drafts below this
  // used the legacy commit-reveal system and don't belong in a feed
  // branded "Chainlink VRF + on-chain Merkle root". Computed once per
  // stream connection (cheap — the cutoff is static for a given round).
  const earliestMerkleDraft = await getEarliestMerkleDraftNumber(db);

  const buildPayload = async (filled: number): Promise<FeedPayload> => {
    if (filled <= 0 || earliestMerkleDraft === null) {
      return { drafts: [], round: await loadRound(db) };
    }

    // Try multiple year prefixes per candidate — see the non-stream
    // route for the rationale (orderBy __name__ desc on `drafts` needs
    // a descending single-field index that isn't worth creating).
    const currentYear = new Date().getUTCFullYear();
    const yearPrefixes = [currentYear, currentYear - 1, currentYear - 2].map(String);

    // See non-stream route for rationale: scan slot numbers (not global),
    // buffer past the merkle cutoff AND above the counter (staging slot
    // counters can run ahead of FilledLeaguesCount — e.g.
    // 2024-fast-draft-1215 holds BBB #1214), then filter by parsed
    // DisplayName.
    const SLOT_BUFFER = 20;
    const candidates: Array<{ draftId: string; draftNumber: number; speed: 'fast' | 'slow' }> = [];
    for (let i = -SLOT_BUFFER; i < FEED_LIMIT * 2; i++) {
      const num = filled - i;
      // Floor at 0, not 1: after a clean-slate reset the slot counter
      // starts at 0, so the very first draft is `…-draft-0`. A floor of 1
      // skipped it and the newest league never appeared in the feed.
      if (num < Math.max(0, earliestMerkleDraft - SLOT_BUFFER)) break;
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
    const jackpotSlotIds = new Map<number, string>(); // globalNumber → slot doc id (jackpot_draws key)
    // VRF-committed type per draft (provably-fair source of truth). Gate display
    // so a sealed HOF/Jackpot only shows once its written Level matches — never
    // the 'Pro' creation-default before the slot machine determines it.
    const { locateDraft } = await import('@/lib/batchProof');
    const batchCache = new Map<number, { jackpotPositions?: number[]; hofPositions?: number[] } | null>();
    const committedTypeOf = async (globalNumber: number): Promise<FeedDraft['level'] | null> => {
      const loc = locateDraft(globalNumber);
      if (!batchCache.has(loc.batchNumber)) {
        const s = await db.collection('batch_proofs').doc(String(loc.batchNumber)).get();
        batchCache.set(loc.batchNumber, s.exists ? (s.data() as { jackpotPositions?: number[]; hofPositions?: number[] }) : null);
      }
      const b = batchCache.get(loc.batchNumber);
      if (!b) return null;
      if ((b.jackpotPositions ?? []).includes(loc.positionInBatch)) return 'Jackpot';
      if ((b.hofPositions ?? []).includes(loc.positionInBatch)) return 'Hall of Fame';
      return 'Pro';
    };
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const snap = snaps[i];
      if (!snap?.exists) continue;
      const data = snap.data() as { Level?: string; DisplayName?: string } | undefined;
      const dn = data?.DisplayName ?? '';
      const m = /^BBB\s*#(\d+)$/i.exec(dn);
      const globalNumber = m ? Number(m[1]) : c.draftNumber;
      if (globalNumber < earliestMerkleDraft) continue;
      // Skip pre-fill slot docs: a freshly-created slot temporarily has
      // DisplayName equal to its slot number ("BBB #1215"), overwritten
      // on fill with the real league number ("BBB #1214"). If we catch
      // the doc mid-write, filter anything above the counter so phantom
      // future leagues don't render.
      if (globalNumber > filled) continue;
      if (seen.has(globalNumber)) continue;
      const level = normalizeLevel(data?.Level);
      // Only show once the written Level matches the VRF-committed type — a sealed
      // HOF/Jackpot stays hidden until the slot machine determines it (real-time).
      const committed = await committedTypeOf(globalNumber);
      if (committed && committed !== level) continue;
      seen.add(globalNumber);
      // updateTime = last write to the doc = slot machine reveal moment.
      const filledAt = snap.updateTime ? snap.updateTime.toDate().toISOString() : null;
      if (level === 'Jackpot') jackpotSlotIds.set(globalNumber, c.draftId);
      drafts.push({
        draftId: String(globalNumber),
        draftNumber: globalNumber,
        level,
        displayName: dn || `BBB #${globalNumber}`,
        speed: c.speed,
        filledAt,
      });
    }
    drafts.sort((a, b) => b.draftNumber - a.draftNumber);
    if (drafts.length > FEED_LIMIT) drafts.length = FEED_LIMIT;

    // Attach the recorded Spin Draw (winner + on-chain receipt) to jackpot rows.
    await Promise.all(
      drafts
        .filter((d) => d.level === 'Jackpot' && jackpotSlotIds.has(d.draftNumber))
        .map(async (d) => {
          try {
            const drawSnap = await db.collection('jackpot_draws').doc(jackpotSlotIds.get(d.draftNumber)!).get();
            const dd = drawSnap.data() as {
              pending?: boolean; winnerName?: string | null; eligible?: unknown[];
              reward?: number; receiptTxHash?: string | null; vrfPeriod?: number | null;
            } | undefined;
            if (drawSnap.exists && dd && dd.pending === false) {
              d.draw = {
                winnerName: dd.winnerName ?? null,
                paidCount: Array.isArray(dd.eligible) ? dd.eligible.length : 0,
                reward: Number(dd.reward ?? 0),
                receiptTxHash: dd.receiptTxHash ?? null,
                vrfPeriod: dd.vrfPeriod ?? null,
              };
            }
          } catch { /* row simply renders without draw info */ }
        }),
    );
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

      // Trailing re-pulls per tracker tick. The tracker increments the
      // instant a draft fills, but the per-draft DisplayName/Level write
      // lands a moment later (and at every-100th-draft batch boundaries,
      // up to ~60s later when Chainlink VRF for the next batch is in
      // flight). Without these, the row either renders with a stale
      // Level=Pro default or doesn't appear at all until the next fill
      // or the 55s SSE reconnect. Schedule a small ladder of debounced
      // re-pulls after each tracker tick so the row updates reactively.
      const REFETCH_DELAYS_MS = [1000, 4000, 15000, 60000];
      let lastPayloadSig = '';
      const trailingTimers: ReturnType<typeof setTimeout>[] = [];
      const clearTrailing = () => {
        for (const t of trailingTimers) clearTimeout(t);
        trailingTimers.length = 0;
      };
      const refetchAndMaybeSend = async (filled: number) => {
        try {
          const payload = await buildPayload(filled);
          const sig = JSON.stringify(payload);
          if (sig === lastPayloadSig) return;
          lastPayloadSig = sig;
          send('update', payload);
        } catch (err) {
          logger.warn('drafts.feed.stream.refetch_failed', {
            route: '/api/drafts/proof-feed/stream',
            err: (err as Error).message,
          });
        }
      };

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
          // Immediate refetch for the tracker change itself.
          await refetchAndMaybeSend(filled);
          // Trailing re-pulls to catch the DisplayName/Level write that
          // lags the counter. New tracker tick supersedes pending ones.
          clearTrailing();
          for (const delay of REFETCH_DELAYS_MS) {
            const t = setTimeout(() => {
              if (closed) return;
              void refetchAndMaybeSend(lastFilled);
            }, delay);
            trailingTimers.push(t);
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
        clearTrailing();
        try { controller.close(); } catch { /* ignore */ }
      }, STREAM_LIFETIME_MS);

      req.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        try { unsubscribe(); } catch { /* ignore */ }
        clearInterval(keepalive);
        clearTrailing();
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

/**
 * Earliest league # that's part of a merkle round. See the non-stream
 * route for full rationale — drafts below this used commit-reveal, not
 * the Chainlink VRF + Merkle system this feed surfaces.
 */
async function getEarliestMerkleDraftNumber(db: FirebaseFirestore.Firestore): Promise<number | null> {
  try {
    const snap = await db
      .collection('merkle_rounds')
      .orderBy('roundNumber', 'asc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data() as { firstBatchNumber?: number };
    if (!data.firstBatchNumber) return null;
    return (data.firstBatchNumber - 1) * 100 + 1;
  } catch {
    return null;
  }
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
