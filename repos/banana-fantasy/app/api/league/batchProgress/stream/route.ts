import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TRACKER_COLLECTION = 'drafts';
const TRACKER_DOC = 'draftTracker';

const STREAM_LIFETIME_MS = 55_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

interface PendingReveal {
  atMs: number;   // absolute epoch ms when this filled draft's slot reveals
  jp: number;     // 1 if this draft is the batch Jackpot, else 0
  hof: number;    // 1 if this draft is a batch HOF, else 0
}

interface BatchProgress {
  current: number;
  total: number;
  jackpotRemaining: number;
  hofRemaining: number;
  filledLeaguesCount: number;
  batchStart: number;
  pendingReveals?: PendingReveal[];
  serverNowMs?: number;
}

// A draft's slot machine lands its TYPE at DraftStartTime-39s (= fill+21s). The
// Go fill path records each batch fill's {Id, StartTime} in tracker.RecentFills,
// so we can tell the dashboard which already-filled drafts haven't revealed yet
// and exactly when they will — letting the JP/HOF count + odds move at the real
// slot reveal instead of at fill, and stay correct across a hard refresh.
const REVEAL_OFFSET_SEC = 39;

/**
 * Compute BatchProgress from a tracker doc snapshot. Mirrors the math in
 * the Go API's models.ReturnBatchProgress so frontend SSE consumers get
 * the exact same numbers as the REST endpoint, but without leaking the
 * actual JackpotLeagueIds / HofLeagueIds (only counts).
 *
 * Critical: this is what users see in the JP/HOF "X remaining" header.
 * The IDs themselves stay sealed during a batch (anti-frontrunning).
 */
function buildPayload(data: Record<string, unknown> | undefined): BatchProgress {
  const d = data ?? {};
  const filled = Number(d.FilledLeaguesCount ?? d.filledLeaguesCount ?? 0) || 0;
  const jpIds: number[] = Array.isArray(d.JackpotLeagueIds) ? (d.JackpotLeagueIds as number[]) : [];
  const hofIds: number[] = Array.isArray(d.HofLeagueIds) ? (d.HofLeagueIds as number[]) : [];

  const current = filled % 100;
  // At a batch boundary (filled%100==0 and filled>0), the just-completed
  // batch is still the relevant one — same fix as the Go side.
  let batchStart = filled - current;
  if (current === 0 && filled > 0) batchStart = filled - 100;

  let jackpotsHit = 0;
  for (const id of jpIds) {
    if (id > batchStart && id <= filled) jackpotsHit++;
  }
  let hofsHit = 0;
  for (const id of hofIds) {
    if (id > batchStart && id <= filled) hofsHit++;
  }

  // Reveal-time gating: a filled draft whose slot hasn't landed yet (reveal
  // time in the future) goes into pendingReveals so the dashboard can hold its
  // JP/HOF deduction until the slot reveals it — instead of the instant it
  // filled. Only batch drafts are in RecentFills; we only emit FUTURE reveals
  // (past ones are already reflected in the counts above). The jp/hof flags are
  // for ALREADY-FILLED drafts (unjoinable, revealing within ~21s), so this
  // leaks no future positions. jackpotRemaining/hofRemaining are the EVENTUAL
  // (all-filled) counts; the client adds the pending deductions back until each
  // reveal lands.
  const nowMs = Date.now();
  const recentRaw = Array.isArray(d.RecentFills) ? (d.RecentFills as Array<{ Id?: number; StartTime?: number }>) : [];
  // Dedupe RecentFills by Id, keeping the entry with the HIGHEST StartTime. A
  // draft pushes a provisional {Id, StartTime:0} the instant it fills (the count
  // moves atomically), then a corrected {Id, StartTime:<real>} push follows.
  // When that correction APPENDS instead of replacing, BOTH linger — and the
  // provisional's `nowMs + 1h` hold below keeps the draft "pending reveal"
  // FOREVER, freezing revealedFilled one behind the real count. That desynced
  // the header: it showed "79/100 · HOF 4.5%" (1/22) when 79 filled means 1/21 =
  // 4.76%. Keeping the max StartTime per Id drops the stale sentinel so the timed
  // (already-revealed) entry wins and the odds track the true fill count.
  const stById = new Map<number, number>();
  for (const rf of recentRaw) {
    const id = Number(rf?.Id ?? 0) || 0;
    const st = Number(rf?.StartTime ?? 0) || 0;
    if (!id) continue;
    if (!stById.has(id) || st > (stById.get(id) as number)) stById.set(id, st);
  }
  const pendingReveals: PendingReveal[] = [];
  for (const [id, st] of stById) {
    if (id <= batchStart || id > filled) continue; // only this batch's fills
    // st<=0 is the provisional sentinel: the draft has FILLED but its slot
    // isn't timed yet (the count moved atomically with this entry). Hold it with
    // a far-future atMs so the JP/HOF deduction never shows early; the corrected
    // push (with the real DraftStartTime) lands the actual reveal moment. For a
    // timed entry, reveal = DraftStartTime-39s.
    const atMs = st > 0 ? (st - REVEAL_OFFSET_SEC) * 1000 : nowMs + 3_600_000;
    if (atMs <= nowMs) continue; // already revealed → already reflected in counts
    pendingReveals.push({ atMs, jp: jpIds.includes(id) ? 1 : 0, hof: hofIds.includes(id) ? 1 : 0 });
  }
  pendingReveals.sort((a, b) => a.atMs - b.atMs);

  return {
    current,
    total: 100,
    jackpotRemaining: Math.max(0, 1 - jackpotsHit),
    hofRemaining: Math.max(0, 5 - hofsHit),
    filledLeaguesCount: filled,
    batchStart,
    pendingReveals,
    serverNowMs: nowMs,
  };
}

/**
 * GET /api/league/batchProgress/stream
 *
 * Server-Sent Events stream of current batch progress (filled count + JP/HOF
 * remaining for the current batch). Pushes an update the moment the Go API
 * writes JackpotLeagueIds / HofLeagueIds / FilledLeaguesCount on the tracker
 * doc — typically <200ms from a HOF or JP draft filling to every connected
 * browser's header re-rendering.
 *
 * Replaces the 30s polling in useBatchProgress.ts. Critical for the FOMO
 * dynamic when a batch is winding down with the JP still unhit — users need
 * to see "1 JP remaining" decrement to "0 JP remaining" the instant it lands,
 * not 30 seconds later when they've already paid to enter a bricked draft.
 *
 * Response leaks NO IDs — only counts. The actual JP/HOF positions stay
 * sealed by the proof API gating until end-of-batch reveal.
 */
export async function GET(req: Request) {
  if (!isFirestoreConfigured()) {
    const empty: BatchProgress = {
      current: 0, total: 100, jackpotRemaining: 1, hofRemaining: 5,
      filledLeaguesCount: 0, batchStart: 0,
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
  const trackerRef = db.collection(TRACKER_COLLECTION).doc(TRACKER_DOC);
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

      let firstSnapshotSent = false;
      try {
        const snap = await trackerRef.get();
        const data = snap.exists ? (snap.data() ?? {}) : {};
        send('snapshot', buildPayload(data));
        firstSnapshotSent = true;
      } catch (err) {
        logger.warn('batchProgress.stream.initial_failed', { err: (err as Error).message });
      }

      const unsubscribe = trackerRef.onSnapshot(
        (snap) => {
          if (!firstSnapshotSent) {
            firstSnapshotSent = true;
            return;
          }
          const data = snap.exists ? (snap.data() ?? {}) : {};
          send('update', buildPayload(data));
        },
        (err) => {
          logger.warn('batchProgress.stream.snapshot_err', { err: err.message });
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
