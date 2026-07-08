import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser } from '@/lib/privyServer';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ensureNamedReferralCode, unlockBadge } from '@/lib/db';

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
    // A brand-new web2 user fires this before Privy's token is ready, so
    // getPrivyUser THROWS — catch it and fall back to the client-supplied wallet
    // for stamping firstLoginAt + the new-user bells. The returning-player
    // identity match below needs a server-verified `did`, so it simply no-ops
    // when we couldn't authenticate (it re-runs on a later session once the
    // token is ready). Same trust the no-auth seed path already uses.
    let did = '';
    let walletAddress: string | null = null;
    try {
      const u = await getPrivyUser(req);
      did = u.userId;
      walletAddress = u.walletAddress;
    } catch { /* token not ready — fall back to the client wallet below */ }
    let body: { wallet?: string } = {};
    try { body = (await req.json()) as { wallet?: string }; } catch { /* no body */ }
    const clientWallet = typeof body.wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.wallet)
      ? body.wallet.toLowerCase() : null;
    const wallet = (walletAddress?.toLowerCase()) || clientWallet;
    if (!wallet) {
      return json({ returning: false, reason: 'no-wallet' });
    }
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


      // 2) Founder Draft — the ONLY founder ping is now a single day-of broadcast
      //    at ~5am PT to every user (/api/crons/founder-teaser). No day-before
      //    ping and no second on-login ping (Boris 2026-07-08: "only one ping
      //    about founder draft"), so nothing fires here anymore.
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
      // ensureNamedReferralCode reads the authoritative name server-side and
      // ignores any passed display name (see its SECURITY note).
      await ensureNamedReferralCode(wallet);
    } catch { /* non-fatal — referrals page also mints on demand */ }

    // If we couldn't server-verify the user (token not ready → client-wallet
    // fallback), we've already stamped firstLoginAt + fired the new-user bells
    // above. Stop here WITHOUT doing the returning-player identity match or
    // caching a negative result — the match needs a verified `did`, and a later
    // session (token ready) re-runs this and does the real check.
    if (!did) {
      return json({ returning: false, reason: 'unauth-fallback' });
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

    // Web3 returning: the user comes back with the SAME wallet they played a
    // past BBB season (1–3) with — no email/X link to match on. Check the
    // logged-in wallet AND any linked external (non-Privy) wallet against the
    // all-time past-players snapshot (isPastPlayer → existing-players.json:
    // BBB 2022–2025, on-chain S2/S3 + prod Firestore). Either path → returning.
    if (!matched) {
      const { isPastPlayer } = await import('@/lib/returningUsers');
      const walletCandidates = [wallet];
      for (const a of accounts as Array<{ type: string; address?: string; wallet_client_type?: string }>) {
        if (a.type === 'wallet' && a.address && a.wallet_client_type !== 'privy') {
          walletCandidates.push(a.address.toLowerCase());
        }
      }
      const pastWallet = walletCandidates.find((w) => isPastPlayer(w));
      if (pastWallet) matched = { key: `wallet:${pastWallet}`, oldWallet: pastWallet };
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
      // A returning player IS a past-season (BBB1–3) player, so they've earned
      // the OG badge. The badge is seeded LOCKED for everyone — detection alone
      // never flipped it, so OG sat locked until a manual admin grant. Unlock it
      // here so returning detection and the OG grant happen in one breath.
      // unlockBadge is idempotent (no-op if already unlocked) and fires its own
      // durable bell + real-time toast, so re-runs never double-bell.
      await unlockBadge(wallet, 'og', { source: 'past-player' }).catch((e) => {
        logger.warn('users.returning_check.og_unlock_failed', { wallet, err: (e as Error).message });
        return false;
      });
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
