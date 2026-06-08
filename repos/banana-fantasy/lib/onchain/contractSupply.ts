import { BASE_RPC_URL, BBB4_CONTRACT_ADDRESS } from '@/lib/contracts/bbb4';

/**
 * The current BBB4 contract's `totalSupply()` — i.e. the highest real on-chain
 * token id. Tokens are minted sequentially, so a marketplace_index entry whose
 * id is GREATER than this is a prior-era / bot "ghost" finalize-doc that was
 * never minted on this contract (and isn't on OpenSea). Marketplace reads use
 * this as the cutoff so our counts/filters match exactly what's on-chain +
 * OpenSea. Cached ~5 min (supply only grows, slowly). A small safety margin is
 * added so a just-minted token isn't briefly hidden.
 */
let cache: { ts: number; max: number } | null = null;
const TTL_MS = 5 * 60_000;
const MARGIN = 50;

export async function currentMaxTokenId(): Promise<number> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.max;
  try {
    const res = await fetch(BASE_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: BBB4_CONTRACT_ADDRESS, data: '0x18160ddd' }, 'latest'], // totalSupply()
      }),
      signal: AbortSignal.timeout(3000),
    });
    const j = await res.json();
    const supply = j?.result && j.result !== '0x' ? Number(BigInt(j.result)) : 0;
    if (supply > 0) {
      const max = supply + MARGIN;
      cache = { ts: Date.now(), max };
      return max;
    }
  } catch { /* fall through */ }
  // On RPC failure, return a high number so we NEVER wrongly hide real teams
  // (better to briefly show a ghost than drop a real token).
  return cache?.max ?? Number.MAX_SAFE_INTEGER;
}

/** True if this token id is a real on-chain token (<= current supply + margin). */
export function isRealToken(tokenId: string | number, maxId: number): boolean {
  const n = Number(tokenId);
  return Number.isFinite(n) && n >= 1 && n <= maxId;
}
