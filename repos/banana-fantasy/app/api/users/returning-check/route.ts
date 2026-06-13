import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser } from '@/lib/privyServer';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/users/returning-check — web2 returning-player detection
 * (Boris 2026-06-10): old-prod players who signed in with X/Gmail/email via
 * Thirdweb come back this year with a brand-new Privy wallet, so the wallet
 * snapshot can't recognize them. Their identities (email / X handle ↔ old
 * wallet) were exported from old prod's `socialUsers` into the staging
 * `web2_social_identities` collection.
 *
 * Auth'd by the Privy token; identities are derived SERVER-SIDE from the
 * Privy User API (linked_accounts) — nothing client-claimed, so it can't be
 * spoofed by typing someone else's email.
 *
 * On a match: stamps v2_users/{wallet}.isReturningPlayer (+ provenance) and
 * deletes any welcome-new-user noti that raced in at seed time.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Not configured', 503);

  try {
    const { userId: did, walletAddress } = await getPrivyUser(req);
    if (!walletAddress) return json({ returning: false, reason: 'no-wallet' });
    const wallet = walletAddress.toLowerCase();
    const db = getAdminFirestore();

    // Already decided for this account → cheap idempotent answer.
    const userRef = db.collection('v2_users').doc(wallet);
    const userSnap = await userRef.get();

    // First REAL login on the new product: stamp it and bust the roster
    // cache so the All Users directory picks them up within seconds.
    // (Doc existence alone is meaningless — imports/referrals/promo writes
    // create docs for wallets that never logged in here.)
    if (!userSnap.get('firstLoginAt')) {
      await userRef.set({ firstLoginAt: new Date().toISOString() }, { merge: true }).catch(() => {});
      await db.collection('system_cache').doc('userRoster').delete().catch(() => {});
    }
    if (userSnap.get('isReturningPlayer') === true) {
      return json({ returning: true, via: userSnap.get('returningVia') ?? 'unknown' });
    }
    if (userSnap.get('returningCheckedAt')) {
      return json({ returning: false, cached: true });
    }

    // Server-derived identities from Privy (email, google, twitter).
    const privyUser = await fetchPrivyUser(did);
    const accounts = privyUser?.linked_accounts ?? [];

    // New-season Base ping (Boris 2026-06-12): users who log in with an
    // EXTERNAL wallet (MetaMask/Coinbase — the web3 crowd coming from our
    // Mainnet seasons) get a one-time bell noti pointing at the Base/USDC
    // setup guide. Email/social users never touch a network picker, so
    // they're excluded. Login method is derived server-side from Privy
    // linked_accounts; the dedupeKey makes this once-per-wallet forever.
    const hasExternalWallet = (accounts as Array<{ type: string; wallet_client_type?: string; connector_type?: string }>)
      .some((a) => a.type === 'wallet' && a.wallet_client_type !== 'privy' && a.connector_type !== 'embedded');
    if (hasExternalWallet) {
      const { createNotification } = await import('@/lib/queueNotifications');
      await createNotification(wallet, {
        type: 'base_guide',
        title: "We're now on Base using USDC",
        message: 'New to Base? Learn how to buy, swap, or bridge USDC. Tap to learn more.',
        link: '/get-usdc',
        dedupeKey: 'base-usdc-guide',
        icon: 'zap',
      });
    }

    const keys: string[] = [];
    for (const a of accounts as Array<{ type: string; address?: string; email?: string; username?: string }>) {
      if (a.type === 'email' && a.address) keys.push(`email:${a.address.trim().toLowerCase()}`);
      if (a.type === 'google_oauth' && (a.email || a.address)) keys.push(`email:${String(a.email || a.address).trim().toLowerCase()}`);
      if (a.type === 'twitter_oauth' && a.username) keys.push(`x:${a.username.trim().toLowerCase().replace(/^@/, '')}`);
    }

    let matched: { key: string; oldWallet: string } | null = null;
    for (const key of keys) {
      const snap = await db.collection('web2_social_identities').doc(key).get();
      if (snap.exists) {
        matched = { key, oldWallet: (snap.get('wallet') as string) ?? '' };
        break;
      }
    }

    if (matched) {
      await userRef.set({
        isReturningPlayer: true,
        returningVia: matched.key.split(':')[0],
        returningOldWallet: matched.oldWallet,
        returningCheckedAt: new Date().toISOString(),
      }, { merge: true });
      // Self-heal: if the seed-time welcome noti raced in before this check,
      // remove it — returning players get the returning sequence instead.
      await db.collection('marketplace_notifications')
        .doc(`${wallet}__welcome-new-user`).delete().catch(() => {});
      logger.info('users.returning_check.matched', { wallet, via: matched.key.split(':')[0] });
      return json({ returning: true, via: matched.key.split(':')[0] });
    }

    // Negative result cached on the user doc so we don't re-hit Privy every login.
    if (userSnap.exists) {
      await userRef.set({ returningCheckedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    }
    return json({ returning: false });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('users.returning_check.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
