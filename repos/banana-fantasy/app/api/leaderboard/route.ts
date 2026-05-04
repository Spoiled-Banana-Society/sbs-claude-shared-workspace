import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { mockLeaderboard } from '@/lib/mock/leaderboard';

const API_BASE = process.env.NEXT_PUBLIC_DRAFTS_API_URL || '';

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch {
    // ignore JSON parsing errors
  }
  try {
    const text = await res.text();
    return text ? text : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const gameweek = getSearchParam(req, 'gameweek') || '2025REG-01';
    const orderBy = getSearchParam(req, 'orderBy') || 'SeasonScore';
    const level = getSearchParam(req, 'level') || 'all';
    const limit = getSearchParam(req, 'limit') || '100';

    if (!API_BASE) {
      // Fallback to mock if no API configured
      return json(mockLeaderboard, 200);
    }

    const url = `${API_BASE}/league/leaderboard/global/gameweek/${gameweek}/orderBy/${orderBy}/level/${level}?limit=${limit}`;
    const res = await fetch(url, { next: { revalidate: 60 } });

    if (!res.ok) {
      const message = await readErrorMessage(res);
      console.error(`Leaderboard API error: ${res.status}`, message);
      return jsonError(message || 'Leaderboard service error', res.status);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return jsonError('Invalid leaderboard response from backend', 502);
    }
    return json(data, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Leaderboard fetch failed:', err);
    return jsonError('Failed to fetch leaderboard', 500);
  }
}
