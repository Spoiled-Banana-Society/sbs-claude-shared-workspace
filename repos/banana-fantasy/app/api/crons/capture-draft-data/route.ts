export const dynamic = 'force-dynamic';

import type { Firestore } from 'firebase-admin/firestore';
import { runInBackground } from '@/lib/serverBackground';

import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { getAdminFirestore, getAdminDatabase } from '@/lib/firebaseAdmin';
import { currentMaxTokenId, isRealToken } from '@/lib/onchain/contractSupply';
import { siteBaseUrl } from '@/lib/nftCard';

/**
 * Vercel cron — every 5 minutes. The SERVER-SIDE safety net for draft-close
 * data capture.
 *
 * Why: the full pick-data capture (refresh-draft → picked card image + durable
 * players[] in marketplace_index) is normally triggered by a participant's
 * BROWSER when the draft closes. If no client fires it (tab closed at the
 * moment of close, network blip), the data is only captured lazily when
 * something first touches the token — and the Go draft summary it needs is
 * ephemeral. This sweep removes that client dependency: within minutes of any
 * draft closing, the capture is guaranteed to have run server-side.
 *
 * Detection (uses only authoritative, already-present data — no new indexes):
 *  - Recent draft ids from drafts/draftTracker counters
 *    (CurrentLiveDraftCount / CurrentSlowDraftCount), enumerating both era
 *    prefixes (2024-/2025-), same approach as admin/notification-counts.
 *  - "Closed + made teams" = the drafts/{id}/cards subcollection exists (the WS
 *    server writes one card per team AT CLOSE — it's exactly what refresh-draft
 *    reads). Open/abandoned drafts have no cards → skipped.
 *  - "Captured" = every REAL-token card has a marketplace_index doc with
 *    status 'team' AND a durable players[] pick list (>=10).
 *  - Uncaptured → POST our own /api/marketplace/refresh-draft/{id}, the exact
 *    battle-tested, idempotent path the client trigger uses. (refresh-draft
 *    itself only writes complete teams — picks >= 10 per owner — so firing on a
 *    mid-write draft is harmless.) No new write logic is introduced here.
 *  - Bounded: <= MAX_CAPTURES_PER_RUN per run; a per-draft attempt counter
 *    (cron_capture_sweep/{draftId}) gives up after MAX_ATTEMPTS so an
 *    unhealable draft (summary already gone) can't retry forever.
 *  - Normal day: every recent draft is already captured by the client trigger,
 *    so this is a cheap read-only no-op.
 */

const LOOKBACK = 20;            // recent drafts per counter to check
const MAX_CAPTURES_PER_RUN = 3;
const MAX_ATTEMPTS = 8;         // ~40 min of 5-min retries, then give up

interface DraftCheck {
  draftId: string;
  realTokenCount: number;
  captured: boolean;
  // True once the Go close routine has finalized the draft (rosters + summary
  // written). Until then the draft is NOT capturable — refresh-draft can't build
  // a team from an in-progress draft — so we must NOT spend an attempt on it.
  closed: boolean;
}

async function recentDraftIds(db: Firestore): Promise<string[]> {
  const tracker = await db.collection('drafts').doc('draftTracker').get();
  if (!tracker.exists) return [];
  const t = tracker.data() || {};
  const live = Number(t.CurrentLiveDraftCount || 0);
  const slow = Number(t.CurrentSlowDraftCount || 0);
  const ids: string[] = [];
  // Era prefixes drift (2024-/2025-) — enumerate both. Non-existent ids simply
  // have no cards subcollection and are skipped.
  // Year prefix is the NFL SEASON year and can lag/lead the calendar — enumerate
  // a rolling window of real years (NOT hardcoded 2024/2025, which would go stale
  // and miss e.g. 2026 drafts). Same approach as the proof feed.
  // Floor at 0, not 1: after a clean-slate reset the slot counter starts at 0,
  // so the very first draft is `…-draft-0`. A floor of 1 skipped it forever.
  const cy = new Date().getUTCFullYear();
  const years = [cy + 1, cy, cy - 1, cy - 2].map(String);
  for (let n = Math.max(0, live - LOOKBACK); n <= live; n++) {
    for (const y of years) ids.push(`${y}-fast-draft-${n}`);
  }
  for (let n = Math.max(0, slow - LOOKBACK); n <= slow; n++) {
    for (const y of years) ids.push(`${y}-slow-draft-${n}`);
  }
  return ids;
}

async function checkDraft(db: Firestore, draftId: string, maxTokenId: number): Promise<DraftCheck | null> {
  // The draft's team tokens — card docs are created INCREMENTALLY as picks land
  // during the draft (not in one shot at close), so a non-empty cards collection
  // does NOT mean the draft is finished. No cards at all = nothing to capture.
  const cards = await db.collection('drafts').doc(draftId).collection('cards').get();
  if (cards.empty) return null;

  // Real on-chain ids only — synthetic staging ids never get index docs (the
  // upsert guards them), so they'd otherwise look "uncaptured" forever.
  const realTokenIds = Array.from(new Set(
    cards.docs
      .map((d) => String((d.data() as Record<string, unknown>)?.CardId ?? d.id))
      .filter((id) => /^\d+$/.test(id) && isRealToken(id, maxTokenId)),
  ));
  if (realTokenIds.length === 0) return { draftId, realTokenCount: 0, captured: true, closed: true }; // bot/synthetic — nothing to capture

  // Is the draft actually CLOSED? The Go close routine sets isDraftClosed=true
  // (and writes the final rosters + summary that refresh-draft needs) only when
  // the draft finishes. The cron must gate its attempt budget on this — see the
  // main loop. RTDB node absent (old draft, node cleaned up) → assume closed so
  // we don't strand a genuinely-finished draft.
  const closed = await isDraftClosed(draftId);

  // AUTHORITATIVE capture signal: refresh-draft stamps marketplace_capture/{id}
  // once every REAL team is indexed (written >= eligible). Trust it directly —
  // it's immune to the cardId-vs-realId index-key mismatch and to bot/short
  // tokens that the per-token scan below required forever but refresh-draft
  // never writes (the permanent `gave_up` root cause). The per-token scan stays
  // ONLY as a fallback for drafts captured before this marker existed.
  const marker = await db.collection('marketplace_capture').doc(draftId).get();
  if (marker.exists && marker.get('capturedAt')) {
    return { draftId, realTokenCount: realTokenIds.length, captured: true, closed };
  }

  // Fallback (legacy): every real token has an index doc: status 'team' + players[] >= 10.
  const refs = realTokenIds.map((id) => db.collection('marketplace_index').doc(id));
  const docs = await db.getAll(...refs);
  const captured = docs.every((d) => {
    if (!d.exists) return false;
    const x = d.data() as Record<string, unknown>;
    return x.status === 'team' && Array.isArray(x.players) && (x.players as unknown[]).length >= 10;
  });
  return { draftId, realTokenCount: realTokenIds.length, captured, closed };
}

// Canonical "draft finished" signal: RTDB drafts/{id}/realTimeDraftInfo.isDraftClosed,
// set true by the Go close routine (and read by the draft-room client trigger).
// Absent node → true (an old draft whose RTDB was cleaned up is certainly done;
// never strand it). Read error → true for the same safety reason.
async function isDraftClosed(draftId: string): Promise<boolean> {
  try {
    const snap = await getAdminDatabase()
      .ref(`drafts/${draftId}/realTimeDraftInfo`)
      .once('value');
    const v = snap.val();
    if (!v) return true; // node absent → assume closed (don't strand finished drafts)
    return v.isDraftClosed === true || v.isDraftComplete === true;
  } catch {
    return true;
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
  if (expected && auth !== expected && !req.headers.get('x-vercel-cron')) {
    return jsonError('Unauthorized', 401);
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  runInBackground('cron.heartbeat', recordCronHeartbeat('capture-draft-data')); // liveness for the watchdog

  try {
    const db = getAdminFirestore();
    const maxTokenId = await currentMaxTokenId();

    const ids = await recentDraftIds(db);
    if (ids.length === 0) return json({ ok: true, checked: 0, fired: [] });

    const checks = (await Promise.all(
      ids.map(async (id) => {
        try { return await checkDraft(db, id, maxTokenId); }
        catch { return null; } // one bad draft never breaks the sweep
      }),
    )).filter((c): c is DraftCheck => !!c);

    const uncaptured = checks.filter((c) => !c.captured);
    const fired: string[] = [];
    const skippedMaxAttempts: string[] = [];
    // In-progress drafts (cards exist but not yet closed) are uncaptured by
    // definition — refresh-draft can't build a team from a live draft. We must
    // NOT spend an attempt on them, or a long draft burns its whole 8-attempt
    // budget BEFORE it closes and then gives up the instant it's finally
    // capturable (the League #3 / 2026-06-13 failure). Skip silently so the
    // full budget applies to the post-close window.
    const skippedInProgress: string[] = [];

    for (const c of uncaptured) {
      if (fired.length >= MAX_CAPTURES_PER_RUN) break;
      if (!c.closed) { skippedInProgress.push(c.draftId); continue; }
      const guardRef = db.collection('cron_capture_sweep').doc(c.draftId);
      const guard = await guardRef.get();
      const attempts = guard.exists ? Number(guard.get('attempts') || 0) : 0;
      if (attempts >= MAX_ATTEMPTS) { skippedMaxAttempts.push(c.draftId); continue; }

      if (!dry) {
        await guardRef.set({ attempts: attempts + 1, lastAttemptAt: new Date().toISOString() }, { merge: true });
        // The exact battle-tested capture path the client trigger uses —
        // idempotent: writes picked image + durable players[] + OpenSea refresh.
        try {
          const res = await fetch(`${siteBaseUrl()}/api/marketplace/refresh-draft/${c.draftId}`, {
            method: 'POST',
            signal: AbortSignal.timeout(25_000),
          });
          logger.info('cron.capture_draft_data_fired', { draftId: c.draftId, status: res.status, attempt: attempts + 1 });
        } catch (err) {
          logger.warn('cron.capture_draft_data_fire_failed', { draftId: c.draftId, error: String(err) });
        }
      }
      fired.push(c.draftId);
    }

    const summary = {
      ok: true,
      dry,
      checked: checks.length,
      uncaptured: uncaptured.length,
      fired,
      skippedMaxAttempts,
      skippedInProgress,
    };
    if (fired.length > 0 || skippedMaxAttempts.length > 0 || skippedInProgress.length > 0) {
      logger.info('cron.capture_draft_data', summary);
    }
    // A give-up now means a genuinely CLOSED draft we retried 8× over ~40 min and
    // still couldn't capture — a real failure (user's team never generated). Raise
    // it as an ERROR so it surfaces in the admin Server Errors feed, instead of
    // silently abandoning the draft the way League #3 was (2026-06-13).
    if (skippedMaxAttempts.length > 0) {
      logger.error('cron.capture_draft_data.gave_up', {
        draftIds: skippedMaxAttempts,
        note: 'closed draft uncaptured after MAX_ATTEMPTS — heal with POST /api/marketplace/refresh-draft/{id}',
      });
    }
    return json(summary);
  } catch (err) {
    logger.warn('cron.capture_draft_data_failed', { error: String(err) });
    return json({ ok: false, error: String(err).slice(0, 200) });
  }
}
