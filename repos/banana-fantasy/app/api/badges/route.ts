import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getUserBadges, unlockBadge, computeAndStoreRipeness, countPaidDraftsDone } from '@/lib/db';
import { BADGE_CATALOG } from '@/lib/badges/catalog';
import { awardClubBadges, awardOgIfReturning, awardChampionBadges } from '@/lib/badges/awards';
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
  passType?: string; // 'paid' | 'free' — drives banana ripeness
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
 *
 * Returns a small diagnostic object so debug=1 callers can see what
 * happened.
 */
async function maybeRunSweep(userId: string, force = false): Promise<{
  ran: boolean;
  reason?: string;
  goApiStatus?: number;
  joined?: number;
  completed?: number;
  awards?: string[];
}> {
  const db = getAdminFirestore();
  const userRef = db.collection('v2_users').doc(userId);
  const snap = await userRef.get();
  const data = snap.exists ? (snap.data() as User & { lastBadgeSweepAt?: string }) : null;
  const last = data?.lastBadgeSweepAt ? Date.parse(data.lastBadgeSweepAt) : 0;
  if (!force && Number.isFinite(last) && last > 0 && Date.now() - last < SWEEP_THROTTLE_MS) {
    return { ran: false, reason: 'throttled' };
  }

  await userRef.set({ lastBadgeSweepAt: new Date().toISOString() }, { merge: true });

  // OG + champions don't depend on the Go API, so compute them first — they
  // still update even if the Go API is unreachable.
  const awards: string[] = [];
  if (await awardOgIfReturning(userId)) awards.push('og');
  awards.push(...await awardChampionBadges(userId));

  try {
    const url = `${getServerDraftsApiUrl()}/owner/${encodeURIComponent(userId)}/draftToken/all`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ran: true, reason: 'go-api-not-ok', goApiStatus: res.status, awards };
    const body = await res.json() as { active?: RawApiToken[]; available?: RawApiToken[] };
    const active = body.active ?? [];
    const joined = active.filter(t => (t._leagueId || t.leagueId)).length;
    const leagues = active
      .filter(t => (t._leagueId || t.leagueId))
      .map(t => mapDraftTokenToLeague(normalizeToken(t)));
    const completedCount = leagues.filter(l => l.status === 'completed').length;

    // Banana ripeness — PAID drafts the user has DONE (draft_entered, passType
    // paid). Unlocks earned tier badges (fires bell/toast on a new tier) +
    // stores the current tier.
    await computeAndStoreRipeness(userId, await countPaidDraftsDone(userId));

    // Clubs — entering a Jackpot/HOF draft (resolved league type) earns the
    // matching club badge.
    awards.push(...await awardClubBadges(userId, leagues));

    // Club catch-up for jackpot/HOF wheel winners — the wheel route also
    // fires these inline; this re-checks for spins from before the badge
    // system shipped. Query the top-level wheelSpins collection.
    try {
      const spinsSnap = await db
        .collection('wheelSpins')
        .where('userId', '==', userId)
        .limit(50)
        .get();
      for (const doc of spinsSnap.docs) {
        const spin = doc.data();
        const prizeType = spin?.prize?.type;
        const prizeValue = spin?.prize?.value;
        if (prizeType === 'custom' && prizeValue === 'jackpot') {
          if (await unlockBadge(userId, 'jackpot-club', { source: 'wheel', spinId: doc.id })) awards.push('jackpot-club');
        } else if (prizeType === 'custom' && prizeValue === 'hof') {
          if (await unlockBadge(userId, 'hof-club', { source: 'wheel', spinId: doc.id })) awards.push('hof-club');
        }
      }
    } catch (err) {
      logger.warn('badges.read.wheel-sweep.failed', { userId, err });
    }

    return { ran: true, joined, completed: completedCount, awards };
  } catch (err) {
    logger.warn('badges.read.sweep.failed', { userId, err });
    return { ran: true, reason: err instanceof Error ? err.message : String(err), awards };
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
      return json({ catalog: BADGE_CATALOG, unlocked: [], equipped: null, ripeness: null }, 200);
    }

    const lower = userId.toLowerCase();
    const debug = req.url.includes('debug=1');
    const force = req.url.includes('force=1');
    // Run the sweep BEFORE reading. Throttled per-user, so this is cheap
    // when called on every page render. Awards new badges based on the
    // user's Go-API league portfolio (1/20/100 draft tiers, league
    // winners, made-playoffs). Idempotent.
    const sweep = await maybeRunSweep(lower, force);

    const [badges, userSnap] = await Promise.all([
      getUserBadges(lower),
      getAdminFirestore().collection('v2_users').doc(lower).get(),
    ]);
    const user = userSnap.exists ? (userSnap.data() as User) : null;

    // Ripeness is normally written by the sweep above. If it's missing (sweep
    // was throttled and the user has never swept), compute it now from the
    // wallet's paid-pass count so the banana always has a tier.
    const ripeness = user?.ripeness
      ?? await computeAndStoreRipeness(lower, await countPaidDraftsDone(lower).catch(() => 0));

    return json({
      catalog: BADGE_CATALOG,
      unlocked: badges.filter(b => b.unlocked).map(b => ({
        id: b.id,
        unlockedAt: b.unlockedAt ?? null,
      })),
      equipped: user?.equippedBadge ?? null,
      ripeness,
      ...(debug ? { sweep } : {}),
    }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
