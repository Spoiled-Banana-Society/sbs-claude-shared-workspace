import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { awardClubBadges, awardOgIfReturning, awardChampionBadges } from '@/lib/badges/awards';
import { computeAndStoreRipeness } from '@/lib/db';
import { mapDraftTokenToLeague, type ApiDraftToken } from '@/lib/api/owner';
import { logger } from '@/lib/logger';

const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

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

async function fetchOwnerLeagues(wallet: string) {
  const url = `${getServerDraftsApiUrl()}/owner/${encodeURIComponent(wallet)}/draftToken/all`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new ApiError(502, `Go API ${res.status}`);
  const data = await res.json() as { active?: RawApiToken[] };
  const active = data.active ?? [];
  return active
    .filter(t => (t._leagueId || t.leagueId)) // must be in a league
    .map(t => mapDraftTokenToLeague(normalizeToken(t)));
}

/**
 * POST /api/admin/badges/run-week14-sweep
 * Body: { userId }
 *
 * Admin-only "re-sweep this user" tool. Recomputes the wallet's ripeness
 * tier and awards any earned badges in the new system: Clubs (entered a
 * Jackpot/HOF draft), OG (returning player), and Champions (winner
 * snapshot). Idempotent. Champion snapshots are empty until provided, so
 * those stay admin-grant-only for now.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();

    const leagues = await fetchOwnerLeagues(userId);
    const completed = leagues.filter(l => l.status === 'completed');

    const ripeness = await computeAndStoreRipeness(userId);
    const awards: string[] = [];
    awards.push(...await awardClubBadges(userId, leagues));
    if (await awardOgIfReturning(userId)) awards.push('og');
    awards.push(...await awardChampionBadges(userId));

    return json({
      ok: true,
      userId,
      leagueCount: leagues.length,
      completedCount: completed.length,
      ripeness,
      awards,
    }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.badges.sweep.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
