/**
 * GET /api/admin/users-aggregate
 *
 * Per-user rollup of every meaningful signal across the system. Powers
 * the "every user" filterable table on the admin dashboard.
 *
 * One bounded fan-out:
 *   1. v2_users — base list + identity + current balances + walletType
 *   2. v2_activity_events — bounded scan, group by userId to get
 *      lifetime drafts entered / passes bought / spend / promos
 *      claimed / spins won / free drafts won
 *   3. collectionGroup('promos') — bounded scan, group by parent userId
 *      to get promo-started / promo-completed sets per user
 *
 * Returns a single array. The frontend filters / sorts / paginates
 * client-side — for SBS's user count (~200) this is plenty fast.
 *
 * Boris's spec: "every user new user that joins → table at the bottom →
 * filter to see who drafted a lot but never did a promo etc."
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

// Bounds. Hit each ceiling for SBS's current scale + ~3 months of
// headroom; bump if we cross them.
const USERS_LIMIT = 2000;
const ACTIVITY_LIMIT = 10_000;
const PROMOS_LIMIT = 5000;

interface AggregateUser {
  wallet: string;
  username: string | null;
  walletType: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  balances: {
    freeDrafts: number;
    draftPasses: number;
    wheelSpins: number;
    jackpotEntries: number;
    hofEntries: number;
    cardPurchaseCount: number;
  };
  activity: {
    draftsEntered: number;
    draftsLeft: number;
    draftsWon: number;
    draftWinningsUsd: number;
    passesBought: number;
    spendUsd: number;
    passesGranted: number;
    spinsWon: number;
    freeDraftsWon: number;
    promosClaimed: number;
    cashoutsCompleted: number;
    cashoutsUsd: number;
  };
  promos: {
    startedTypes: string[];
    completedTypes: string[];
    pendingTypes: string[];
    hasStartedAny: boolean;
    hasCompletedAny: boolean;
  };
}

function toIso(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
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

    // 1. v2_users — every user doc, bounded.
    const usersSnap = await db.collection('v2_users')
      .orderBy('createdAt', 'desc')
      .limit(USERS_LIMIT)
      .get();

    const byWallet = new Map<string, AggregateUser>();
    for (const doc of usersSnap.docs) {
      const d = doc.data() ?? {};
      const wallet = (typeof d.walletAddress === 'string' ? d.walletAddress : doc.id).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) continue;
      byWallet.set(wallet, {
        wallet,
        username: typeof d.username === 'string' && !d.username.startsWith('User-') ? d.username : null,
        walletType: typeof d.walletType === 'string' ? d.walletType : 'unknown',
        createdAt: toIso(d.createdAt),
        lastActiveAt: toIso(d.lastActiveAt) ?? toIso(d.lastLoginAt),
        balances: {
          freeDrafts: typeof d.freeDrafts === 'number' ? d.freeDrafts : 0,
          draftPasses: typeof d.draftPasses === 'number' ? d.draftPasses : 0,
          wheelSpins: typeof d.wheelSpins === 'number' ? d.wheelSpins : 0,
          jackpotEntries: typeof d.jackpotEntries === 'number' ? d.jackpotEntries : 0,
          hofEntries: typeof d.hofEntries === 'number' ? d.hofEntries : 0,
          cardPurchaseCount: typeof d.cardPurchaseCount === 'number' ? d.cardPurchaseCount : 0,
        },
        activity: {
          draftsEntered: 0,
          draftsLeft: 0,
          draftsWon: 0,
          draftWinningsUsd: 0,
          passesBought: 0,
          spendUsd: 0,
          passesGranted: 0,
          spinsWon: 0,
          freeDraftsWon: 0,
          promosClaimed: 0,
          cashoutsCompleted: 0,
          cashoutsUsd: 0,
        },
        promos: {
          startedTypes: [],
          completedTypes: [],
          pendingTypes: [],
          hasStartedAny: false,
          hasCompletedAny: false,
        },
      });
    }

    // 2. v2_activity_events — bounded scan, aggregate per userId. We
    //    walk all event types in one pass so the scan stays O(1) per
    //    user lookup.
    const ensureUser = (wallet: string): AggregateUser | null => {
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;
      let entry = byWallet.get(wallet);
      if (entry) return entry;
      // User appears in activity but not in v2_users (shouldn't happen
      // but be defensive — could be a wallet that interacted via the
      // Go API without a Firestore mirror). Seed an empty record so
      // their activity counts.
      entry = {
        wallet,
        username: null,
        walletType: 'unknown',
        createdAt: null,
        lastActiveAt: null,
        balances: { freeDrafts: 0, draftPasses: 0, wheelSpins: 0, jackpotEntries: 0, hofEntries: 0, cardPurchaseCount: 0 },
        activity: {
          draftsEntered: 0, draftsLeft: 0, draftsWon: 0, draftWinningsUsd: 0,
          passesBought: 0, spendUsd: 0, passesGranted: 0,
          spinsWon: 0, freeDraftsWon: 0, promosClaimed: 0,
          cashoutsCompleted: 0, cashoutsUsd: 0,
        },
        promos: { startedTypes: [], completedTypes: [], pendingTypes: [], hasStartedAny: false, hasCompletedAny: false },
      };
      byWallet.set(wallet, entry);
      return entry;
    };

    try {
      const actSnap = await db.collection(ACTIVITY_EVENTS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(ACTIVITY_LIMIT)
        .get();
      for (const doc of actSnap.docs) {
        const d = doc.data() as {
          type?: string;
          userId?: string;
          quantity?: number;
          metadata?: Record<string, unknown>;
        };
        const userId = (d.userId ?? '').toLowerCase();
        const entry = ensureUser(userId);
        if (!entry) continue;
        const meta = d.metadata ?? {};
        switch (d.type) {
          case 'pass_purchased': {
            entry.activity.passesBought += Number(d.quantity ?? 1);
            const price = Number(meta.totalPrice);
            if (Number.isFinite(price)) entry.activity.spendUsd += price;
            break;
          }
          case 'pass_granted':
            entry.activity.passesGranted += Number(d.quantity ?? meta.draftPassesAdded ?? 1);
            break;
          case 'spin_won': {
            entry.activity.spinsWon += 1;
            const prizeType = String(meta.prizeType ?? '');
            const prizeValue = meta.prizeValue;
            if (prizeType === 'draft_pass') {
              const v = Number(prizeValue);
              if (Number.isFinite(v)) entry.activity.freeDraftsWon += v;
            }
            break;
          }
          case 'promo_claimed':
            entry.activity.promosClaimed += 1;
            break;
          case 'draft_entered':
            entry.activity.draftsEntered += 1;
            break;
          case 'draft_left':
            entry.activity.draftsLeft += 1;
            break;
          case 'draft_won': {
            entry.activity.draftsWon += 1;
            const amt = Number(meta.amount);
            if (Number.isFinite(amt)) entry.activity.draftWinningsUsd += amt;
            break;
          }
          case 'cashout_completed': {
            entry.activity.cashoutsCompleted += 1;
            const val = Number(meta.settledUsd ?? meta.amount);
            if (Number.isFinite(val)) entry.activity.cashoutsUsd += val;
            break;
          }
        }
      }
    } catch (err) {
      logger.warn('admin.users_aggregate.activity_scan_failed', { err });
    }

    // 3. collectionGroup('promos') — bounded scan. Each doc lives at
    //    v2_users/{userId}/promos/{promoId} — extract userId from path.
    try {
      const promosSnap = await db.collectionGroup('promos').limit(PROMOS_LIMIT).get();
      for (const doc of promosSnap.docs) {
        // Path looks like v2_users/<wallet>/promos/<id>
        const segments = doc.ref.path.split('/');
        const wallet = (segments[1] ?? '').toLowerCase();
        const entry = ensureUser(wallet);
        if (!entry) continue;
        const data = doc.data() as { type?: string; progressCurrent?: number; progressMax?: number; claimable?: boolean; claimCount?: number };
        const promoType = typeof data.type === 'string' ? data.type : null;
        if (!promoType) continue;
        const progressCurrent = typeof data.progressCurrent === 'number' ? data.progressCurrent : 0;
        const progressMax = typeof data.progressMax === 'number' ? data.progressMax : 0;
        const claimed = typeof data.claimCount === 'number' && data.claimCount > 0;
        const started = progressCurrent > 0 || claimed;
        const completed = claimed;
        const isMultiStep = progressMax > 1;
        const isPending = isMultiStep && started && !completed;

        if (started && !entry.promos.startedTypes.includes(promoType)) {
          entry.promos.startedTypes.push(promoType);
        }
        if (completed && !entry.promos.completedTypes.includes(promoType)) {
          entry.promos.completedTypes.push(promoType);
        }
        if (isPending && !entry.promos.pendingTypes.includes(promoType)) {
          entry.promos.pendingTypes.push(promoType);
        }
      }
    } catch (err) {
      logger.warn('admin.users_aggregate.promos_scan_failed', { err });
    }

    // Fix up the hasStartedAny / hasCompletedAny flags after all reads.
    for (const u of byWallet.values()) {
      u.promos.hasStartedAny = u.promos.startedTypes.length > 0;
      u.promos.hasCompletedAny = u.promos.completedTypes.length > 0;
    }

    const users = Array.from(byWallet.values());
    logger.info('admin.users_aggregate.ok', {
      requestId,
      context: { userCount: users.length },
    });

    return json({ ok: true, users, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.users_aggregate.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/users-aggregate',
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
