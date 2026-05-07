import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getUserBadges } from '@/lib/db';
import { BADGE_CATALOG } from '@/lib/badges/catalog';
import { awardDraftCountBadges, awardLeagueOutcomeBadges } from '@/lib/badges/awards';
import { mapDraftTokenToLeague, type ApiDraftToken } from '@/lib/api/owner';
import type { User } from '@/types';
import { logger } from '@/lib/logger';

const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const SWEEP_THROTTLE_MS = 30_000;

function getServerDraftsApiUrl(): string {
  return (process.env.STAGING_DRAFTS_API_URL || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

interface RawApiToken {
  _cardId?: string;
  _leagueId?: string;
  _leagueDisplayName?: string;
  _level?: 'Pro' | 'Jackpot' | 'Hall of Fame';
  _rank?: string;
  _seasonScore?: string;
  _weekScore?: string;
  roster?: ApiDraftToken['roster'];
  prizes?: { USDC?: number };
  cardId?: string;
  leagueId?: string;
}

function normalizeToken(t: RawApiToken): ApiDraftToken {
  return {
    cardId: String(t._cardId ?? t.cardId ?? ''),
    leagueId: String(t._leagueId ?? t.leagueId ?? ''),
    leagueDisplayName: t._leagueDisplayName,
    roster: t.roster,
    level: (t._level as ApiDraftToken['level']) ?? 'Pro',
    rank: t._rank,
    seasonScore: t._seasonScore,
    weekScore: t._weekScore,
    prizes: t.prizes,
  };
}

/**
 * Run the badge sweep for a user inline on read. Throttled to 1/30s per
 * user via a `lastBadgeSweepAt` field on the user doc — concurrent reads
 * across tabs / devices share the same throttle so we don't spam the Go
 * API or Firestore. Idempotent on the unlock side.
 */
async function maybeRunSweep(userId: string): Promise<void> {
  const db = getAdminFirestore();
  const userRef = db.collection('v2_users').doc(userId);
  const snap = await userRef.get();
  const data = snap.exists ? (snap.data() as User & { lastBadgeSweepAt?: string }) : null;
  const last = data?.lastBadgeSweepAt ? Date.parse(data.lastBadgeSweepAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < SWEEP_THROTTLE_MS) return;

  // Optimistically claim the throttle slot before doing the work, so
  // parallel reads bail.
  await userRef.set({ lastBadgeSweepAt: new Date().toISOString() }, { merge: true });

  try {
    const url = `${getServerDraftsApiUrl()}/owner/${encodeURIComponent(userId)}/draftToken/all`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json() as { active?: RawApiToken[] };
    const active = body.active ?? [];
    const leagues = active
      .filter(t => (t._leagueId || t.leagueId))
      .map(t => mapDraftTokenToLeague(normalizeToken(t)));
    const completedCount = leagues.filter(l => l.status === 'completed').length;
    await awardDraftCountBadges(userId, completedCount);
    await awardLeagueOutcomeBadges(userId, leagues);
  } catch (err) {
    logger.warn('badges.read.sweep.failed', { userId, err });
  }
}

/**
 * GET /api/badges?userId=X
 *
 * Public read. Returns the full catalog (so the client can render every
 * badge — locked greyed, unlocked colored), the user's unlock states,
 * and the equipped badge id. If userId isn't passed, returns just the
 * catalog (for logged-out catalog previews).
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const userId = getSearchParam(req, 'userId');
    if (!userId) {
      return json({ catalog: BADGE_CATALOG, unlocked: [], equipped: null }, 200);
    }

    const lower = userId.toLowerCase();
    // Run the sweep BEFORE reading. Throttled per-user, so this is cheap
    // when called on every page render. Awards new badges based on the
    // user's Go-API league portfolio (1/20/100 draft tiers, league
    // winners, made-playoffs). Idempotent.
    await maybeRunSweep(lower);

    const [badges, userSnap] = await Promise.all([
      getUserBadges(lower),
      getAdminFirestore().collection('v2_users').doc(lower).get(),
    ]);
    const user = userSnap.exists ? (userSnap.data() as User) : null;

    return json({
      catalog: BADGE_CATALOG,
      unlocked: badges.filter(b => b.unlocked).map(b => ({
        id: b.id,
        unlockedAt: b.unlockedAt ?? null,
      })),
      equipped: user?.equippedBadge ?? null,
    }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
