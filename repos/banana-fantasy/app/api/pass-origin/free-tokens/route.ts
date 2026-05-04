import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const COLLECTION = 'pass_origin';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * GET /api/pass-origin/free-tokens?wallet=0x...
 *
 * Returns the BBB4 tokenIds that were minted to this wallet via a free path
 * (admin grant, wheel spin reward, promo claim). The marketplace listing UI
 * uses this to block selling free-origin passes until the season closes.
 *
 * The Go API doesn't tag admin-minted tokens with a `passType: "free"` flag
 * — our server-side pass_origin collection is the authoritative record of
 * how a given tokenId was minted.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const url = new URL(req.url);
    const wallet = (url.searchParams.get('wallet') ?? '').trim().toLowerCase();
    if (!WALLET_REGEX.test(wallet)) throw new ApiError(400, 'Invalid wallet');

    if (!isFirestoreConfigured()) return json({ tokenIds: [], wallet });

    const db = getAdminFirestore();
    const snap = await db
      .collection(COLLECTION)
      .where('ownerAtMint', '==', wallet)
      .get();

    const tokenIds = snap.docs
      .map((d) => (d.get('tokenId') as string) ?? d.id)
      .filter(Boolean);

    return json({ tokenIds, wallet });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[pass-origin/free-tokens] failed', err);
    return jsonError('Internal Server Error', 500);
  }
}
