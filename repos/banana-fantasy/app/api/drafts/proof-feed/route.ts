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
    if (filled <= 0) {
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

    const candidates: Array<{ draftId: string; draftNumber: number; speed: 'fast' | 'slow' }> = [];
    for (let i = 0; i < FEED_LIMIT; i++) {
      const num = filled - i;
      if (num <= 0) break;
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
      const data = snap.data() as { Level?: string; DisplayName?: string } | undefined;
      const dn = data?.DisplayName ?? '';
      const m = /^BBB\s*#(\d+)$/i.exec(dn);
      const globalNumber = m ? Number(m[1]) : c.draftNumber;
      if (seen.has(globalNumber)) continue;
      seen.add(globalNumber);
      drafts.push({
        draftId: String(globalNumber), // proof URL = /proof/{globalNum}
        draftNumber: globalNumber,
        level: normalizeLevel(data?.Level),
        displayName: dn || `BBB #${globalNumber}`,
        speed: c.speed,
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

function normalizeLevel(raw: string | undefined): FeedDraft['level'] {
  if (!raw) return 'Pro';
  const v = raw.toLowerCase();
  if (v.includes('jackpot')) return 'Jackpot';
  if (v.includes('hall of fame') || v === 'hof') return 'Hall of Fame';
  return 'Pro';
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
