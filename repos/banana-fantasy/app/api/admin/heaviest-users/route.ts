/**
 * Admin heaviest-users aggregator.
 *
 * Top users across three dimensions:
 *   - spend:        sum of pass_purchased totalPrice
 *   - promos:       count of promo_claimed events
 *   - spins:        count of spin_won events
 *
 * Bounded scan of the v2_activity_events stream (most-recent 2000 docs),
 * aggregated per userId. Lifetime as long as the window holds; for
 * older data we'd switch to a write-through aggregate, but the scan
 * is fast enough for SBS's current user base.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

export const dynamic = 'force-dynamic';

const SCAN_LIMIT = 2000;
const TOP_N = 10;

interface UserTotals {
  userId: string;
  username: string | null;
  spendUsd: number;
  passesBought: number;
  promosClaimed: number;
  spinsWon: number;
  lastActivityIso: string;
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();
    const snap = await db
      .collection(ACTIVITY_EVENTS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(SCAN_LIMIT)
      .get();

    const totals = new Map<string, UserTotals>();
    for (const doc of snap.docs) {
      const d = doc.data() as {
        type?: string;
        userId?: string;
        username?: string | null;
        quantity?: number;
        metadata?: Record<string, unknown>;
        createdAtIso?: string;
      };
      const userId = (d.userId ?? '').toLowerCase();
      if (!userId) continue;
      const entry = totals.get(userId) ?? {
        userId,
        username: d.username ?? null,
        spendUsd: 0,
        passesBought: 0,
        promosClaimed: 0,
        spinsWon: 0,
        lastActivityIso: d.createdAtIso ?? '',
      };
      if (d.username && !entry.username) entry.username = d.username;
      if (d.createdAtIso && d.createdAtIso > entry.lastActivityIso) {
        entry.lastActivityIso = d.createdAtIso;
      }
      switch (d.type) {
        case 'pass_purchased': {
          const price = Number(d.metadata?.totalPrice);
          if (Number.isFinite(price)) entry.spendUsd += price;
          entry.passesBought += Number.isFinite(d.quantity) ? Number(d.quantity) : 1;
          break;
        }
        case 'promo_claimed':
          entry.promosClaimed += 1;
          break;
        case 'spin_won':
          entry.spinsWon += 1;
          break;
      }
      totals.set(userId, entry);
    }

    const all = Array.from(totals.values());
    const topSpend = [...all].sort((a, b) => b.spendUsd - a.spendUsd).slice(0, TOP_N);
    const topPromos = [...all].sort((a, b) => b.promosClaimed - a.promosClaimed).slice(0, TOP_N);
    const topSpins = [...all].sort((a, b) => b.spinsWon - a.spinsWon).slice(0, TOP_N);

    logger.info('admin.heaviest_users.ok', {
      requestId,
      context: { scanned: snap.size, uniqueUsers: all.length },
    });

    return json({
      ok: true,
      scannedDocs: snap.size,
      uniqueUsers: all.length,
      topSpend,
      topPromos,
      topSpins,
      requestId,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.heaviest_users.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/heaviest-users',
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
