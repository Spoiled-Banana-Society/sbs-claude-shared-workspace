import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { mockPrizes } from '@/lib/mock/prizes';

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
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;
  try {
    const draftId = getSearchParam(req, 'draftId');
    if (!draftId) return jsonError('Missing query param: draftId', 400);

    if (!API_BASE) {
      return json(mockPrizes, 200);
    }

    const url = `${API_BASE}/league/${draftId}/prizes`;
    const res = await fetch(url, { next: { revalidate: 60 } });

    if (!res.ok) {
      const message = await readErrorMessage(res);
      console.error(`Prizes API error: ${res.status}`, message);
      return jsonError(message || 'Prizes service error', res.status);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return jsonError('Invalid prizes response from backend', 502);
    }
    return json(data, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Prizes fetch failed:', err);
    return jsonError('Failed to fetch prizes', 500);
  }
}
