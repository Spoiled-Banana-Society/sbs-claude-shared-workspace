import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getDropState } from '@/lib/drop';
import { runDropSchedule } from '@/lib/dropRun';
import { nightFromId, revealNightIdFor } from '@/lib/dropMath';
import { logger } from '@/lib/logger';

/**
 * GET /api/promos/drop — public state for THE DROP.
 *
 * Auth-free so the pack count and tonight's odds render for everyone; `?wallet=`
 * adds that wallet's own sealed/opened counts. Nothing here identifies a user
 * beyond the wallet already public in every draft lobby.
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  const wallet = new URL(req.url).searchParams.get('wallet') ?? undefined;
  try {
    const now = Date.now();

    // Lock ON THE DOT. The cron only ticks every 2 minutes, so left to itself
    // the 8pm reveal could land at 8:01:59 — people staring at a finished
    // countdown that still says LOCKED. Whoever loads the page first once 8pm
    // has passed triggers the lock themselves; runDropSchedule is a no-op
    // until due and idempotent after (the status flip is transactional), so
    // concurrent loads can't double-assign. Same client-trigger pattern that
    // got the Eliminator's burn from 58s late to 0.6s (Richard, 2026-07-31).
    const reveal = nightFromId(revealNightIdFor(now));
    if (now >= reveal.locksAt) {
      await runDropSchedule(now).catch((err) => {
        logger.warn('drop.selfheal_failed', { err: (err as Error).message });
      });
    }

    // Cost audit 9/3: the PUBLIC (no-wallet) state is identical for every
    // viewer — share one answer at the edge for 30s. Per-wallet responses
    // stay uncached so pack counts are always fresh right after opening.
    return json(await getDropState(wallet || undefined, now), wallet ? undefined : {
      headers: { 'cache-control': 'public, max-age=10, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    logger.error('drop.state_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
