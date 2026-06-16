import { ApiError } from '@/lib/api/errors';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export type SessionUser = { userId: string; walletAddress: string | null };

export function assertSessionWallet(session: SessionUser, requestedWallet: string): string {
  const requested = requestedWallet.trim().toLowerCase();
  if (!WALLET_RE.test(requested)) throw new ApiError(400, 'Invalid wallet address');
  const sessionWallet = session.walletAddress?.trim().toLowerCase();
  if (!sessionWallet) throw new ApiError(403, 'Wallet required — link a wallet to your account');
  if (sessionWallet !== requested) throw new ApiError(403, 'Forbidden');
  return sessionWallet;
}

export function walletFromSession(session: SessionUser): string {
  if (!session.walletAddress) throw new ApiError(403, 'Wallet required — link a wallet to your account');
  return assertSessionWallet(session, session.walletAddress);
}
