import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/debug/crash — Chrome Reporting API endpoint (see the
 * `Reporting-Endpoints` header in next.config.mjs).
 *
 * When a renderer dies ("Aw, Snap!"), the BROWSER posts a report here after
 * the fact. The page's own JS is dead at that moment, so this is the only
 * channel that can ever state the crash reason instead of us inferring it:
 *
 *   [{ type: "crash", age, url, user_agent,
 *      body: { reason: "oom" | "unresponsive" | ..., is_top_level, ... } }]
 *
 * body.reason === "oom" settles the memory question per-crash. Reports carry
 * no cookies or session context, so rows are matched to a user by url + time
 * + user_agent against v2_debug_events (memWatch samples carry the path).
 *
 * Written to v2_debug_events with tag "crash" (same 24h TTL, readable via
 * scripts/inspect-debug-logs.mjs --tag=crash). Content-Type is
 * application/reports+json; some Chrome versions send application/csp-report
 * or plain json — parse permissively, never 4xx a delivery (the browser
 * would back off and drop future reports).
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) return new Response(null, { status: 204 });

    const reports = (await req.json().catch(() => null)) as unknown;
    const list = Array.isArray(reports) ? reports.slice(0, 20) : [];
    // Keep crash + deprecation/intervention noise out: crash only.
    const crashes = list.filter(
      (r): r is { type: string; age?: number; url?: string; user_agent?: string; body?: Record<string, unknown> } =>
        !!r && typeof r === 'object' && (r as { type?: string }).type === 'crash',
    );
    if (crashes.length === 0) return new Response(null, { status: 204 });

    const db = getAdminFirestore();
    const batch = db.batch();
    const now = new Date();
    for (const r of crashes) {
      const ref = db.collection('v2_debug_events').doc();
      batch.set(ref, {
        tag: 'crash',
        event: 'renderer',
        payload: {
          reason: (r.body?.reason as string) ?? 'unknown',
          isTopLevel: r.body?.is_top_level ?? null,
          visibility: r.body?.visibility_state ?? null,
          url: (r.url ?? '').slice(0, 300),
          ua: (r.user_agent ?? '').slice(0, 200),
          // Age = ms between the crash and this delivery; subtract to get
          // the actual moment of death.
          ageMs: typeof r.age === 'number' ? r.age : null,
        },
        sessionId: '',
        wallet: '',
        clientTs: typeof r.age === 'number' ? now.getTime() - r.age : now.getTime(),
        serverTs: now.toISOString(),
        path: (() => { try { return new URL(r.url ?? '').pathname.slice(0, 256); } catch { return ''; } })(),
        ua: (r.user_agent ?? req.headers.get('user-agent') ?? '').slice(0, 200),
      });
    }
    await batch.commit();
    logger.info('debug.crash_report', { count: crashes.length });
    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error('debug.crash_report_failed', err);
    // Never error a Reporting API delivery — Chrome backs off on failures.
    return new Response(null, { status: 204 });
  }
}
