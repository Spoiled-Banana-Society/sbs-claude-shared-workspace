import { jsonError, json } from '@/lib/api/routeUtils';
import { logErrorEvent } from '@/lib/errorEvents';
import { runEndpointCanaries } from '@/lib/audits/canary';
import { recordCronHeartbeat, checkCronHeartbeats } from '@/lib/cronHeartbeat';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * LIVE endpoint canary. Pokes the critical promo + money routes every few minutes
 * with safe, non-mutating probes and asserts their contracts still hold (promos
 * accept tokenless calls; withdrawals reject them). Catches the silent-regression
 * class — like #12, where promo recording broke for everyone and nothing in the
 * feed showed it for days. Findings go into the SAME admin Logs feed, critical-
 * tiered by `source`, with affected actor + route context for instant root-cause.
 *
 * Schedule: vercel.json (every 5 min). Auth: Vercel Cron sends Bearer ${CRON_SECRET}.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return jsonError('Unauthorized', 401);
  }

  // Probe the live deployment. Prefer an explicit URL, else the Vercel-provided
  // deployment host, else the known staging origin.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'https://banana-fantasy-sbs.vercel.app';

  try {
    // Endpoint contract canaries + the "is any critical cron dark?" check.
    const findings = [
      ...(await runEndpointCanaries(base)),
      ...(await checkCronHeartbeats(Date.now())),
    ];
    for (const f of findings) {
      await logErrorEvent({
        source: f.source,
        route: '/api/crons/health-canary',
        message: f.message,
        actor: f.actor,
        context: f.context,
      });
    }
    // Stamp our own heartbeat AFTER the work, so it only advances on a real run.
    await recordCronHeartbeat('health-canary');
    const critical = findings.filter((f) => f.severity === 'critical').length;
    logger.info('cron.health_canary.done', { base, findings: findings.length, critical });
    return json({ ok: true, base, findings: findings.length, critical });
  } catch (err) {
    logger.error('cron.health_canary.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
