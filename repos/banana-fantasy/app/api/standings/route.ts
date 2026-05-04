import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_DRAFTS_API_URL || '';

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch {
    // ignore
  }
  try {
    return await res.text() || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/standings
 *
 * Query params:
 *   wallet   — owner wallet address (required)
 *   gameweek — e.g. "2025REG-01" (defaults to current)
 *   orderBy  — "scoreSeason" | "scoreWeek" (default: scoreSeason)
 *   level    — "all" | "Pro" | "HOF" | "Jackpot" (default: all)
 *
 * Proxies to:
 *   GET /league/all/{ownerId}/draftTokenLeaderboard/gameweek/{gw}/orderBy/{orderBy}/level/{level}
 *
 * If draftId param is present, proxies to the league-specific endpoint instead:
 *   GET /league/{ownerId}/drafts/{draftId}/leaderboard/{orderBy}/gameweek/{gw}
 *
 * If action=gameweek, returns current gameweek:
 *   GET /league/getGameweek
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!API_BASE) {
      return jsonError('Standings API not configured', 503);
    }

    const action = getSearchParam(req, 'action');

    // Action: get current gameweek
    if (action === 'gameweek') {
      const url = `${API_BASE}/league/getGameweek`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const msg = await readErrorMessage(res);
        return jsonError(msg || 'Failed to fetch gameweek', res.status);
      }
      const data = await res.json().catch(() => null);
      return json(data, 200);
    }

    const wallet = getSearchParam(req, 'wallet');
    if (!wallet) {
      return jsonError('Missing wallet parameter', 400);
    }

    const gameweek = getSearchParam(req, 'gameweek') || '2025REG-01';
    const orderBy = getSearchParam(req, 'orderBy') || 'scoreSeason';
    const draftId = getSearchParam(req, 'draftId');

    // League-specific leaderboard
    if (draftId) {
      const url = `${API_BASE}/league/${wallet}/drafts/${draftId}/leaderboard/${orderBy}/gameweek/${gameweek}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const msg = await readErrorMessage(res);
        return jsonError(msg || 'Failed to fetch league standings', res.status);
      }
      const data = await res.json().catch(() => null);
      return json(data, 200);
    }

    // My teams / all leagues leaderboard
    const level = getSearchParam(req, 'level') || 'all';
    const url = `${API_BASE}/league/all/${wallet}/draftTokenLeaderboard/gameweek/${gameweek}/orderBy/${orderBy}/level/${level}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const msg = await readErrorMessage(res);
      return jsonError(msg || 'Failed to fetch standings', res.status);
    }
    const data = await res.json().catch(() => null);
    return json(data, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Standings fetch failed:', err);
    return jsonError('Failed to fetch standings', 500);
  }
}
