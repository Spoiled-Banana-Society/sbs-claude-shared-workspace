import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const TWITTER_LINKS_COLLECTION = 'v2_twitter_links';

async function requireAuthenticatedUser(req: Request, walletAddress: string): Promise<string> {
  // Verify the Privy access token (proves the caller is logged in) AND return
  // the Privy userId (a DID) — the stable per-PERSON identifier. We key the
  // anti-sybil check on this, NOT the wallet: one real person can hold several
  // wallets (an embedded Privy wallet PLUS a connected MetaMask, and the app
  // prioritizes the external one), so the derived wallet changes for the same
  // human — which used to false-trigger "this X is already linked to a
  // different account" and disconnect legit users. The person (DID) is stable.
  const { userId } = await getPrivyUser(req);
  if (!walletAddress) {
    throw new ApiError(400, 'walletAddress is required');
  }
  return userId;
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
    const privyUserId = await requireAuthenticatedUser(req, walletAddress);

    const db = getAdminFirestore();
    const linkRef = db.collection(TWITTER_LINKS_COLLECTION).doc(twitterId);
    const linkSnap = await linkRef.get();

    if (linkSnap.exists) {
      const existing = linkSnap.data()!;
      const existingPersonId = existing.privyUserId as string | undefined;

      if (existingPersonId) {
        // Modern record — decide by PERSON (Privy DID), not wallet.
        if (existingPersonId === privyUserId) {
          // Same person reconnecting their OWN X (new device / added a wallet).
          // Always allow; refresh the stored wallet/handle so they stay current.
          if (existing.walletAddress !== walletAddress || existing.twitterHandle !== twitterHandle) {
            await linkRef.update({ walletAddress, twitterHandle, relinkedAt: new Date().toISOString() });
          }
          return json({ verified: true, handle: twitterHandle, newUserPromoClaimed: existing.newUserPromoClaimed ?? false });
        }
        // A DIFFERENT person trying to use an X already owned by someone else →
        // block. This is the real anti-sybil case ("one X = one person, ever").
        return json(
          { verified: false, error: 'This X account is already linked to a different account. One account per person — if you have more than one account you are NOT eligible to win prizes.' },
          400,
        );
      }

      // LEGACY record (created before we stored the person-ID). We can't know
      // who originally linked it — but the caller just OAuth'd this exact X, so
      // they control that X account (you can't OAuth an X you don't own). Trust
      // them, adopt the link, and BACKFILL the person-ID so it's protected by
      // the person check from now on. newUserPromoClaimed is preserved (it lives
      // on this twitterId record), so the promo still can't be claimed twice
      // with the same X regardless of which account holds the link.
      await linkRef.update({
        privyUserId,
        walletAddress,
        twitterHandle,
        backfilledAt: new Date().toISOString(),
      });
      return json({ verified: true, handle: twitterHandle, newUserPromoClaimed: existing.newUserPromoClaimed ?? false });
    }

    // New link — store mapping, now keyed to the PERSON via privyUserId.
    await linkRef.set({
      twitterId,
      twitterHandle,
      walletAddress,
      privyUserId,
      linkedAt: new Date().toISOString(),
      newUserPromoClaimed: false,
    });

    // Background user event (waitUntil-backed — feeds referral milestone
    // detection; a detached promise dies with the frozen lambda).
    try {
      const { logUserEvent } = await import('@/lib/userEvents');
      const { runInBackground } = await import('@/lib/serverBackground');
      runInBackground('auth.x-linked-event', logUserEvent(walletAddress, 'x_linked', { twitterHandle }));
    } catch {
      // non-fatal
    }

    // Real-time push: new-user promo just became claimable for this
    // wallet (verified Twitter + not yet claimed). Frontend toast +
    // bell fire within ~100ms; user can claim immediately from the
    // promos page without waiting for the next page-load fetch.
    try {
      const { pushStreamEventBg } = await import('@/lib/userEventStream');
      pushStreamEventBg(walletAddress, 'promo-new-user', { source: 'twitter-verify' });
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
    await requireAuthenticatedUser(req, walletAddress);

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
