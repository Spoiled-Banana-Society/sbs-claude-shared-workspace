/**
 * Marketplace index — the on-chain-token-id-keyed stamp that makes filtering
 * instant + clean.
 *
 *   marketplace_index/{onchainTokenId} = { tokenId, level, leagueNumber, status, updatedAt }
 *
 * Keyed by the REAL on-chain token id (not the messy Firestore cardId), so
 * "all jackpot/HOF teams" or "league #N teams" is a single indexed Firestore
 * query — no OpenSea page-scanning, no cardId decoding. Written from the metadata
 * route (best-effort, fire-and-forget) on every metadata read, so it's
 * self-healing and never on the live-draft / generating hot path. Backfilled
 * once for existing tokens; new teams stamp themselves via the post-draft
 * OpenSea metadata refresh that hits the metadata route.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirestoreConfigured } from './firebaseAdmin';

export type IndexLevel = 'jackpot' | 'hof' | 'pro';

/** Normalize any level string (card 'Hall of Fame'/'Jackpot'/'Pro', trait, etc.) to the filter key. */
export function normalizeLevel(raw: string | null | undefined): IndexLevel {
  const v = String(raw ?? '').toLowerCase();
  if (v.includes('jackpot')) return 'jackpot';
  if (v.includes('hall of fame') || v === 'hof') return 'hof';
  return 'pro';
}

export interface MarketplaceIndexEntry {
  level: IndexLevel;
  leagueNumber?: number | null;
  status: 'team' | 'pass';
}

/**
 * Upsert the index for one on-chain token id. Best-effort — NEVER throws, so a
 * caller can `void` it without adding latency or risk to the metadata response.
 */
export async function upsertMarketplaceIndex(tokenId: string, entry: MarketplaceIndexEntry): Promise<void> {
  if (!isFirestoreConfigured()) return;
  const id = String(tokenId).trim();
  if (!/^\d+$/.test(id)) return; // index is keyed by numeric on-chain id only
  try {
    await getAdminFirestore().collection('marketplace_index').doc(id).set(
      {
        tokenId: id,
        level: entry.level,
        leagueNumber: entry.leagueNumber ?? null,
        status: entry.status,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    /* best-effort index — the next metadata read re-stamps it */
  }
}
