import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  level: string;
  permalink: string;
  status: string;
}

interface SentryIssueRaw {
  id: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  level?: string;
  permalink?: string;
  status?: string;
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    const token = process.env.SENTRY_AUTH_TOKEN;
    const org = process.env.SENTRY_ORG || 'sbs-ti';
    const project = process.env.SENTRY_PROJECT_SLUG || 'javascript-nextjs';

    if (!token) {
      return json({ issues: [], requestId, configured: false });
    }

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 25), 1), 100);
    const statsPeriod = url.searchParams.get('statsPeriod') ?? '24h';

    const apiUrl = `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?statsPeriod=${encodeURIComponent(statsPeriod)}&limit=${limit}&query=is%3Aunresolved`;

    const sentryRes = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!sentryRes.ok) {
      const text = await sentryRes.text().catch(() => '');
      logger.warn('admin.sentry.fetch_failed', { requestId, status: sentryRes.status, body: text.slice(0, 200) });
      return jsonError(`Sentry API ${sentryRes.status}`, 502, { requestId });
    }

    const raw = (await sentryRes.json()) as SentryIssueRaw[];
    // Only surface ACTUAL bugs. Sentry "performance issues" (e.g. the recurring
    // "N+1 API Call" on /admin) come through at `info`/`debug` level — they're
    // diagnostics, not errors, and were the source of the persistent noise.
    // Keep error/warning/fatal (and anything unknown, treated as error).
    const isRealBug = (lvl: string | undefined) => {
      const l = (lvl ?? 'error').toLowerCase();
      return l !== 'info' && l !== 'debug';
    };
    const issues: SentryIssue[] = raw.filter((r) => isRealBug(r.level)).map((r) => ({
      id: r.id,
      shortId: r.shortId ?? r.id,
      title: r.title ?? '(untitled)',
      culprit: r.culprit ?? '',
      count: r.count ?? '0',
      userCount: r.userCount ?? 0,
      firstSeen: r.firstSeen ?? '',
      lastSeen: r.lastSeen ?? '',
      level: r.level ?? 'error',
      permalink: r.permalink ?? '',
      status: r.status ?? 'unresolved',
    }));

    logger.info('admin.sentry.ok', { requestId, count: issues.length, durationMs: Date.now() - start });
    return json({ issues, requestId, configured: true });
  } catch (err) {
    logger.error('admin.sentry.failed', { requestId, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
