import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Own-DB offer cache — the instant source for a token's incoming offers, so the
 * detail page shows an offer the moment it's made instead of waiting on
 * OpenSea's ~5–15s indexing lag (offers used to silently not appear for minutes).
 *
 * Mirrors lib/marketplace/listingCache, with one difference: a token can have
 * MANY active offers, so docs are keyed by orderHash (not tokenId) and reads
 * query by single-field `tokenId` equality (no composite index — see the
 * marketplace_activity no-index rule). Records older than the freshness window
 * are ignored so OpenSea stays authoritative once it has indexed/expired them.
 */

const COLLECTION = 'active_offers';

export interface CachedOffer {
  tokenId: string;
  orderHash: string;
  priceUsd: number;
  offerer: string;
  endTimeSec: string | null;
  status: 'active' | 'consumed';
  updatedAtMs: number;
}

export async function recordOffer(params: {
  tokenId: string;
  orderHash: string;
  priceUsd: number;
  offerer: string;
  endTimeSec: string | null;
}): Promise<void> {
  if (!isFirestoreConfigured() || !params.tokenId || !params.offerer) return;
  try {
    // Key by orderHash when we have it; otherwise tokenId+offerer (one live offer
    // per offerer per token) so the offer still records + shows.
    const docId = params.orderHash || `${params.tokenId}-${params.offerer.toLowerCase()}`;
    await getAdminFirestore().collection(COLLECTION).doc(docId).set({
      tokenId: String(params.tokenId),
      orderHash: params.orderHash,
      priceUsd: params.priceUsd,
      offerer: params.offerer.toLowerCase(),
      endTimeSec: params.endTimeSec,
      status: 'active',
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('offerCache.recordOffer_failed', { tokenId: params.tokenId, err: (e as Error).message });
  }
}

/** Mark a cached offer dead once it's been cancelled or accepted. Pass the
 *  tokenId when known — an offer that was never cached (made directly on
 *  OpenSea) gets its consumed marker created here, and without tokenId the
 *  per-token veto query can't see it. */
export async function recordOfferConsumed(orderHash: string, tokenId?: string): Promise<void> {
  if (!isFirestoreConfigured() || !orderHash) return;
  try {
    await getAdminFirestore().collection(COLLECTION).doc(String(orderHash)).set({
      status: 'consumed',
      orderHash: String(orderHash),
      ...(tokenId ? { tokenId: String(tokenId) } : {}),
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    logger.warn('offerCache.recordOfferConsumed_failed', { orderHash, err: (e as Error).message });
  }
}

/**
 * Active, not-yet-expired cached offers for a token. Unlike the listing cache
 * (a short bridge over OpenSea's lag), OpenSea's OFFERS feed is unreliable for
 * us, so this is the long-term source of truth: keep an offer until it's
 * consumed (accepted/cancelled) or its on-chain expiry passes — not a 2-min TTL.
 */
/** Active, unexpired offers MADE BY a wallet — powers the "Your offer $X" chip
 *  on marketplace cards. Single field-equality on `offerer` (stored lowercase);
 *  no composite index needed. Covers offers placed through SBS, which is the
 *  set the chip is for. */
export async function getCachedOffersByOfferer(offerer: string): Promise<CachedOffer[]> {
  if (!isFirestoreConfigured() || !offerer) return [];
  try {
    const snap = await getAdminFirestore().collection(COLLECTION).where('offerer', '==', offerer.toLowerCase()).get();
    const now = Date.now();
    return snap.docs
      .map(d => d.data() as CachedOffer)
      .filter(o => o.status === 'active' && (!o.endTimeSec || Number(o.endTimeSec) * 1000 > now));
  } catch (e) {
    logger.warn('offerCache.getByOfferer_failed', { offerer, err: (e as Error).message });
    return [];
  }
}

export async function getRecentCachedOffers(tokenId: string): Promise<CachedOffer[]> {
  return (await getCachedOfferState(tokenId)).active;
}

/**
 * Full cached state for a token in ONE query: live offers to supplement
 * OpenSea, plus the consumed (accepted/cancelled) hashes so the route can
 * VETO OpenSea's stale view — OpenSea keeps reporting an offer as live for
 * minutes after its on-chain cancel, and we know better.
 */
export async function getCachedOfferState(tokenId: string): Promise<{ active: CachedOffer[]; consumedHashes: Set<string> }> {
  if (!isFirestoreConfigured() || !tokenId) return { active: [], consumedHashes: new Set() };
  try {
    // Single field-equality only (no composite index). Filter in memory.
    const snap = await getAdminFirestore().collection(COLLECTION).where('tokenId', '==', String(tokenId)).get();
    const now = Date.now();
    const active: CachedOffer[] = [];
    const consumedHashes = new Set<string>();
    for (const d of snap.docs) {
      const o = d.data() as CachedOffer;
      if (o.status === 'consumed') {
        if (o.orderHash) consumedHashes.add(o.orderHash);
        continue;
      }
      if (o.endTimeSec && Number(o.endTimeSec) * 1000 <= now) continue; // expired
      active.push(o);
    }
    return { active, consumedHashes };
  } catch (e) {
    logger.warn('offerCache.getState_failed', { tokenId, err: (e as Error).message });
    return { active: [], consumedHashes: new Set() };
  }
}
