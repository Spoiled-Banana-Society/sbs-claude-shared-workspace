import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Own-DB listing cache — the instant, authoritative source for a token's
 * listing state, so the UI never waits on OpenSea's ~5–15s indexing lag.
 *
 * When a user lists, we record it here immediately; when they cancel (after the
 * on-chain tx lands), we record that. The read APIs overlay these records onto
 * OpenSea's listing feed, but ONLY within a short freshness window: long enough
 * to cover OpenSea's indexing lag, after which OpenSea is authoritative again
 * (so a filled/expired listing can't get stuck "active" forever).
 */

const COLLECTION = 'active_listings';
// Trust the cache over OpenSea for this long after a list/cancel. OpenSea
// usually indexes within ~10s; 2 min is a safe margin without risking a stale
// (filled/expired) record overriding reality for long.
const FRESHNESS_MS = 120_000;

export interface CachedListing {
  tokenId: string;
  orderHash: string;
  priceUsd: number;
  endTimeSec: string | null;
  offerer: string;
  protocolAddress: string;
  status: 'active' | 'cancelled';
  updatedAtMs: number;
}

export async function recordListed(params: {
  tokenId: string;
  orderHash: string;
  priceUsd: number;
  endTimeSec: string | null;
  offerer: string;
  protocolAddress: string;
}): Promise<void> {
  if (!isFirestoreConfigured() || !params.tokenId) return;
  try {
    await getAdminFirestore().collection(COLLECTION).doc(String(params.tokenId)).set({
      tokenId: String(params.tokenId),
      orderHash: params.orderHash,
      priceUsd: params.priceUsd,
      endTimeSec: params.endTimeSec,
      offerer: params.offerer.toLowerCase(),
      protocolAddress: params.protocolAddress,
      status: 'active',
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('listingCache.recordListed_failed', { tokenId: params.tokenId, err: (e as Error).message });
  }
}

export async function recordCancelled(tokenId: string, offerer: string): Promise<void> {
  if (!isFirestoreConfigured() || !tokenId) return;
  try {
    await getAdminFirestore().collection(COLLECTION).doc(String(tokenId)).set({
      tokenId: String(tokenId),
      offerer: offerer.toLowerCase(),
      status: 'cancelled',
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    logger.warn('listingCache.recordCancelled_failed', { tokenId, err: (e as Error).message });
  }
}

/** Recent (within freshness window) cache records for the given tokenIds. */
export async function getRecentCachedListings(tokenIds: string[]): Promise<Map<string, CachedListing>> {
  const out = new Map<string, CachedListing>();
  if (!isFirestoreConfigured() || tokenIds.length === 0) return out;
  try {
    const db = getAdminFirestore();
    const now = Date.now();
    const unique = [...new Set(tokenIds.map(String))];
    const snaps = await Promise.all(unique.map(id => db.collection(COLLECTION).doc(id).get()));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const d = snap.data() as CachedListing;
      if (now - (d.updatedAtMs ?? 0) > FRESHNESS_MS) continue; // stale → defer to OpenSea
      out.set(String(d.tokenId), d);
    }
  } catch (e) {
    logger.warn('listingCache.getRecent_failed', { err: (e as Error).message });
  }
  return out;
}
