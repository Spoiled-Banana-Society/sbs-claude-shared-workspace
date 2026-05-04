import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_DRAFTS_API_URL
  || process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

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
    return jsonError('Failed to fetch draft data', 500);
  }
}
