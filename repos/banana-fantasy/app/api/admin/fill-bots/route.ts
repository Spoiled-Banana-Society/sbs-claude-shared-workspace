import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';

// Admin proxy for the Go API's /staging/fill-bots endpoint. The Go side
// is now gated behind an X-Admin-Key header (DRAFTS_API_ADMIN_KEY env)
// so this route adds it server-side after verifying the caller is an
// admin via Privy.
//
// POST /api/admin/fill-bots  body: { leagueId, speed?: 'fast'|'slow', count?: number }

const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

function getApiUrl(): string {
  return (process.env.STAGING_DRAFTS_API_URL || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    const body = await parseBody(req);
    const leagueId = requireString(body.leagueId, 'leagueId');
    const speed: 'fast' | 'slow' = body.speed === 'slow' ? 'slow' : 'fast';
    const rawCount = Number(body.count ?? 10);
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(10, Math.floor(rawCount))) : 10;

    const adminKey = process.env.DRAFTS_API_ADMIN_KEY || '';
    if (!adminKey) {
      throw new ApiError(503, 'DRAFTS_API_ADMIN_KEY not configured on this deploy');
    }

    const url = `${getApiUrl()}/staging/fill-bots/${speed}?count=${count}&leagueId=${encodeURIComponent(leagueId)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Admin-Key': adminKey, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      logger.warn('admin.fill-bots.upstream_fail', { status: res.status, body: text });
      throw new ApiError(res.status, `Go API ${res.status}: ${text || 'no body'}`);
    }

    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return json({ ok: true, leagueId, speed, count, upstream: parsed }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.fill-bots.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
