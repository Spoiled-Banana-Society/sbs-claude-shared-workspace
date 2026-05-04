import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const TWITTER_LINKS_COLLECTION = 'v2_twitter_links';

async function requireAuthenticatedWallet(req: Request, walletAddress: string) {
  // Verify the Privy access token is valid (proves the caller is logged in).
  // Wallet comparison is intentionally skipped: Privy JWTs don't carry a
  // wallet claim, the userId is a Privy DID (not a wallet), and v2_users is
  // keyed by walletAddress — so we can't look the wallet up either. Proper
  // anti-sybil here requires @privy-io/server-auth → PrivyClient.getUser()
  // to fetch linkedAccounts; deferred until that dep is added.
  await getPrivyUser(req);
  if (!walletAddress) {
    throw new ApiError(400, 'walletAddress is required');
  }
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) {
      throw new ApiError(503, 'Firestore not configured');
    }

    const body = await parseBody(req);
    const twitterId = requireString(body.twitterId, 'twitterId');
    const twitterHandle = requireString(body.twitterHandle, 'twitterHandle');
    const walletAddress = requireString(body.walletAddress, 'walletAddress').toLowerCase();
    await requireAuthenticatedWallet(req, walletAddress);

    const db = getAdminFirestore();
    const linkRef = db.collection(TWITTER_LINKS_COLLECTION).doc(twitterId);
    const linkSnap = await linkRef.get();

    if (linkSnap.exists) {
      const existing = linkSnap.data()!;
      // Same wallet — already verified, return success
      if (existing.walletAddress === walletAddress) {
        return json({ verified: true, handle: existing.twitterHandle, newUserPromoClaimed: existing.newUserPromoClaimed ?? false });
      }
      // Different wallet — anti-sybil block
      return json(
        { verified: false, error: 'This X account is already linked to another account' },
        400,
      );
    }

    // New link — store mapping
    await linkRef.set({
      twitterId,
      twitterHandle,
      walletAddress,
      linkedAt: new Date().toISOString(),
      newUserPromoClaimed: false,
    });

    // Fire-and-forget user event
    try {
      const { logUserEvent } = await import('@/lib/userEvents');
      void logUserEvent(walletAddress, 'x_linked', { twitterHandle });
    } catch {
      // non-fatal
    }

    // Note: referral "verified" milestone is NOT fired here anymore.
    // Twitter linking alone is too cheap a signal — a referrer would get
    // their spin before the friend actually engaged with the product.
    // The milestone is now triggered from /api/wheel/spin once the friend
    // has (a) claimed the New User Bonus SPIN and (b) used at least one
    // wheel spin. See route.ts in app/api/wheel/spin.

    return json({ verified: true, handle: twitterHandle, newUserPromoClaimed: false });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[verify-twitter]', err);
    return jsonError('Internal Server Error', 500);
  }
}

/**
 * GET /api/auth/verify-twitter?walletAddress=0x...
 * Check if a wallet has a verified Twitter link.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) {
      return json({ verified: false });
    }

    const url = new URL(req.url);
    const walletAddress = url.searchParams.get('walletAddress')?.toLowerCase();
    if (!walletAddress) {
      return json({ verified: false });
    }

    const db = getAdminFirestore();
    const snapshot = await db
      .collection(TWITTER_LINKS_COLLECTION)
      .where('walletAddress', '==', walletAddress)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return json({ verified: false });
    }

    const data = snapshot.docs[0].data();
    return json({ verified: true, handle: data.twitterHandle, newUserPromoClaimed: data.newUserPromoClaimed ?? false });
  } catch (err) {
    console.error('[verify-twitter GET]', err);
    return json({ verified: false });
  }
}

/**
 * PATCH /api/auth/verify-twitter
 * Mark the new-user promo as claimed for a wallet.
 */
export async function PATCH(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) {
      throw new ApiError(503, 'Firestore not configured');
    }

    const body = await parseBody(req);
    const walletAddress = requireString(body.walletAddress, 'walletAddress').toLowerCase();
    await requireAuthenticatedWallet(req, walletAddress);

    const db = getAdminFirestore();
    const snapshot = await db
      .collection(TWITTER_LINKS_COLLECTION)
      .where('walletAddress', '==', walletAddress)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return jsonError('No Twitter link found for this wallet', 404);
    }

    await snapshot.docs[0].ref.update({ newUserPromoClaimed: true });
    return json({ success: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[verify-twitter PATCH]', err);
    return jsonError('Internal Server Error', 500);
  }
}
