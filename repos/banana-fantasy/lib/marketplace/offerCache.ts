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
const FRESHNESS_MS = 120_000;

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
  if (!isFirestoreConfigured() || !params.tokenId || !params.orderHash) return;
  try {
    await getAdminFirestore().collection(COLLECTION).doc(String(params.orderHash)).set({
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

/** Mark a cached offer dead once it's been cancelled or accepted. */
export async function recordOfferConsumed(orderHash: string): Promise<void> {
  if (!isFirestoreConfigured() || !orderHash) return;
  try {
    await getAdminFirestore().collection(COLLECTION).doc(String(orderHash)).set({
      status: 'consumed',
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    logger.warn('offerCache.recordOfferConsumed_failed', { orderHash, err: (e as Error).message });
  }
}

/** Recent (within freshness window), still-active cached offers for a token. */
export async function getRecentCachedOffers(tokenId: string): Promise<CachedOffer[]> {
  if (!isFirestoreConfigured() || !tokenId) return [];
  try {
    // Single field-equality only (no composite index). Filter status + freshness
    // in memory — a single token has few live offers.
    const snap = await getAdminFirestore().collection(COLLECTION).where('tokenId', '==', String(tokenId)).get();
    const now = Date.now();
    return snap.docs
      .map(d => d.data() as CachedOffer)
      .filter(o => o.status === 'active' && now - (o.updatedAtMs ?? 0) <= FRESHNESS_MS);
  } catch (e) {
    logger.warn('offerCache.getRecent_failed', { tokenId, err: (e as Error).message });
    return [];
  }
}
