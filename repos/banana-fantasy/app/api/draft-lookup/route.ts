import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

import { getServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';

export const dynamic = 'force-dynamic';

const API_BASE = getServerDraftsApiUrl();

export async function GET(req: Request) {
  const draftId = getSearchParam(req, 'draftId');
  const type = getSearchParam(req, 'type'); // 'info' or 'summary'

  if (!draftId || !type) {
    return jsonError('Missing draftId or type parameter', 400);
  }

  try {
    const url = `${API_BASE}/draft/${draftId}/state/${type}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return jsonError(`Draft ${type} not found`, res.status);
    }
    const data = await res.json();

    // For summary, unwrap the { summary: [...] } wrapper if present
    if (type === 'summary' && data && !Array.isArray(data) && Array.isArray(data.summary)) {
      return json(data.summary, 200);
    }

    return json(data, 200);
  } catch (err) {
    console.error(`[draft-lookup] Error fetching ${type} for ${draftId}:`, err);
    logger.error('draft.draft_lookup.unhandled', { err, context: { draftId, type } });
    return jsonError('Failed to fetch draft data', 500);
  }
}
