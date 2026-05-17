import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

interface FeedDraft {
  draftId: string;
  draftNumber: number;
  level: 'Jackpot' | 'Hall of Fame' | 'Pro' | null;
  displayName: string;
  speed: 'fast' | 'slow';
  filledAt: string | null; // ISO timestamp from StartDate; null if unknown
}

interface RoundSummary {
  roundNumber: number;
  status: string;
  merkleRoot: string | null;
  merkleRootTxHash: string | null;
  commitTxHashVrf: string | null;
}

const FEED_LIMIT = 50;
const SPEEDS = ['fast', 'slow'] as const;

/**
 * GET /api/drafts/proof-feed
 *
 * Public feed of the most recently filled leagues with their draft type +
 * a link to the per-draft proof. Mirrors /api/wheel/feed in shape.
 *
 * Returns the current merkle round's on-chain commit info alongside so
 * the page can render a single "this is the proof" header.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) {
      return json({ drafts: [], round: null });
    }
    const db = getAdminFirestore();

    const trackerSnap = await db.collection('drafts').doc('draftTracker').get();
    const filled = Number(
      (trackerSnap.data() as { FilledLeaguesCount?: number } | undefined)?.FilledLeaguesCount ?? 0,
    );
    const earliestMerkleDraft = await getEarliestMerkleDraftNumber(db);
    if (filled <= 0 || earliestMerkleDraft === null) {
      return json({ drafts: [], round: await loadRound(db) });
    }

    // Probe the last FEED_LIMIT league numbers across both speeds AND a
    // handful of recent year prefixes. We can't reliably orderBy __name__
    // desc on the `drafts` collection (needs a descending single-field
    // index that isn't worth creating just for this), and the season
    // year can change mid-feed when a season transitions. Trying 3 years
    // back covers any realistic transition window.
    const currentYear = new Date().getUTCFullYear();
    const yearPrefixes = [currentYear, currentYear - 1, currentYear - 2].map(String);

    // Iterate slot numbers (not global league numbers) because the doc
    // ID encodes the slot. Slot/global offset varies — we've seen +/-1
    // already in staging because slow drafts pad the global counter
    // without bumping fast slot. Scan a buffer past the merkle cutoff
    // and filter using the doc's DisplayName below (the source of truth
    // for global league number). Scan range capped at FEED_LIMIT * 2
    // so a large offset doesn't pull pre-merkle docs in.
    const SLOT_BUFFER = 20;
    const candidates: Array<{ draftId: string; draftNumber: number; speed: 'fast' | 'slow' }> = [];
    for (let i = 0; i < FEED_LIMIT * 2; i++) {
      const num = filled - i;
      if (num < Math.max(1, earliestMerkleDraft - SLOT_BUFFER)) break;
      for (const speed of SPEEDS) {
        for (const year of yearPrefixes) {
          candidates.push({ draftId: `${year}-${speed}-draft-${num}`, draftNumber: num, speed });
        }
      }
    }

    const snaps = await Promise.all(
      candidates.map((c) => db.collection('drafts').doc(c.draftId).get().catch(() => null)),
    );

    // Source of truth for the global league number is DisplayName
    // ("BBB #N"), NOT the slot id (per-speed-per-year counter that
    // desyncs from the global FilledLeaguesCount over time). Dedupe by
    // the parsed global number so feed entries don't double-show when
    // the same league shows up under multiple year-prefix candidates.
    const seen = new Set<number>();
    const drafts: FeedDraft[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const snap = snaps[i];
      if (!snap?.exists) continue;
      const data = snap.data() as { Level?: string; DisplayName?: string; StartDate?: unknown } | undefined;
      const dn = data?.DisplayName ?? '';
      const m = /^BBB\s*#(\d+)$/i.exec(dn);
      const globalNumber = m ? Number(m[1]) : c.draftNumber;
      // Pre-merkle drafts used commit-reveal — they don't belong here.
      if (globalNumber < earliestMerkleDraft) continue;
      if (seen.has(globalNumber)) continue;
      seen.add(globalNumber);
      drafts.push({
        draftId: String(globalNumber), // proof URL = /proof/{globalNum}
        draftNumber: globalNumber,
        level: normalizeLevel(data?.Level),
        displayName: dn || `BBB #${globalNumber}`,
        speed: c.speed,
        filledAt: toIsoTimestamp(data?.StartDate),
      });
    }

    drafts.sort((a, b) => b.draftNumber - a.draftNumber);
    if (drafts.length > FEED_LIMIT) drafts.length = FEED_LIMIT;

    return json({ drafts, round: await loadRound(db) });
  } catch (err) {
    logger.error('drafts.proof_feed.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}

/**
 * Normalize the various StartDate shapes Firestore returns:
 *   - Timestamp (admin SDK)         → .toDate().toISOString()
 *   - number (unix ms or sec)       → convert
 *   - ISO string                    → pass through
 *   - anything else                 → null
 */
function toIsoTimestamp(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && raw !== null && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    } catch { return null; }
  }
  if (typeof raw === 'number') {
    // Heuristic: 10-digit = seconds, 13-digit = ms.
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

function normalizeLevel(raw: string | undefined): FeedDraft['level'] {
  if (!raw) return 'Pro';
  const v = raw.toLowerCase();
  if (v.includes('jackpot')) return 'Jackpot';
  if (v.includes('hall of fame') || v === 'hof') return 'Hall of Fame';
  return 'Pro';
}

/**
 * Earliest league number that's part of a merkle round. Drafts below
 * this cutoff used the old commit-reveal system (different on-chain
 * commit + no per-draft Merkle proof), so surfacing them in a feed
 * branded as "Chainlink VRF + on-chain Merkle root" would be misleading.
 *
 * Computed from the lowest merkle round's firstBatchNumber:
 *   firstMerkleDraft = (firstBatchNumber - 1) * 100 + 1
 *
 * Returns null when no merkle round has opened yet.
 */
async function getEarliestMerkleDraftNumber(db: FirebaseFirestore.Firestore): Promise<number | null> {
  try {
    const snap = await db
      .collection('merkle_rounds')
      .orderBy('roundNumber', 'asc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data() as { firstBatchNumber?: number };
    if (!data.firstBatchNumber) return null;
    return (data.firstBatchNumber - 1) * 100 + 1;
  } catch {
    return null;
  }
}

async function loadRound(db: FirebaseFirestore.Firestore): Promise<RoundSummary | null> {
  try {
    const stateSnap = await db.collection('system_config').doc('merkleRoundState').get();
    if (!stateSnap.exists) return null;
    const state = stateSnap.data() as { currentRoundNumber?: number } | undefined;
    if (!state?.currentRoundNumber) return null;
    const roundSnap = await db.collection('merkle_rounds').doc(String(state.currentRoundNumber)).get();
    if (!roundSnap.exists) return null;
    const data = roundSnap.data() as {
      roundNumber?: number;
      status?: string;
      merkleRoot?: string;
      merkleRootTxHash?: string;
      commitTxHashVrf?: string;
    } | undefined;
    if (!data) return null;
    return {
      roundNumber: data.roundNumber ?? state.currentRoundNumber,
      status: data.status ?? 'unknown',
      merkleRoot: data.merkleRoot ?? null,
      merkleRootTxHash: data.merkleRootTxHash ?? null,
      commitTxHashVrf: data.commitTxHashVrf ?? null,
    };
  } catch {
    return null;
  }
}
