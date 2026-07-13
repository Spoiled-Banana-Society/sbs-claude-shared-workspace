// Authoritative "is this token an UNDRAFTED draft pass (grey) vs a drafted team?"
//
// Source of truth is the Go API's per-wallet split:
//   - `available` = minted but NOT yet drafted → grey draft pass
//   - `active`    = drafted → team
// NOT whatever roster attrs happen to sit in Firestore (those go stale when
// staging recycles ids). A token is a pass ONLY if it's in `available` AND NOT
// in `active` — DRAFTED WINS, because staging leaves stale `available` rows for
// tokens that have actually been drafted (e.g. a team also listed under its old
// pass record). Cached per-owner so a whale wallet (admin owns 600+) costs ONE
// Go fetch even when OpenSea hammers the per-token metadata endpoint at once.

import { getOnchainOwner } from '@/lib/onchain/ownerOf';
import { canonTokenId } from '@/lib/onchain/contractSupply';
import { logger } from '@/lib/logger';

const DRAFTS_API_BASE = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

const TTL_MS = 60_000;

interface OwnerTokens { passIds: Map<string, string>; activeIds: Set<string>; ts: number }
const byOwner = new Map<string, OwnerTokens>();
const inflight = new Map<string, Promise<OwnerTokens>>();
const ownerOfToken = new Map<string, { owner: string; ts: number }>();

/**
 * The on-chain token id a Go draft-token record points at. Newer records carry
 * `realTokenId`; legacy ones encode it in `_cardId` — either the bare on-chain
 * id (≤7 digits) or the staging form `<10-digit unix-seconds><tokenId>`. The
 * 19-digit synthetic collision ids always have realTokenId set, so they resolve
 * via `realTokenId` and never get mis-decoded here.
 */
function recordTokenId(t: Record<string, unknown>): string | null {
  const rt = String(t.realTokenId ?? '').trim();
  if (/^\d+$/.test(rt)) return canonTokenId(rt);
  const cid = String(t._cardId ?? t.cardId ?? '').trim();
  if (/^\d{1,7}$/.test(cid)) return canonTokenId(cid);
  if (/^\d{10}\d{1,7}$/.test(cid)) return canonTokenId(cid.slice(10));
  return null;
}

/** Fetch + cache an owner's pass ids (available) and drafted ids (active).
 *  Concurrent callers for the same owner share ONE fetch. */
async function loadOwnerTokens(owner: string): Promise<OwnerTokens> {
  const lo = owner.toLowerCase();
  const cached = byOwner.get(lo);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached;
  const pending = inflight.get(lo);
  if (pending) return pending;

  const p = (async (): Promise<OwnerTokens> => {
    const passIds = new Map<string, string>();
    const activeIds = new Set<string>();
    let ok = false;
    try {
      const res = await fetch(`${DRAFTS_API_BASE}/owner/${lo}/draftToken/all`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        for (const t of (Array.isArray(data?.active) ? data.active : [])) {
          const id = recordTokenId(t);
          if (id) activeIds.add(id);
        }
        for (const t of (Array.isArray(data?.available) ? data.available : [])) {
          const id = recordTokenId(t);
          if (id) passIds.set(id, String(t?.passType ?? '').trim());
        }
        ok = true;
      }
    } catch (err) {
      // Go API down → we can't authoritatively tell pass from team, so callers
      // fall back to Firestore (which may be stale). Surface it so a wave of
      // wrong-looking cards is traced to its root, not guessed at.
      logger.warn('nft.pass_classify_go_failed', { owner: lo, err: (err as Error).message });
    }
    const result: OwnerTokens = { passIds, activeIds, ts: Date.now() };
    // CRITICAL: only cache a SUCCESSFUL fetch. A failed/timed-out Go call yields
    // empty lists → every one of this owner's tokens would classify as "not a
    // pass" (a whale's 600 passes flicker to teams). Caching that empty result
    // pinned the mis-classification for the full 60s TTL. On failure we still
    // return the empty result for THIS call (caller falls back), but we don't
    // poison the cache — the next read retries the Go API immediately.
    if (ok) byOwner.set(lo, result);
    inflight.delete(lo);
    return result;
  })();
  inflight.set(lo, p);
  return p;
}

export interface PassClassification { isPass: boolean; passType?: string }

/** Normalize the Go passType into a clean "Paid" | "Free" label. */
export function passTypeLabel(passType?: string): 'Paid' | 'Free' {
  return /free/i.test(passType || '') ? 'Free' : 'Paid';
}

/**
 * Is `tokenId` an undrafted draft pass right now? DRAFTED WINS: a token that is
 * in the owner's `active` list is a team even if a stale `available` row exists.
 * `ownerHint` (when the caller already knows the owner) skips the on-chain lookup.
 */
export async function classifyToken(tokenId: string, ownerHint?: string | null): Promise<PassClassification> {
  const id = String(tokenId).trim();
  if (!/^\d+$/.test(id)) return { isPass: false };

  // Fast path: a recently-cached owner whose lists already contain this id.
  for (const c of byOwner.values()) {
    if (Date.now() - c.ts >= TTL_MS) continue;
    if (c.activeIds.has(id)) return { isPass: false };
    if (c.passIds.has(id)) return { isPass: true, passType: c.passIds.get(id) };
  }

  // Resolve the owner (hint → token cache → on-chain).
  let owner = ownerHint || null;
  if (!owner) {
    const oc = ownerOfToken.get(id);
    if (oc && Date.now() - oc.ts < TTL_MS) owner = oc.owner;
  }
  if (!owner) {
    owner = await getOnchainOwner(id);
    if (owner) ownerOfToken.set(id, { owner, ts: Date.now() });
  }
  if (!owner) return { isPass: false };

  const t = await loadOwnerTokens(owner);
  if (t.activeIds.has(id)) return { isPass: false };
  if (t.passIds.has(id)) return { isPass: true, passType: t.passIds.get(id) };
  return { isPass: false };
}
