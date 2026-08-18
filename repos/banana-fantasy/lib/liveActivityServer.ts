import { getAdminFirestore, getAdminDatabase } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Server-side live fast-draft activity — OUR computation, independent of the
 * Go aggregator's /stats/liveDraftActivity node (which published count:0 while
 * BBB #771 was live on Round 10, 2026-08-18, blanking the drafts page, the
 * lobby line AND the X/Discord fill-alert suffix at once).
 *
 * Source of truth: drafts/draftTracker.RecentFills ([{Id: League#, StartTime}],
 * appended by the engine on every fill) → drafts where DisplayName == "BBB #Id"
 * (slot id + type) → RTDB /drafts/{slot}/realTimeDraftInfo (isDraftComplete,
 * roundNum). Cached 10s per instance; every reader (API route, bot pings)
 * shares it.
 */
const CACHE_TTL_MS = 10_000;
const FILL_WINDOW_S = 3 * 3600;
const MAX_CANDIDATES = 12;

export interface LiveActivity { count: number; round: number; updatedAt: number }
let cache: { at: number; body: LiveActivity } | null = null;

export async function computeLiveActivity(): Promise<LiveActivity> {
  const db = getAdminFirestore();
  const tracker = (await db.collection('drafts').doc('draftTracker').get()).data() ?? {};
  const nowS = Math.floor(Date.now() / 1000);
  const fills = (Array.isArray(tracker.RecentFills) ? tracker.RecentFills : []) as Array<{ Id?: number; StartTime?: number }>;
  const recent = fills
    .filter((f) => Number.isFinite(f?.Id) && Number.isFinite(f?.StartTime) && nowS - Number(f.StartTime) <= FILL_WINDOW_S)
    .slice(-MAX_CANDIDATES);

  let count = 0;
  let round = 0;
  const rtdb = getAdminDatabase();
  await Promise.all(recent.map(async (f) => {
    try {
      const q = await db.collection('drafts').where('DisplayName', '==', `BBB #${f.Id}`).limit(1).get();
      if (q.empty) return;
      const doc = q.docs[0];
      const type = String((doc.data() as { DraftType?: string }).DraftType ?? '').toLowerCase();
      if (type !== 'fast' && !/-fast-/.test(doc.id)) return;
      const snap = await rtdb.ref(`/drafts/${doc.id}/realTimeDraftInfo`).once('value');
      const r = (snap.val() ?? {}) as { isDraftComplete?: boolean; isDraftClosed?: boolean; roundNum?: number; draftStartTime?: number };
      if (r.isDraftComplete === true || r.isDraftClosed === true) return;
      if (!r.draftStartTime && !r.roundNum) return; // filled but not started yet
      count += 1;
      round = Math.max(round, Number(r.roundNum ?? 0));
    } catch (err) {
      logger.warn('live-activity.candidate_failed', { id: f.Id, err: (err as Error).message });
    }
  }));
  return { count, round: Math.max(round, count > 0 ? 1 : 0), updatedAt: Date.now() };
}


export async function getLiveActivityCached(): Promise<LiveActivity> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.body;
  try {
    const body = await computeLiveActivity();
    cache = { at: now, body };
    return body;
  } catch (err) {
    logger.error('live-activity.failed', { err: (err as Error).message });
    return cache?.body ?? { count: 0, round: 0, updatedAt: now };
  }
}
