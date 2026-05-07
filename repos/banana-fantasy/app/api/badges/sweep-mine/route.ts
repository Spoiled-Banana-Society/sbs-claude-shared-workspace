import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser, linkedWalletsOf } from '@/lib/privyServer';
import { awardDraftCountBadges, awardLeagueOutcomeBadges } from '@/lib/badges/awards';
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

/**
 * POST /api/badges/sweep-mine
 *
 * Privy-authed. Re-evaluates the caller's badges based on their current
 * Go-API league portfolio and awards: draft-count tiers, league-winner,
 * made-playoffs. Idempotent. Frontend fires this on draft completion +
 * any time the user lands on /profile so unlocks are eventual-consistent
 * even if a single trigger fails.
 *
 * Doesn't award beat-founder, finals/champion (those need admin or
 * special data paths beyond the Go API league list).
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const user = await getPrivyUser(req);
    let wallet = user.walletAddress;
    if (!wallet) {
      const privyUser = await fetchPrivyUser(user.userId);
      const linked = privyUser ? linkedWalletsOf(privyUser) : [];
      wallet = linked[0] || null;
    }
    if (!wallet) throw new ApiError(401, 'No wallet linked to this account');
    const userId = wallet.toLowerCase();

    const url = `${getServerDraftsApiUrl()}/owner/${encodeURIComponent(userId)}/draftToken/all`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new ApiError(502, `Go API ${res.status}`);
    const data = await res.json() as { active?: RawApiToken[] };
    const active = data.active ?? [];
    const leagues = active
      .filter(t => (t._leagueId || t.leagueId))
      .map(t => mapDraftTokenToLeague(normalizeToken(t)));

    const completed = leagues.filter(l => l.status === 'completed');
    await awardDraftCountBadges(userId, completed.length);
    const { awards } = await awardLeagueOutcomeBadges(userId, leagues);

    return json({ ok: true, completedCount: completed.length, awards }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('badges.sweep-mine.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
