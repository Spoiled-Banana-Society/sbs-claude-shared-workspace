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
// Public Base mainnet RPCs — always-on fallbacks. The configured RPC
// (NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL) can fail, be rate-limited, or point at the
// wrong network, in which case totalSupply reads as 0 and the marketplace
// wrongly HIDES the newest teams (their on-chain id exceeds the stale-low cap).
// Seen 2026-06-13: League 4 teams 53/61/69 vanished while supply was really 77.
// 2026-06-28: a SINGLE stale-low public node (returning ~125 while the chain was
// at 427) capped maxId and hid most recent teams — so we now read SEVERAL
// independent public RPCs and take the MAX, which no single lagging node can cap.
const FALLBACK_RPCS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
];

async function readTotalSupply(rpc: string): Promise<number> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: BBB4_CONTRACT_ADDRESS, data: '0x18160ddd' }, 'latest'], // totalSupply()
    }),
    signal: AbortSignal.timeout(3000),
  });
  const j = await res.json();
  return j?.result && j.result !== '0x' ? Number(BigInt(j.result)) : 0;
}

export async function currentMaxTokenId(): Promise<number> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.max;

  // Read totalSupply from BOTH RPCs and take the MAX. The configured Alchemy
  // endpoint has been observed returning a STALE value (1 — the supply right
  // after deploy) from a lagging backend node, non-deterministically per
  // request, while the chain is really at ~78. totalSupply only ever GROWS, so
  // the truth is the highest value any source reports. A single stale-low node
  // can then never cap the supply low and hide real teams (League-4 bug,
  // 2026-06-13). Both run concurrently; failures resolve to 0 and are ignored.
  const rpcs = [...new Set([BASE_RPC_URL, ...FALLBACK_RPCS])];
  const reads = await Promise.allSettled(rpcs.map((u) => readTotalSupply(u)));
  let supply = 0;
  for (const r of reads) if (r.status === 'fulfilled' && r.value > supply) supply = r.value;

  if (supply > 0) {
    // Monotonic: supply never shrinks, so never accept a cap below one we've
    // already established — bulletproofs against any future stale-low read.
    const max = Math.max(supply + MARGIN, cache?.max ?? 0);
    cache = { ts: Date.now(), max };
    return max;
  }
  // Both reads failed — keep a prior cap if we have one, else show everything
  // (better to briefly show a ghost than drop a real token).
  return cache?.max ?? Number.MAX_SAFE_INTEGER;
}

/**
 * True if this token id is a real on-chain token: a CANONICAL integer id (no
 * leading zeros) in 0..supply+margin. Requiring the canonical form is what stops
 * a leftover leading-zero ghost doc ("043") from being counted a SECOND time
 * alongside the real "43" — both pass the numeric range, only "43" is canonical.
 *
 * Floor is 0, NOT 1: this BBB4 contract was deployed WITHOUT reserving token #0
 * (verified 2026-06-22: ownerOf(0) is a real drafter, not the owner wallet), so
 * token #0 is a genuine player team — the first drafter of league #1. A `>= 1`
 * floor silently dropped that team (9 of 10 shown). The canonical `String(n)===s`
 * check still rejects "" (Number("")===0 but "0"!=="") and "00", so only the
 * exact id "0" is accepted — no empty/ghost id leaks in.
 */
export function isRealToken(tokenId: string | number, maxId: number): boolean {
  const s = String(tokenId).trim();
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= maxId && String(n) === s;
}

/**
 * Canonicalize a decoded on-chain token id to its integer string ("043" → "43").
 * Synthetic `<10-digit-unix><tokenId>` cardIds can yield LEADING-ZERO ids when
 * sliced; those pass numeric range checks but collide with / get dropped against
 * the canonical "43" everywhere we key by id (marketplace_index, owner sets,
 * league ownership). Always run a decoded id through this so the same on-chain
 * token has exactly ONE key — keeping counts and team/pass status accurate.
 *
 * Token #0 is valid (see isRealToken — this contract didn't reserve it). We must
 * still reject EMPTY/missing input: `Number('')` is 0 in JS, so a blank id would
 * otherwise canonicalize to a fake "0". Guard the empty string explicitly first. */
export function canonTokenId(raw: string | number | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (s === '') return null; // empty / null / undefined = not a token (avoid Number('')===0)
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? String(n) : null;
}
