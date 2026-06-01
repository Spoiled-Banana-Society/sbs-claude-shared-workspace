// Returning-user (BBB3) classification — supplements the live on-chain check.
//
// Returning-user status is normally derived from a live on-chain balanceOf call
// against the BBB3 contract (Eth mainnet) in hooks/useAuth.tsx. That works on
// login but can't be seen server-side, and wallets that never held BBB3 (e.g.
// Boris's staging admin wallet) can't exercise the returning flow.
//
// This module adds two supplements:
//   1. A small editable allowlist (env override + fallback) so specific wallets
//      — like the admin testing wallet — are always treated as returning. This
//      is client-safe (no fetch) so useAuth can OR it into isBB3Holder instantly.
//   2. A server-side `isReturningWallet` that also consults the stored BBB3
//      holder snapshot (Firestore `bbb3_holders`, populated by
//      scripts/snapshot-bbb3-holders.mjs) — used by admin classification so the
//      dashboard agrees with what the client sees on login.

// BBB3 ERC-721 collection on Ethereum mainnet (last year's drops). Same address
// the on-chain check in hooks/useAuth.tsx uses.
export const BBB3_CONTRACT_ADDRESS = '0x2BfF6f4284774836d867CEd2e9B96c27aAee55B7';

// Empty by default. Returning status comes from real BBB3 ownership (the
// on-chain check + snapshot). To TEST the returning flow without owning BBB3,
// use the admin "View as → Returning" toggle (per-session, doesn't mislabel the
// account). Only add a wallet here for a genuine returning player the snapshot
// missed — NOT for testing (a permanent entry makes a real new user show as
// returning everywhere, including the admin label).
const FALLBACK_RETURNING_WALLETS: string[] = [];

function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

function parseEnvWallets(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => normalizeWallet(entry))
    .filter(Boolean);
}

/** Manual returning-wallet allowlist (env override, else seeded fallback). */
export function getReturningWalletAllowlist(): string[] {
  const configured = parseEnvWallets(
    process.env.RETURNING_WALLET_ADDRESSES || process.env.NEXT_PUBLIC_RETURNING_WALLET_ADDRESSES,
  );
  if (configured.length > 0) return configured;
  return [...FALLBACK_RETURNING_WALLETS];
}

/**
 * Client-safe synchronous check: is this wallet in the manual returning
 * allowlist? OR'd into isBB3Holder so allowlisted wallets get the returning
 * treatment without an on-chain hit.
 */
export function isReturningWalletSync(walletAddress: string | null | undefined): boolean {
  if (!walletAddress) return false;
  return getReturningWalletAllowlist().includes(normalizeWallet(walletAddress));
}
