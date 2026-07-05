import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getExposure, recomputeUserExposure } from '@/lib/db';
import type { ExposureRecomputeDiag } from '@/lib/db-firestore';
import type { UserExposure } from '@/lib/exposureUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { bananaDefaultName } from '@/utils/helpers';

// Concurrent-read dedupe window. Was 60s — Richard wants exposure to
// reflect a just-completed draft on the next page load, so the throttle
// is now just enough to prevent the same tab's parallel hooks from
// firing two writes back-to-back. The recompute itself is idempotent.
const RECOMPUTE_THROTTLE_MS = 2_000;

export async function GET(req: Request, ctx: { params: { userId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const { userId } = ctx.params;
    if (!userId) return jsonError('Missing route param: userId', 400);

    const lower = userId.toLowerCase();
    const force = req.url.includes('recompute=1');
    const debug = req.url.includes('debug=1');

    // Recompute on every read (modulo the 2s concurrent-dedupe window).
    // A `lastExposureRecomputeAt` timestamp on the user doc lets parallel
    // requests from the same page share a single write. The recompute is
    // idempotent + writes the doc itself.
    const db = getAdminFirestore();
    const userRef = db.collection('v2_users').doc(lower);
    const userSnap = await userRef.get();
    const lastRaw = userSnap.exists ? (userSnap.data() as { lastExposureRecomputeAt?: string }).lastExposureRecomputeAt : null;
    const last = lastRaw ? Date.parse(lastRaw) : 0;
    const throttled = Number.isFinite(last) && Date.now() - last < RECOMPUTE_THROTTLE_MS;

    // Last-good snapshot we can always fall back on. Reading it first lets us
    // (a) serve it instantly if a fresh rebuild fails, and (b) force a rebuild
    // when there's nothing stored yet — so a first-ever load is never left on
    // a false "no drafts" screen just because the rebuild hiccupped.
    const existing = await getExposure(lower);

    const recomputeDiag: ExposureRecomputeDiag = {};
    let fresh: Awaited<ReturnType<typeof recomputeUserExposure>> = null;
    // Rebuild when forced, when the throttle window has passed, OR when we have
    // nothing to serve yet. The throttle still dedupes parallel hooks from the
    // same tab once a snapshot exists.
    if (force || !throttled || !existing) {
      await userRef.set({ lastExposureRecomputeAt: new Date().toISOString() }, { merge: true });
      fresh = await recomputeUserExposure(lower, recomputeDiag);
    }

    // Prefer the fresh rebuild; fall back to the last-good snapshot so a
    // transient rebuild failure keeps showing real data instead of nothing.
    const result = fresh ?? existing;

    const username =
      (userSnap.exists ? ((userSnap.data() as { username?: string }).username || '') : '')
      || result?.username
      || bananaDefaultName(lower);

    const withDebug = (payload: UserExposure, served: string) =>
      json({
        exposure: payload,
        debug: { force, throttled, lastRaw, hadExisting: !!existing, recomputeReturned: fresh ? 'non-null' : 'null', served, recomputeDiag },
      }, 200);

    if (result) {
      return debug ? withDebug(result, 'data') : json(result, 200);
    }

    // Nothing to serve. Distinguish a GENUINE zero (the wallet has no completed
    // drafts) from a FAILED/ambiguous rebuild. The client shows "No draft data
    // yet" only for the former, and a "building…" retry state (never a false
    // empty) for the latter — which then resolves live on the next poll.
    const genuinelyEmpty =
      recomputeDiag.reason === 'genuinely-empty' ||
      (recomputeDiag.rawTokenCount ?? -1) === 0;
    const emptyDoc: UserExposure = { username, totalDrafts: 0, exposures: [] };
    if (genuinelyEmpty) {
      return debug ? withDebug(emptyDoc, 'genuinely-empty') : json(emptyDoc, 200);
    }
    const buildingDoc: UserExposure = { ...emptyDoc, building: true };
    return debug ? withDebug(buildingDoc, 'building') : json(buildingDoc, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
