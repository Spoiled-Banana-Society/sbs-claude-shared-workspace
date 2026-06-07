// Authoritative "is this token an UNDRAFTED draft pass?" check.
//
// The Go API's `/owner/{wallet}/draftToken/all` splits a wallet's tokens into
// `available` (minted pass, not yet drafted → grey draft pass) and `active`
// (drafted → team). That split — NOT whatever roster attrs happen to sit in
// Firestore — is the source of truth for pass-vs-team. (On staging, tokens get
// recycled, so an available pass can carry a stale roster doc from a prior
// draft; trusting that doc made undrafted passes wrongly render as teams.)
//
// Cached per-owner so a whale wallet (admin owns 600+) costs ONE Go fetch even
// when OpenSea hammers the per-token metadata endpoint for every token at once.

import { getOnchainOwner } from '@/lib/onchain/ownerOf';
import { logger } from '@/lib/logger';

const DRAFTS_API_BASE = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

const TTL_MS = 60_000;

interface OwnerPasses { ids: Map<string, string>; ts: number } // realTokenId → passType
const byOwner = new Map<string, OwnerPasses>();
const inflight = new Map<string, Promise<Map<string, string>>>();
const ownerOfToken = new Map<string, { owner: string; ts: number }>();

/** Fetch + cache an owner's undrafted-pass token ids (→ passType). Concurrent
 *  callers for the same owner share ONE fetch (a whale's 600 tokens resolve in
 *  parallel → without this they'd all stampede the Go API). */
async function loadOwnerPasses(owner: string): Promise<Map<string, string>> {
  const lo = owner.toLowerCase();
  const cached = byOwner.get(lo);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.ids;
  const pending = inflight.get(lo);
  if (pending) return pending;

  const p = (async () => {
    const ids = new Map<string, string>();
    try {
      const res = await fetch(`${DRAFTS_API_BASE}/owner/${lo}/draftToken/all`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        for (const t of (Array.isArray(data?.available) ? data.available : [])) {
          const passType = String(t?.passType ?? '').trim();
          // The on-chain token id is `realTokenId` on newer records, but ~65 of
          // the admin wallet's passes are LEGACY records with no realTokenId —
          // their on-chain id sits in `_cardId` as a small (≤7-digit) integer
          // (the 19-digit timestamp form always carries realTokenId separately).
          // Index BOTH so every undrafted pass is recognized, not just newer ones.
          const rt = String(t?.realTokenId ?? '').trim();
          if (/^\d+$/.test(rt)) ids.set(rt, passType);
          const cid = String(t?._cardId ?? t?.cardId ?? '').trim();
          if (/^\d{1,7}$/.test(cid)) ids.set(cid, passType);
        }
      }
    } catch (err) {
      // Go API down → we can't authoritatively tell pass from team, so callers
      // fall back to Firestore (which may be stale). Surface it so a wave of
      // wrong-looking cards is traced to its root, not guessed at.
      logger.warn('nft.pass_classify_go_failed', { owner: lo, err: (err as Error).message });
    }
    byOwner.set(lo, { ids, ts: Date.now() });
    inflight.delete(lo);
    return ids;
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
 * Is `tokenId` an undrafted draft pass right now? `ownerHint` (when the caller
 * already knows the owner, e.g. the marketplace owner scope) skips the on-chain
 * owner lookup entirely.
 */
export async function classifyToken(tokenId: string, ownerHint?: string | null): Promise<PassClassification> {
  const id = String(tokenId).trim();
  if (!/^\d+$/.test(id)) return { isPass: false };

  // Fast path: a recently-cached owner whose pass-set already contains this id.
  for (const c of byOwner.values()) {
    if (Date.now() - c.ts < TTL_MS && c.ids.has(id)) return { isPass: true, passType: c.ids.get(id) };
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

  const ids = await loadOwnerPasses(owner);
  return ids.has(id) ? { isPass: true, passType: ids.get(id) } : { isPass: false };
}
