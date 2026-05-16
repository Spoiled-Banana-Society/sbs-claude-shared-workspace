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

    // Resolve the season-year prefix from a recent doc id (matches the
    // pattern "YYYY-{fast|slow}-draft-N").
    const recentSnap = await db
      .collection('drafts')
      .orderBy('__name__', 'desc')
      .limit(20)
      .get()
      .catch(() => null);
    const sampleDraftId = recentSnap?.docs.map((d) => d.id).find((id) => /^\d{4}-(fast|slow)-draft-\d+$/.test(id));
    const yearPrefix = sampleDraftId ? sampleDraftId.split('-')[0] : new Date().getUTCFullYear().toString();

    // Probe the last FEED_LIMIT league numbers across both speeds. We
    // dedupe by league number — fast and slow share the league counter,
    // so only one of (yearPrefix-fast-draft-N, yearPrefix-slow-draft-N)
    // actually exists per N.
    const candidates: Array<{ draftId: string; draftNumber: number; speed: 'fast' | 'slow' }> = [];
    for (let i = 0; i < FEED_LIMIT; i++) {
      const num = filled - i;
      if (num <= 0) break;
      for (const speed of SPEEDS) {
        candidates.push({ draftId: `${yearPrefix}-${speed}-draft-${num}`, draftNumber: num, speed });
      }
    }

    const snaps = await Promise.all(
      candidates.map((c) => db.collection('drafts').doc(c.draftId).get().catch(() => null)),
    );

    const seen = new Set<number>();
    const drafts: FeedDraft[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const snap = snaps[i];
      if (!snap?.exists) continue;
      if (seen.has(c.draftNumber)) continue;
      seen.add(c.draftNumber);
      const data = snap.data() as { Level?: string; DisplayName?: string } | undefined;
      const level = normalizeLevel(data?.Level);
      drafts.push({
        draftId: c.draftId,
        draftNumber: c.draftNumber,
        level,
        displayName: data?.DisplayName ?? c.draftId,
        speed: c.speed,
      });
    }

    drafts.sort((a, b) => b.draftNumber - a.draftNumber);

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
