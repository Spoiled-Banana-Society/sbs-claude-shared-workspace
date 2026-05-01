import { ApiError } from '@/lib/api/errors';
import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser, linkedWalletsOf } from '@/lib/privyServer';

/**
 * Auth gate for routes that operate on the caller's own wallet.
 *
 * Returns a server-derived wallet address. The route MUST NOT read a wallet
 * or userId from the request body — every wallet-scoped operation must use
 * this return value as the source of truth.
 *
 * Order of resolution:
 *   1. JWT contains a wallet claim → use it directly.
 *   2. Otherwise, look up the Privy user by DID and use the first linked wallet.
 *   3. No linked wallet at all → 401.
 *
 * All addresses returned lowercased.
 */
export async function requireWalletAuth(
  req: Request,
): Promise<{ userId: string; walletAddress: string }> {
  const user = await getPrivyUser(req);

  if (user.walletAddress) {
    return { userId: user.userId, walletAddress: user.walletAddress.toLowerCase() };
  }

  const privyUser = await fetchPrivyUser(user.userId);
  if (!privyUser) throw new ApiError(401, 'No linked wallet for authenticated user');

  const wallets = linkedWalletsOf(privyUser);
  if (wallets.length === 0) throw new ApiError(401, 'No linked wallet for authenticated user');

  return { userId: user.userId, walletAddress: wallets[0] };
}

/**
 * Auth gate for routes that take a wallet from the body and need to prove the
 * caller actually owns it (e.g. account-switch flows, claim flows where the
 * user picks which of their linked wallets to credit).
 *
 * Verifies the JWT, then verifies the claimed wallet is one of the linked
 * wallets on the authenticated Privy user. Throws 403 otherwise.
 */
export async function requireWalletOwnership(
  req: Request,
  claimedWallet: string,
): Promise<{ userId: string; walletAddress: string }> {
  const claimed = claimedWallet.trim().toLowerCase();
  if (!claimed) throw new ApiError(400, 'walletAddress is required');

  const user = await getPrivyUser(req);

  if (user.walletAddress && user.walletAddress.toLowerCase() === claimed) {
    return { userId: user.userId, walletAddress: claimed };
  }

  const privyUser = await fetchPrivyUser(user.userId);
  if (!privyUser) throw new ApiError(403, 'Wallet ownership not verified');

  const wallets = linkedWalletsOf(privyUser);
  if (!wallets.includes(claimed)) {
    throw new ApiError(403, 'Wallet ownership not verified');
  }

  return { userId: user.userId, walletAddress: claimed };
}
