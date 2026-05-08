import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getExposure, recomputeUserExposure } from '@/lib/db';
import type { ExposureRecomputeDiag } from '@/lib/db-firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

const RECOMPUTE_THROTTLE_MS = 60_000;

export async function GET(req: Request, ctx: { params: { userId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const { userId } = ctx.params;
    if (!userId) return jsonError('Missing route param: userId', 400);

    const lower = userId.toLowerCase();
    const force = req.url.includes('recompute=1');
    const debug = req.url.includes('debug=1');

    // Throttled recompute on every read. Mirrors the badge sweep pattern:
    // a `lastExposureRecomputeAt` timestamp on the user doc gates the
    // Go-API hit so concurrent reads share the same throttle. The
    // recompute is idempotent + writes the doc itself.
    const db = getAdminFirestore();
    const userRef = db.collection('v2_users').doc(lower);
    const userSnap = await userRef.get();
    const lastRaw = userSnap.exists ? (userSnap.data() as { lastExposureRecomputeAt?: string }).lastExposureRecomputeAt : null;
    const last = lastRaw ? Date.parse(lastRaw) : 0;
    const stale = !Number.isFinite(last) || Date.now() - last >= RECOMPUTE_THROTTLE_MS;

    const recomputeDiag: ExposureRecomputeDiag = {};
    let recomputeResult: unknown = null;
    if (force || stale) {
      await userRef.set({ lastExposureRecomputeAt: new Date().toISOString() }, { merge: true });
      recomputeResult = await recomputeUserExposure(lower, recomputeDiag);
    }

    const exposure = await getExposure(lower);
    if (!exposure) return jsonError('Exposure not found', 404);
    if (debug) {
      return json({
        exposure,
        debug: {
          force,
          stale,
          lastRaw,
          recomputeReturned: recomputeResult ? 'non-null' : 'null',
          recomputeDiag,
        },
      }, 200);
    }
    return json(exposure, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
