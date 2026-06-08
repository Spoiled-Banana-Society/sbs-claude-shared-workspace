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

/**
 * True if this token id is a real on-chain token: a CANONICAL integer id (no
 * leading zeros) in 1..supply+margin. Requiring the canonical form is what stops
 * a leftover leading-zero ghost doc ("043") from being counted a SECOND time
 * alongside the real "43" — both pass the numeric range, only "43" is canonical.
 */
export function isRealToken(tokenId: string | number, maxId: number): boolean {
  const s = String(tokenId).trim();
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= maxId && String(n) === s;
}

/**
 * Canonicalize a decoded on-chain token id to its integer string ("043" → "43").
 * Synthetic `<10-digit-unix><tokenId>` cardIds can yield LEADING-ZERO ids when
 * sliced; those pass numeric range checks but collide with / get dropped against
 * the canonical "43" everywhere we key by id (marketplace_index, owner sets,
 * league ownership). Always run a decoded id through this so the same on-chain
 * token has exactly ONE key — keeping counts and team/pass status accurate. */
export function canonTokenId(raw: string | number | null | undefined): string | null {
  const n = Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n > 0 ? String(n) : null;
}
