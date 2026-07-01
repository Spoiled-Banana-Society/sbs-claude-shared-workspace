import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser, linkedWalletsOf } from '@/lib/privyServer';
import { isWalletAdmin, getAdminWalletAllowlist } from '@/lib/adminAllowlist';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TEMPORARY auth-debug — shows how the server resolves the caller's wallet for
 * the admin check. Auth-gated (any logged-in user), returns only the caller's
 * own resolution. Remove after diagnosing the social-login admin 403.
 */
export async function GET(req: Request) {
  try {
    const user = await getPrivyUser(req); // { userId: DID, walletAddress }
    const privyUser = await fetchPrivyUser(user.userId);
    const linked = privyUser ? linkedWalletsOf(privyUser) : [];
    const result = {
      did: user.userId,
      jwtResolvedWallet: user.walletAddress,
      jwtWalletIsAdmin: user.walletAddress ? isWalletAdmin(user.walletAddress) : false,
      fetchPrivyUserOk: !!privyUser,
      privyRawLinkedAccounts: privyUser?.linked_accounts?.map((a) => ({ type: a.type, address: a.address })) ?? null,
      privyTopWallet: privyUser?.wallet?.address ?? null,
      linkedWallets: linked,
      linkedWalletsAdminFlags: linked.map((w) => ({ w, admin: isWalletAdmin(w) })),
      allowlist: getAdminWalletAllowlist(),
      wouldPassRequireAdmin:
        (!!user.walletAddress && isWalletAdmin(user.walletAddress)) || linked.some((w) => isWalletAdmin(w)),
    };
    // Persist so it can be read server-side too.
    await getAdminFirestore().collection('admin_auth_debug').doc('latest').set({ ...result, at: new Date().toISOString() }).catch(() => {});
    return json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
