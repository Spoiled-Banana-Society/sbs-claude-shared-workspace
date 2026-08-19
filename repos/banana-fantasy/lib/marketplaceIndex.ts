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
import { currentMaxTokenId, isRealToken } from './onchain/contractSupply';

export type IndexLevel = 'jackpot' | 'hof' | 'pro';

/** Normalize any level string (card 'Hall of Fame'/'Jackpot'/'Pro', trait, etc.) to the filter key. */
export function normalizeLevel(raw: string | null | undefined): IndexLevel {
  const v = String(raw ?? '').toLowerCase();
  // JackHOF (dual-type) buckets under 'jackpot' for marketplace filtering —
  // it's the rarest identity and the filter set has no dedicated key yet.
  // Without this it would fall through to 'pro' ('jackhof' matches neither
  // 'jackpot' nor 'hall of fame' nor === 'hof').
  if (v.includes('jackhof')) return 'jackpot';
  if (v.includes('jackpot')) return 'jackpot';
  if (v.includes('hall of fame') || v === 'hof') return 'hof';
  return 'pro';
}

/** Self-contained per-player draft data — everything needed to regenerate the
 *  card with NO dependency on the (ephemeral) Go draft summary. `pick` is the
 *  irreplaceable, draft-specific bit; team/pos/bye/adp let us rebuild fully. */
export interface IndexPlayer {
  team: string;
  pos: string;
  pick?: number | string;
  bye?: number | string;
  adp?: number | string;
  playerId?: string;
}

/** Canonical Go level label. The index `level` key BUCKETS JackHOF under
 *  'jackpot' for the marketplace filter, which loses the dual identity — so
 *  card rebuilds read `levelRaw` first. Added 2026-08-19 after JackHOF #30's
 *  teams rendered as HOF (link-wheel-teams stamped 'Hall of Fame' for a
 *  jackhof round, and every rebuild trusted that index level). */
export type LevelLabel = 'Jackpot' | 'Hall of Fame' | 'JackHOF' | 'Pro';

export function levelLabel(raw: string | null | undefined): LevelLabel {
  const v = String(raw ?? '').toLowerCase();
  if (v.includes('jackhof')) return 'JackHOF';
  if (v.includes('jackpot')) return 'Jackpot';
  if (v.includes('hall of fame') || v === 'hof') return 'Hall of Fame';
  return 'Pro';
}

/** Level label for an index doc: `levelRaw` when stamped, else the bucket. */
export function levelLabelFromIndex(d: { level?: unknown; levelRaw?: unknown } | null | undefined): LevelLabel | null {
  if (!d) return null;
  if (typeof d.levelRaw === 'string' && d.levelRaw) return levelLabel(d.levelRaw);
  if (typeof d.level === 'string' && d.level) return levelLabel(d.level);
  return null;
}

export interface MarketplaceIndexEntry {
  level: IndexLevel;
  /** Canonical label ('JackHOF' keeps the dual identity the bucket drops). */
  levelRaw?: LevelLabel | string | null;
  leagueNumber?: number | null;
  status: 'team' | 'pass';
  /** Display bits so the marketplace can render a team straight from the index
   *  (price/owner overlaid from OpenSea at read time). */
  image?: string | null;
  roster?: string[];
  /** Full structured pick list — the durable source of truth in OUR Firestore,
   *  so picks/ADP/BYE survive even after the Go API drops the draft summary. */
  players?: IndexPlayer[];
}

/**
 * Upsert the index for one on-chain token id. Best-effort — NEVER throws, so a
 * caller can `void` it without adding latency or risk to the metadata response.
 */
export async function upsertMarketplaceIndex(tokenId: string, entry: MarketplaceIndexEntry): Promise<void> {
  if (!isFirestoreConfigured()) return;
  const id = String(tokenId).trim();
  if (!/^\d+$/.test(id)) return; // index is keyed by numeric on-chain id only
  // SOURCE OF TRUTH = live on-chain tokens only. Never index a prior-era / bot
  // "ghost" finalize-doc whose id is above the current contract supply (those
  // were minted on an old contract era, aren't on this contract or OpenSea).
  // Keeps the backend — and therefore the marketplace + OpenSea — to real tokens.
  const maxId = await currentMaxTokenId();
  if (!isRealToken(id, maxId)) return;
  try {
    await getAdminFirestore().collection('marketplace_index').doc(id).set(
      {
        tokenId: id,
        level: entry.level,
        ...(entry.levelRaw ? { levelRaw: levelLabel(entry.levelRaw) } : {}),
        leagueNumber: entry.leagueNumber ?? null,
        status: entry.status,
        image: entry.image ?? null,
        roster: entry.roster ?? [],
        // Only write players when we actually have them (≥10) — never clobber a
        // good stored pick list with an empty one on a partial/pass re-stamp.
        ...(entry.players && entry.players.length >= 10 ? { players: entry.players } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    /* best-effort index — the next metadata read re-stamps it */
  }
}
