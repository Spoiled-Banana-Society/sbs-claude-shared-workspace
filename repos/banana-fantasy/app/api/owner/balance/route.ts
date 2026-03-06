import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

const USERS_COLLECTION = 'v2_users';

/**
 * GET /api/owner/balance?userId=<userId>
 *
 * Returns wheelSpins, freeDrafts, jackpotEntries, hofEntries from Firestore.
 * The Go backend doesn't store these fields, so the frontend needs a
 * separate Firestore read to get them on page load.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return jsonError('Missing userId', 400);

    const db = getAdminFirestore();
    const snap = await db.collection(USERS_COLLECTION).doc(userId).get();

    if (!snap.exists) {
      return json({ wheelSpins: 0, freeDrafts: 0, jackpotEntries: 0, hofEntries: 0 });
    }

    const data = snap.data()!;
    return json({
      wheelSpins: data.wheelSpins ?? 0,
      freeDrafts: data.freeDrafts ?? 0,
      jackpotEntries: data.jackpotEntries ?? 0,
      hofEntries: data.hofEntries ?? 0,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[owner/balance] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
