import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

// USDC on Base (6 decimals). The single source of "real money" for a user:
// marketplace sale proceeds, leftover mint USDC, and paid-out prizes (the prize
// payout pays USDC straight into the user's wallet) all land here.
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_RPC = process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org';
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * GET /api/owner/usdc-balance?wallet=0x...
 *
 * Returns the wallet's on-chain USDC balance on Base as a USD number.
 * Used by the Winnings page to fold a user's actual wallet USDC into their
 * withdrawable balance. Always fresh (no-store) — it's mutable on-chain state.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const wallet = (getSearchParam(req, 'wallet') || '').trim();
  if (!WALLET_RE.test(wallet)) return jsonError('Invalid wallet address', 400);

  try {
    // balanceOf(address) — selector 0x70a08231 + 32-byte left-padded address.
    const data = '0x70a08231' + '0'.repeat(24) + wallet.slice(2).toLowerCase();
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC_BASE, data }, 'latest'] }),
    });
    if (!res.ok) return jsonError('Failed to read balance', 502);
    const j = await res.json();
    const wei = BigInt(j?.result && j.result !== '0x' ? j.result : '0x0');
    return json({ usdc: Number(wei) / 1e6 });
  } catch {
    return jsonError('Failed to read balance', 502);
  }
}
