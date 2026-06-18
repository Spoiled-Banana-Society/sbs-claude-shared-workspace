import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getContests } from '@/lib/db';

import { getAdminFirestore } from '@/lib/firebaseAdmin';

// Coalesce the draftTracker read so the client's live poll (every ~10s, many
// users) doesn't hammer Firestore — one small doc read shared for a few seconds.
let entryCache: { ts: number; count: number } | null = null;
const ENTRY_CACHE_MS = 5_000;

/**
 * Total entries THIS SEASON (BBB4), paid + free combined and live.
 *
 * A filled BBB4 league is exactly 10 seats regardless of how each player entered
 * (paid pass or free draft), so the authoritative cumulative entry count is
 * `draftTracker.FilledLeaguesCount × 10` — read from OUR Firestore, not the Go
 * `/league/` endpoint, which is gone (404) and was making this always return 0.
 * Ticks up as each league fills; the client polls so the number stays live.
 *
 * NOTE (staging): the currently-FILLING league's partial seats aren't summed —
 * there's no global league-list endpoint on staging to source a per-seat live
 * count. For prod this swaps to the real lobby/league feed for per-entry ticking.
 */
async function getLiveEntryCount(): Promise<number> {
  if (entryCache && Date.now() - entryCache.ts < ENTRY_CACHE_MS) return entryCache.count;
  try {
    const snap = await getAdminFirestore().collection('drafts').doc('draftTracker').get();
    const filled = Math.max(0, Number(snap.data()?.FilledLeaguesCount ?? 0));
    const count = filled * 10;
    entryCache = { ts: Date.now(), count };
    return count;
  } catch {
    return entryCache?.count ?? 0;
  }
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const [contests, liveEntries] = await Promise.all([
      getContests(),
      getLiveEntryCount(),
    ]);

    // Patch first contest with live entry count and correct odds
    if (contests.length > 0) {
      contests[0].currentEntries = liveEntries;
      contests[0].jpPercent = 1;
      contests[0].hofPercent = 5;
    }

    return json(contests, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
