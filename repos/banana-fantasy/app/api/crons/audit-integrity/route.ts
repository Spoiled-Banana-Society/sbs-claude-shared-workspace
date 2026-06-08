import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { jsonError, json } from '@/lib/api/routeUtils';
import { logErrorEvent } from '@/lib/errorEvents';
import { runAllAudits } from '@/lib/audits/checks';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Daily state-integrity audit. Runs the money/fairness invariant checks
 * (lib/audits/checks.ts) and writes every finding into v2_error_events, so
 * silent data drift surfaces in the admin Logs feed BEFORE a user trips on it —
 * the proactive complement to the reactive event logging.
 *
 * Schedule: vercel.json (daily). Auth: Vercel Cron sends Bearer ${CRON_SECRET}.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return jsonError('Unauthorized', 401);
  }

  try {
    const db = getAdminFirestore();
    const { findings, summary } = await runAllAudits(db);
    for (const f of findings) {
      await logErrorEvent({
        source: f.source,
        route: '/api/crons/audit-integrity',
        message: f.message,
        actor: f.actor,
        context: f.context,
      });
    }
    logger.info('cron.audit_integrity.done', { ...summary });
    return json({ ok: true, ...summary });
  } catch (err) {
    logger.error('cron.audit_integrity.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
