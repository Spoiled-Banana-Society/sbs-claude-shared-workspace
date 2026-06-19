import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser } from '@/lib/privyServer';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ensureNamedReferralCode } from '@/lib/db';
import { bananaDefaultName } from '@/utils/helpers';
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
    // TEMP diagnostic — write to a readable Firestore doc: did the wallet
    // resolve server-side for this caller? (walletAddress null = Privy User API
    // doesn't have the embedded wallet yet → the real root cause.)
    try {
      await getAdminFirestore().collection('_signup_diag').add({
        did, walletResolved: walletAddress ?? null, at: new Date().toISOString(),
      });
    } catch { /* never block on the diagnostic */ }
    if (!walletAddress) {
      return json({ returning: false, reason: 'no-wallet' });
    }
    const wallet = walletAddress.toLowerCase();
    const db = getAdminFirestore();

    // ── On-login bells (every session; dedupeKeys make them idempotent so a
    //    user never gets the same one twice). Runs BEFORE the cached early-returns
    //    below so it fires for returning users too. Replaces the old top banners
    //    (Boris 2026-06-14). Server-backed → real-time + synced across devices. ──
    try {
      const { createNotification } = await import('@/lib/queueNotifications');

      // 1) Get-the-App — one-time, every user. Deep-links home → install how-to.
      await createNotification(wallet, {
        type: 'app_download',
        title: 'Get the SBS app',
        message: 'Add SBS to your phone to use it like a real app. Tap for how.',
        link: '/?install=1',
        dedupeKey: 'app-download',
        icon: 'phone',
      });


      // 2) Founder Draft — day-before + day-of bells, once each, when a schedule
      //    is active. Driven off the founder schedule singleton (PT dates).
      const fsSnap = await db.collection('founderSchedule').doc('next').get();
      const fs = fsSnap.exists ? (fsSnap.data() as { at?: string; active?: boolean }) : null;
      const eventMs = fs?.active && typeof fs.at === 'string' ? Date.parse(fs.at) : NaN;
      if (Number.isFinite(eventMs)) {
        const ptDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
        const timePT = new Date(eventMs).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'America/Los_Angeles' }) + ' PT';
        const todayPT = ptDate(Date.now());
        const eventDayPT = ptDate(eventMs);
        const key = new Date(eventMs).toISOString().slice(0, 10);
        // Day-OF bell fires on login (Wed). The day-BEFORE "tomorrow" ping is
        // NOT on login anymore — it's a single 6PM-PT broadcast to all users
        // (/api/crons/founder-teaser) so it doesn't get buried in the launch-day
        // onboarding flood. Same dedupeKey there, so no double-ping.
        if (todayPT === eventDayPT && Date.now() < eventMs) {
          await createNotification(wallet, {
            type: 'founder_draft',
            title: `Founder Draft today — ${timePT}`,
            message: 'The Founder Draft drops today. Tap to learn how Founder Drafts work.',
            link: '/faq#founder-draft',
            dedupeKey: `founder-today-${key}`,
            icon: 'crown',
          });
        }
      }
    } catch { /* non-fatal — never block the returning check on a bell write */ }

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
    // Referral code (Boris 2026-06-15): mint/refresh the clean NAME-based code
    // for EVERY user on login so it always exists and matches their display
    // name — never the legacy hash placeholder (BANANA-XXXX-XXXX). Idempotent:
    // ensureNamedReferralCode reuses the existing code when the name is
    // unchanged, so this never reverts an edited code. Best-effort.
    try {
      const uname = (userSnap.get('username') as string | undefined)?.trim();
      const displayName = uname && !/^0x/i.test(uname) ? uname : bananaDefaultName(wallet);
      await ensureNamedReferralCode(wallet, displayName);
    } catch { /* non-fatal — referrals page also mints on demand */ }

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
