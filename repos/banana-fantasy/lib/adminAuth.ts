import { ApiError } from '@/lib/api/errors';
import { getPrivyUser } from '@/lib/auth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { fetchPrivyUser, linkedWalletsOf } from '@/lib/privyServer';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export function isAdmin(userId: string): boolean {
  return isWalletAdmin(userId);
}

// Firestore-backed admin DID allowlist. Needed because social/email admins
// authenticate with a Privy embedded wallet that the Privy server API does NOT
// reliably surface (the JWT carries no wallet claim, and the User-API lookup can
// return null / prefer an external wallet) — so the wallet allowlist can't see
// them even though their wallet IS an admin. Whitelisting the Privy DID directly
// is resolution-proof. Cached in-memory (60s) so the common poll path stays cheap.
let _adminDidsCache: { dids: Set<string>; expires: number } | null = null;
async function adminDidAllowlist(): Promise<Set<string>> {
  const now = Date.now();
  if (_adminDidsCache && now < _adminDidsCache.expires) return _adminDidsCache.dids;
  const dids = new Set<string>();
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection('config').doc('adminDids').get();
      for (const d of ((snap.data()?.dids as string[]) ?? [])) if (typeof d === 'string' && d) dids.add(d);
    } catch { /* fall back to empty — wallet allowlist still applies */ }
  }
  _adminDidsCache = { dids, expires: now + 60_000 };
  return dids;
}

/**
 * Auth gate for admin endpoints.
 *
 * 1. Verify the Privy JWT (proves the caller is authenticated).
 * 2. If the JWT payload already carried a wallet, check it against the admin allowlist.
 * 3. Otherwise, look the user up by DID via Privy's server API to get their linked
 *    wallets, then check if any of them are in the allowlist.
 *
 * This replaces the previous trust-based `X-Admin-Wallet` header — we no longer
 * accept a client-supplied wallet for the allowlist check.
 */
export async function requireAdmin(
  req: Request,
): Promise<{ userId: string; walletAddress: string | null }> {
  const user = await getPrivyUser(req);

  // Fast path: JWT already had a wallet that's on the allowlist
  if (user.walletAddress && isAdmin(user.walletAddress)) {
    return { userId: user.userId, walletAddress: user.walletAddress };
  }

  // DID allowlist: resolution-proof path for social/email admins.
  const adminDids = await adminDidAllowlist();
  if (adminDids.has(user.userId)) {
    return { userId: user.userId, walletAddress: user.walletAddress };
  }

  // Fallback: server-side Privy user lookup to find linked wallets
  const privyUser = await fetchPrivyUser(user.userId);
  const linked = privyUser ? linkedWalletsOf(privyUser) : [];
  const adminWallet = linked.find((w) => isAdmin(w));
  if (adminWallet) {
    return { userId: user.userId, walletAddress: adminWallet };
  }

  // Not an admin by wallet OR DID. Capture the resolution so a locked-out
  // (social-login) admin's DID can be added to config/adminDids — a one-time
  // data write, no deploy. Best-effort; never blocks the 403.
  if (isFirestoreConfigured()) {
    try {
      await getAdminFirestore().collection('admin_auth_debug').doc('latest').set({
        at: new Date().toISOString(),
        did: user.userId,
        jwtResolvedWallet: user.walletAddress ?? null,
        jwtWalletIsAdmin: user.walletAddress ? isAdmin(user.walletAddress) : false,
        fetchPrivyUserOk: !!privyUser,
        linkedWallets: linked,
        linkedWalletsAdminFlags: linked.map((w) => ({ w, admin: isAdmin(w) })),
      }, { merge: false });
    } catch { /* best-effort */ }
  }
  logger.warn('admin.auth.denied', { did: user.userId, jwtWallet: user.walletAddress ?? null, linkedCount: linked.length });
  throw new ApiError(403, 'Forbidden');
}
