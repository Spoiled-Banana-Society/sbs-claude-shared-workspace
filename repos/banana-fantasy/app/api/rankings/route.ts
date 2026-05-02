import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { json, jsonError } from '@/lib/api/routeUtils';
import { mockTeamPositions } from '@/lib/mock/teamPositions';

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
    if (!API_BASE) {
      return json(mockTeamPositions, 200);
    }

    const url = `${API_BASE}/league/rankings/global`;
    const res = await fetch(url, { next: { revalidate: 300 } });

    if (!res.ok) {
      const message = await readErrorMessage(res);
      logger.error('rankings.backend_error', { status: res.status, message });
      return jsonError(message || 'Rankings service error', res.status);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return jsonError('Invalid rankings response from backend', 502);
    }
    return json(data, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('rankings.fetch_failed', { err });
    return jsonError('Failed to fetch rankings', 500);
  }
}
