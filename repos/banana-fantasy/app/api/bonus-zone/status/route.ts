import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bonus-zone/status?wallet=0x…[&passes=1]
 *
 * BONUS ZONE per-wallet state for the entry modal, My Drafts rows and the
 * leave dialogs: the live tier (what the pill shows), this wallet's locks on
 * lobbies still filling, the half banked in the current window, all-time
 * earned, and (with passes=1) how many of the wallet's unused paid passes are
 * eligible — so the entry modal can say "2 of your 5 paid passes earn Bonus
 * Zone; older ones get used first" before the seat is taken.
 *
 * Ships dark: while the switch is off this returns { enabled:false } and
 * nothing else, so no surface can render the feature early.
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  try {
    const wallet = (getSearchParam(req, 'wallet') ?? '').toLowerCase();
    const includePasses = getSearchParam(req, 'passes') === '1';
    const { readBonusZoneConfig, getBonusZoneWalletStatus, readBonusZoneView } = await import('@/lib/bonusZone');
    const cfg = await readBonusZoneConfig();
    if (!cfg.enabled) return json({ enabled: false }, 200);
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
      const view = await readBonusZoneView();
      return json({ enabled: true, view }, 200);
    }
    const st = await getBonusZoneWalletStatus(wallet, { includePasses });
    return json({ enabled: true, ...st }, 200);
  } catch (err) {
    logger.warn('bonus_zone.status_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
