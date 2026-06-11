import { BASE_RPC_URL, BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';
import { logger } from '@/lib/logger';

/**
 * Authoritative on-chain owner of a BBB4 token.
 *
 * OpenSea's NFT index lags minutes behind a sale, so right after a purchase it
 * still reports the previous owner — which made the buyer's freshly-bought team
 * show "Make Offer" and stay out of "My Teams". This reads `ownerOf(tokenId)`
 * straight from the chain (the source of truth) so ownership is correct the
 * instant the buy tx lands. Returns null on any RPC failure so callers can fall
 * back to OpenSea rather than hard-fail.
 */
export async function getOnchainOwner(tokenId: string | number): Promise<string | null> {
  try {
    const tokenHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const data = `0x6352211e${tokenHex}`; // ownerOf(uint256)
    const res = await fetch(BASE_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: BBB4_CONTRACT_ADDRESS, data }, 'latest'],
      }),
      // MUST be fresh: Next.js App Router caches fetch() by default, which made
      // ownerOf return the PRE-SALE owner for minutes after a sale — sold teams
      // lingered in My Teams and "You paid" priced for the old owner. Ownership
      // is never cacheable.
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const jsonRes = await res.json();
    const result: string | undefined = jsonRes?.result;
    // 32-byte word; address is the low 20 bytes (last 40 hex chars).
    if (!result || result === '0x' || result.length < 66) return null;
    const addr = '0x' + result.slice(-40);
    if (/^0x0+$/.test(addr)) return null; // zero address = not minted / burned
    return addr.toLowerCase();
  } catch (e) {
    logger.warn('ownerOf.onchain_failed', { tokenId: String(tokenId), err: (e as Error).message });
    return null;
  }
}
