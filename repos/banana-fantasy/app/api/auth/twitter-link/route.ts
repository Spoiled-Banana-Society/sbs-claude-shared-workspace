/**
 * X-link status for a wallet — reads the REAL store (v2_twitter_links).
 *
 * The client user object's xHandle is set in memory right after a Privy link
 * and is never persisted, so the profile page showed "Not linked" for linked
 * users (Silkyjohnson, Fantasy Couch — Richard 8/13). This is the truth
 * endpoint; anything displaying link status should read it.
 */
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 500);
  const wallet = (getSearchParam(req, 'wallet') ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return jsonError('Invalid wallet', 400);
  try {
    const snap = await getAdminFirestore().collection('v2_twitter_links')
      .where('walletAddress', '==', wallet).limit(1).get();
    const handle = snap.empty ? null : String(snap.docs[0].data()?.twitterHandle ?? '') || null;
    return json({ handle });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'lookup failed', 500);
  }
}
