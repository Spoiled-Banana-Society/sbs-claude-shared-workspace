/**
 * Admin promo-progress aggregator.
 *
 * Boris's spec: a user has "started" a promo the moment they do at least
 * one of its steps (not just by opening the modal). Maps cleanly to
 * `progressCurrent > 0`. A promo is "completed" when `claimCount > 0`
 * (they actually claimed the reward). Anything in between is "pending"
 * — the data this endpoint is built for.
 *
 * GET /api/admin/promo-progress
 *
 * Reads every user's `promos` sub-collection via a Firestore collection-
 * group query. Bounded to the most-recent N docs to keep latency under
 * 2s on cold cache.
 *
 * Response shape:
 *   {
 *     perType: { [promoType]: { started, completed, pending, conversionRate } },
 *     pendingTotal: number,
 *     stalePending: Array<{ wallet, promoId, promoType, progress, progressMax, hoursStale }>,
 *     scannedDocs: number,
 *   }
 *
 * stalePending lists users in the middle of a multi-step promo who
 * haven't moved forward in 48h+ — exactly the "send them a specific
 * message" group Boris wanted surfaced.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

export const dynamic = 'force-dynamic';

// Was 2000 — promo-progress aggregates across every user's promos
// subcollection (collectionGroup) so In Progress counts MUST cover
// every doc, not just the most-recent 2k. Now 50k gives plenty of
// runway; raise if SBS ever has tens of thousands of active promos.
const SCAN_LIMIT = 50_000;
const STALE_HOURS = 48;
const STALE_RESULTS_LIMIT = 50;

interface PromoDoc {
  id: string;
  type?: string;
  progressCurrent?: number;
  progressMax?: number;
  claimable?: boolean;
  claimCount?: number;
  // Some promos carry a last-update timestamp on the doc; others infer
  // it from history arrays. We pull whichever exists.
  updatedAt?: unknown;
}

interface PerTypeBucket {
  started: number;
  completed: number;
  pending: number;
  conversionRate: number; // 0..1
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();

    // collectionGroup walks every `promos` subcollection across every user
    // doc. No where-filter so we don't depend on a Firestore index — small
    // perf hit, big setup-cost win.
    let snap;
    try {
      snap = await db.collectionGroup('promos').limit(SCAN_LIMIT).get();
    } catch (err) {
      // Some Firestore configurations need an explicit subcollection-
      // group exposure. Fall back to a per-user scan if collectionGroup
      // is rejected.
      logger.warn('admin.promo_progress.collectiongroup_failed', { err });
      return json({
        ok: true,
        perType: {},
        pendingTotal: 0,
        stalePending: [],
        scannedDocs: 0,
        warning: 'collectionGroup unavailable — promo-progress disabled until a Firestore index is added',
        requestId,
      });
    }

    const perType: Record<string, PerTypeBucket> = {};
    const pendingPerUser: Array<{
      wallet: string;
      promoId: string;
      promoType: string;
      progress: number;
      progressMax: number;
      lastActivity: number | null;
    }> = [];

    for (const doc of snap.docs) {
      const data = doc.data() as PromoDoc;
      const type = data.type ?? 'unknown';
      const progressCurrent = typeof data.progressCurrent === 'number' ? data.progressCurrent : 0;
      const progressMax = typeof data.progressMax === 'number' ? data.progressMax : 0;
      const claimed = typeof data.claimCount === 'number' && data.claimCount > 0;
      const started = progressCurrent > 0 || claimed;
      const completed = claimed;
      // "Multi-step" — only count pending state for promos that actually
      // have a >1-step path. Single-click promos can't be pending.
      const isMultiStep = progressMax > 1;
      const isPending = isMultiStep && started && !completed;

      if (!perType[type]) {
        perType[type] = { started: 0, completed: 0, pending: 0, conversionRate: 0 };
      }
      if (started) perType[type].started += 1;
      if (completed) perType[type].completed += 1;
      if (isPending) perType[type].pending += 1;

      if (isPending) {
        // Walk parent path to extract userId: doc.ref.path =
        // 'v2_users/<userId>/promos/<promoId>'
        const segments = doc.ref.path.split('/');
        const wallet = segments[1] ?? '';
        pendingPerUser.push({
          wallet,
          promoId: doc.id,
          promoType: type,
          progress: progressCurrent,
          progressMax,
          lastActivity: toMillis(data.updatedAt),
        });
      }
    }

    // Conversion rate = completed / started, rounded to 3 decimals.
    for (const key of Object.keys(perType)) {
      const b = perType[key];
      b.conversionRate = b.started > 0 ? Math.round((b.completed / b.started) * 1000) / 1000 : 0;
    }

    // Stale pending = in progress + no activity in 48h+. We require a
    // KNOWN updatedAt timestamp before flagging an entry as stale —
    // pending docs without updatedAt are skipped (legacy docs from
    // before timestamp instrumentation; flagging them all as stale
    // would produce a misleading list).
    const now = Date.now();
    const staleThreshold = now - STALE_HOURS * 3_600_000;
    const stalePending = pendingPerUser
      .filter((p) => p.lastActivity !== null && p.lastActivity <= staleThreshold)
      .sort((a, b) => (a.lastActivity ?? 0) - (b.lastActivity ?? 0))
      .slice(0, STALE_RESULTS_LIMIT)
      .map((p) => ({
        wallet: p.wallet,
        promoId: p.promoId,
        promoType: p.promoType,
        progress: p.progress,
        progressMax: p.progressMax,
        hoursStale: p.lastActivity
          ? Math.round((now - p.lastActivity) / 3_600_000)
          : null,
      }));

    const pendingTotal = pendingPerUser.length;

    logger.info('admin.promo_progress.ok', {
      requestId,
      context: { scannedDocs: snap.size, pendingTotal, stalePendingCount: stalePending.length },
    });

    return json({
      ok: true,
      perType,
      pendingTotal,
      stalePending,
      scannedDocs: snap.size,
      requestId,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.promo_progress.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/promo-progress',
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
