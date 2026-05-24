import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { Timestamp, type Query, type DocumentData } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// Short server-side cache to avoid pounding Firestore when the dashboard polls
// every 10s across multiple admins. 15s is enough to feel live.
let cached: { at: number; payload: MetricsResponse } | null = null;
const CACHE_TTL_MS = 15_000;

export interface MetricsResponse {
  users: {
    total: number;
    newToday: number;
    newThisWeek: number;
    verified: number;
    xLinked: number;
  };
  engagement: {
    signupsToday: number;
    signupsThisWeek: number;
    loginsToday: number;
    loginsThisWeek: number;
  };
  wheel: {
    totalSpins: number;
    spinsToday: number;
    jackpotHits: number;
    hofHits: number;
    draftPassAwards: number;
    draftPassesAwardedTotal: number;
  };
  promos: {
    sharesVerifiedTotal: number;
    sharesVerifiedToday: number;
    sharesEarnedCredit: number;
    promoClaimsToday: number;
  };
  referrals: {
    totalCodes: number;
  };
  withdrawals: {
    pending: number;
    approved: number;
    denied: number;
    totalVolume: number;
  };
  drafts: {
    queued: number;
    jackpotQueueSize: number;
    hofQueueSize: number;
  };
  // All-time totals. Added May 2026 — the per-day KPIs above only tell
  // half the story; admins also want the cumulative scoreboard.
  lifetime: {
    signups: number;
    logins: number;
    wheelSpins: number;
    passesPurchased: number;
    promosClaimed: number;
    jackpotWins: number;
    hofWins: number;
    /** Total USDC ever paid out via withdrawals (paid status). */
    withdrawalsPaidVolume: number;
    /** Drafts that have reached "completed" status. */
    draftsCompleted: number;
  };
  // Promo engagement breakdown — claims-by-type so admins can see which
  // promo is most popular at a glance. Keys are promoType values from
  // the promo_claimed event metadata (`refer`, `tweet_share`, etc.).
  promoBreakdown: Record<string, { claimsToday: number; claimsTotal: number }>;
  generatedAt: string;
  requestId?: string;
}

function since(msAgo: number): Date {
  return new Date(Date.now() - msAgo);
}

async function count(q: Query<DocumentData>): Promise<number> {
  try {
    const snap = await q.count().get();
    return snap.data().count;
  } catch (err) {
    logger.warn('metrics.count_failed', { err });
    return 0;
  }
}

async function buildMetrics(): Promise<MetricsResponse> {
  const db = getAdminFirestore();
  const now = Date.now();
  const today = since(DAY_MS);
  const week = since(WEEK_MS);
  const todayIso = today.toISOString();
  const weekIso = week.toISOString();
  const todayTs = Timestamp.fromMillis(today.getTime());
  const weekTs = Timestamp.fromMillis(week.getTime());

  const users = db.collection('v2_users');
  const wheelSpins = db.collection('wheelSpins');
  const userEvents = db.collection('v2_user_events');
  const spinShares = db.collection('v2_spin_shares');
  const xLinks = db.collection('v2_twitter_links');
  const referralCodes = db.collection('v2_referral_codes');
  const withdrawals = db.collection('withdrawalRequests');
  const queues = db.collection('v2_queues');

  // Users: createdAt is stored as ISO string by buildSeedUser — use >= on string compare,
  // which works because ISO sorts lexicographically.
  const [
    usersTotal,
    usersNewToday,
    usersNewWeek,
    usersVerifiedBlueCheck,
    usersVerifiedLegacy,
    xLinkedCount,
  ] = await Promise.all([
    count(users),
    count(users.where('createdAt', '>=', todayIso)),
    count(users.where('createdAt', '>=', weekIso)),
    count(users.where('blueCheckVerified', '==', true)),
    count(users.where('isBlueCheckVerified', '==', true)),
    count(xLinks),
  ]);
  const usersVerified = Math.max(usersVerifiedBlueCheck, usersVerifiedLegacy);

  // User events: timestamp is ISO string
  const [signupsToday, signupsWeek, loginsToday, loginsWeek, promoClaimsToday] = await Promise.all([
    count(userEvents.where('eventType', '==', 'signup').where('timestamp', '>=', todayIso)),
    count(userEvents.where('eventType', '==', 'signup').where('timestamp', '>=', weekIso)),
    count(userEvents.where('eventType', '==', 'login').where('timestamp', '>=', todayIso)),
    count(userEvents.where('eventType', '==', 'login').where('timestamp', '>=', weekIso)),
    count(userEvents.where('eventType', '==', 'promo_claimed').where('timestamp', '>=', todayIso)),
  ]);

  // Wheel spins: timestamp is ISO string per app/api/wheel/spin/route.ts
  const [totalSpins, spinsToday, jackpotHits, hofHits, draftPassAwards] = await Promise.all([
    count(wheelSpins),
    count(wheelSpins.where('timestamp', '>=', todayIso)),
    count(wheelSpins.where('result', '==', 'jackpot')),
    count(wheelSpins.where('result', '==', 'hof')),
    count(wheelSpins.where('prize.type', '==', 'draft_pass')),
  ]);

  // Shares: timestamp field is verifiedAt
  const [sharesTotal, sharesTodayCount, sharesEarnedCredit] = await Promise.all([
    count(spinShares),
    count(spinShares.where('verifiedAt', '>=', todayIso)),
    count(spinShares.where('earnsCredit', '==', true)),
  ]);

  // Withdrawals
  const [wPending, wApproved, wDenied] = await Promise.all([
    count(withdrawals.where('status', '==', 'pending')),
    count(withdrawals.where('status', '==', 'approved')),
    count(withdrawals.where('status', '==', 'denied')),
  ]);

  // Withdrawal volume (sum) — run a limited read; if there are too many, this could be slow.
  // For now, scan up to 500 most recent approved + pending.
  let totalVolume = 0;
  try {
    const volSnap = await withdrawals
      .where('status', 'in', ['approved', 'pending'])
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    for (const d of volSnap.docs) {
      const amt = d.data().amount;
      if (typeof amt === 'number' && Number.isFinite(amt)) totalVolume += amt;
    }
  } catch {
    // Non-fatal
  }

  // Referrals + queues
  const [refCodes, jackpotQueueDoc, hofQueueDoc] = await Promise.all([
    count(referralCodes),
    queues.doc('jackpot').get().catch(() => null),
    queues.doc('hof').get().catch(() => null),
  ]);

  const jackpotQueueSize = sumQueueMembers(jackpotQueueDoc?.data());
  const hofQueueSize = sumQueueMembers(hofQueueDoc?.data());

  // Draft passes awarded (sum prize.value from wheelSpins where prize.type='draft_pass')
  // Firestore can't sum — fetch recent up to 500 and total.
  let draftPassesAwardedTotal = 0;
  try {
    const awardedSnap = await wheelSpins
      .where('prize.type', '==', 'draft_pass')
      .orderBy('timestamp', 'desc')
      .limit(500)
      .get();
    for (const d of awardedSnap.docs) {
      const v = (d.data() as { prize?: { value?: unknown } }).prize?.value;
      if (typeof v === 'number') draftPassesAwardedTotal += v;
    }
  } catch {
    // Non-fatal
  }

  // ── Lifetime totals + promo breakdown ──────────────────────────────
  // All-time counters that complement the per-day KPIs above. Each one
  // is a single count() query unless noted; promo-by-type requires a
  // bounded scan because Firestore can't group_by.

  const [
    loginsLifetime,
    passesPurchasedLifetime,
    promosClaimedLifetime,
    draftsCompletedLifetime,
  ] = await Promise.all([
    count(userEvents.where('eventType', '==', 'login')),
    count(userEvents.where('eventType', '==', 'pass_purchased')),
    count(userEvents.where('eventType', '==', 'promo_claimed')),
    count(db.collection('v2_drafts').where('status', '==', 'completed')),
  ]);

  // Withdrawals paid volume (lifetime). Bounded scan to keep the
  // metrics query fast — caps at the most-recent 2000 paid withdrawals.
  // If volume ever blows past that cap, we should switch to a write-
  // through aggregate doc (out of scope for this pass).
  let withdrawalsPaidVolume = 0;
  try {
    const paidSnap = await withdrawals
      .where('status', 'in', ['paid', 'completed'])
      .orderBy('createdAt', 'desc')
      .limit(2000)
      .get();
    for (const d of paidSnap.docs) {
      const amt = d.data().amount;
      if (typeof amt === 'number' && Number.isFinite(amt)) withdrawalsPaidVolume += amt;
    }
  } catch {
    // Non-fatal — leave at 0
  }

  // Promo breakdown by type. Two scans (today + lifetime) of the
  // promo_claimed event stream so we can show "X claims today / Y total"
  // per promo type. Capped at 2000 lifetime to keep latency bounded.
  const promoBreakdown: Record<string, { claimsToday: number; claimsTotal: number }> = {};
  const bumpPromo = (type: string, key: 'claimsToday' | 'claimsTotal') => {
    if (!promoBreakdown[type]) promoBreakdown[type] = { claimsToday: 0, claimsTotal: 0 };
    promoBreakdown[type][key] += 1;
  };
  try {
    const [todaySnap, totalSnap] = await Promise.all([
      userEvents
        .where('eventType', '==', 'promo_claimed')
        .where('timestamp', '>=', todayIso)
        .limit(500)
        .get(),
      userEvents
        .where('eventType', '==', 'promo_claimed')
        .orderBy('timestamp', 'desc')
        .limit(2000)
        .get(),
    ]);
    for (const d of todaySnap.docs) {
      const t = String((d.data() as { meta?: { promoType?: unknown } }).meta?.promoType ?? 'unknown');
      bumpPromo(t, 'claimsToday');
    }
    for (const d of totalSnap.docs) {
      const t = String((d.data() as { meta?: { promoType?: unknown } }).meta?.promoType ?? 'unknown');
      bumpPromo(t, 'claimsTotal');
    }
  } catch (err) {
    logger.warn('metrics.promo_breakdown_failed', { err });
  }

  // Suppress unused warnings — weekTs/todayTs reserved for future Timestamp-typed
  // collections. We use ISO strings throughout for now.
  void weekTs;
  void todayTs;

  return {
    users: {
      total: usersTotal,
      newToday: usersNewToday,
      newThisWeek: usersNewWeek,
      verified: usersVerified,
      xLinked: xLinkedCount,
    },
    engagement: {
      signupsToday,
      signupsThisWeek: signupsWeek,
      loginsToday,
      loginsThisWeek: loginsWeek,
    },
    wheel: {
      totalSpins,
      spinsToday,
      jackpotHits,
      hofHits,
      draftPassAwards,
      draftPassesAwardedTotal,
    },
    promos: {
      sharesVerifiedTotal: sharesTotal,
      sharesVerifiedToday: sharesTodayCount,
      sharesEarnedCredit,
      promoClaimsToday,
    },
    referrals: {
      totalCodes: refCodes,
    },
    withdrawals: {
      pending: wPending,
      approved: wApproved,
      denied: wDenied,
      totalVolume,
    },
    drafts: {
      queued: jackpotQueueSize + hofQueueSize,
      jackpotQueueSize,
      hofQueueSize,
    },
    lifetime: {
      signups: usersTotal,            // every v2_users doc is a signup
      logins: loginsLifetime,
      wheelSpins: totalSpins,
      passesPurchased: passesPurchasedLifetime,
      promosClaimed: promosClaimedLifetime,
      jackpotWins: jackpotHits,
      hofWins: hofHits,
      withdrawalsPaidVolume,
      draftsCompleted: draftsCompletedLifetime,
    },
    promoBreakdown,
    generatedAt: new Date(now).toISOString(),
  };
}

function sumQueueMembers(queueDoc: unknown): number {
  if (!queueDoc || typeof queueDoc !== 'object') return 0;
  const rounds = (queueDoc as { rounds?: Array<{ status?: string; members?: unknown[] }> }).rounds;
  if (!Array.isArray(rounds)) return 0;
  let total = 0;
  for (const r of rounds) {
    if (r.status === 'filling' && Array.isArray(r.members)) total += r.members.length;
  }
  return total;
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    // Serve from cache if fresh
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) {
      logger.debug('admin.metrics.cache_hit', { requestId, ageMs: now - cached.at });
      return json({ ...cached.payload, requestId, cached: true });
    }

    const payload = await buildMetrics();
    cached = { at: now, payload };

    logger.info('admin.metrics.ok', {
      requestId,
      durationMs: Date.now() - start,
      totals: {
        users: payload.users.total,
        spins: payload.wheel.totalSpins,
        withdrawals: payload.withdrawals.pending,
      },
    });

    return json({ ...payload, requestId });
  } catch (err) {
    logger.error('admin.metrics.failed', { requestId, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
