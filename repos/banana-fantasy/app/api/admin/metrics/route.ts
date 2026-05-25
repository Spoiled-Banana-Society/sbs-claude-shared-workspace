import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { Timestamp, type Query, type DocumentData } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { wheelSegments } from '@/lib/wheelConfig';

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
    /**
     * Signup rail breakdown by walletType. privy_embedded ≈ social login
     * (Gmail / X / etc., user got an embedded wallet). privy_external ≈
     * linked an existing wallet through Privy. external_connect ≈ direct
     * wallet connect without Privy (MetaMask, Coinbase Wallet, …).
     */
    byWalletType: {
      privy_embedded: number;
      privy_external: number;
      external_connect: number;
      unknown: number;
    };
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
  // Wheel spin breakdown by exact prize label ("1 free draft", "5 free
  // drafts", "Jackpot entry", "HOF entry", "Nothing"). Each entry carries
  // BOTH today and total counts so the dashboard can show both columns.
  // Initialized from wheelConfig so every defined segment renders, even
  // at 0. Computed from a single bounded scan of the most-recent 2000
  // spins (no Firestore index needed).
  wheelPrizeBreakdown: Record<string, { today: number; total: number }>;
  /** Sum of free draft passes given out via wheel wins (scan window). */
  totalFreeDraftsFromWheel: number;
  /** Free drafts given today. */
  freeDraftsFromWheelToday: number;
  /** Total revenue (USD) from card + USDC pass purchases. Sum of
   *  pass_purchased event metadata.totalPrice in v2_activity_events. */
  totalRevenueUsd: number;
  /** Revenue today. */
  revenueTodayUsd: number;
  /** Users who have draft_entered events but 0 promo_claimed events —
   *  the "engaged with the product but not the promo loop" cohort. */
  draftersWithoutPromos: number;
  // JP/HOF entries currently held by users — reservations from wheel
  // wins that haven't been redeemed into an actual JP/HOF draft yet.
  reservedDrafts: { jackpot: number; hof: number };
  /**
   * Wheel-won JP/HOF draft pipeline. Every entry in the JP/HOF queues
   * exists because a wheel win triggered it — so these counts are
   * specifically "drafts created via the wheel" (separate from the
   * regular 5%/1% guaranteed-distribution drafts).
   */
  wheelDrafts: {
    jackpot: { filling: number; drafting: number; completed: number; total: number };
    hof: { filling: number; drafting: number; completed: number; total: number };
  };
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
  // Real spin data lives in per-user subcollections:
  //   v2_users/{userId}/wheelSpins/{spinId}
  // A `collectionGroup('wheelSpins')` query walks every subcollection
  // at once. Reading the bare top-level `wheelSpins` collection (as
  // we did until now) only saw legacy test data and produced wildly
  // wrong counts — Boris caught "97 JP entries in 156 spins" which
  // was reading 156 stale top-level docs.
  const wheelSpinsGroup = db.collectionGroup('wheelSpins');
  const userEvents = db.collection('v2_user_events');
  // Commerce / gameplay events (pass_purchased, pass_granted, spin_won,
  // promo_claimed, draft_won, cashout_completed, …). Uses `type` field
  // not `eventType`. Distinct from v2_user_events (auth lifecycle).
  const activityEvents = db.collection('v2_activity_events');
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
    usersPrivyEmbedded,
    usersPrivyExternal,
    usersExternalConnect,
  ] = await Promise.all([
    count(users),
    count(users.where('createdAt', '>=', todayIso)),
    count(users.where('createdAt', '>=', weekIso)),
    count(users.where('blueCheckVerified', '==', true)),
    count(users.where('isBlueCheckVerified', '==', true)),
    count(xLinks),
    // Signup rail breakdown — Boris's ask: how many users came in via
    // Privy social login (Gmail/X, gives them an embedded wallet) vs
    // Privy with an external wallet linked vs direct crypto-wallet
    // connect (no Privy session). Each maps to a walletType tag we
    // already write on signup. Counts are lifetime.
    count(users.where('walletType', '==', 'privy_embedded')),
    count(users.where('walletType', '==', 'privy_external')),
    count(users.where('walletType', '==', 'external_connect')),
  ]);
  const usersVerified = Math.max(usersVerifiedBlueCheck, usersVerifiedLegacy);
  const usersUnknownWalletType = Math.max(
    0,
    usersTotal - usersPrivyEmbedded - usersPrivyExternal - usersExternalConnect,
  );

  // User events: timestamp is ISO string
  const [signupsToday, signupsWeek, loginsToday, loginsWeek, promoClaimsToday] = await Promise.all([
    count(userEvents.where('eventType', '==', 'signup').where('timestamp', '>=', todayIso)),
    count(userEvents.where('eventType', '==', 'signup').where('timestamp', '>=', weekIso)),
    count(userEvents.where('eventType', '==', 'login').where('timestamp', '>=', todayIso)),
    count(userEvents.where('eventType', '==', 'login').where('timestamp', '>=', weekIso)),
    count(userEvents.where('eventType', '==', 'promo_claimed').where('timestamp', '>=', todayIso)),
  ]);

  // Wheel spins: total count works without a filter (collectionGroup
  // count is unindexed-OK). Every other per-prize / per-day count is
  // computed CLIENT-SIDE from a single bounded scan further down,
  // because collectionGroup + .where() requires a composite Firestore
  // index per filter and silently returns 0 without one. Boris caught
  // that bug: "424 total spins but 0 free drafts / 0 JP / 0 HOF" — all
  // three were the indexless-where-returns-0 trap.
  const totalSpins = await count(wheelSpinsGroup);

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

  // JP/HOF wheel-won draft breakdown — per Boris's ask: "show me in
  // daily and total column how many jp or hof drafts were done solely
  // through winning the spins, how many are pending, how many finished."
  // The v2_queues docs are the source of truth — every round was
  // populated by a wheel win. Status mapping:
  //   filling   → still waiting for 10 players to fill
  //   ready     → 10 players locked in, draft kicking off
  //   drafting  → live draft in progress
  //   completed → finished
  function summarizeQueue(doc: FirebaseFirestore.DocumentData | undefined) {
    const rounds = (doc as { rounds?: Array<{ status?: string; draftId?: string | null }> } | undefined)?.rounds ?? [];
    const out = { filling: 0, drafting: 0, completed: 0, total: rounds.length };
    for (const r of rounds) {
      if (r.status === 'completed') out.completed += 1;
      else if (r.status === 'drafting' || r.status === 'ready') out.drafting += 1;
      else if (r.status === 'filling') out.filling += 1;
    }
    return out;
  }
  const jackpotQueueBreakdown = summarizeQueue(jackpotQueueDoc?.data());
  const hofQueueBreakdown = summarizeQueue(hofQueueDoc?.data());

  // (draftPassesAwardedTotal moved into the single wheel-scan below —
  // see the wheelPrizeBreakdown block. Computing it from the same scan
  // avoids the collectionGroup + .where() index trap that was returning
  // 0 silently.)

  // ── Lifetime totals + promo breakdown ──────────────────────────────
  // All-time counters that complement the per-day KPIs above. Each one
  // is a single count() query unless noted; promo-by-type requires a
  // bounded scan because Firestore can't group_by.
  //
  // IMPORTANT collection routing:
  //   v2_user_events  → signup / login / x_linked / first_purchase / wallet_linked / promo_claimed
  //   v2_activity_events → pass_purchased / pass_granted / spin_won / promo_claimed /
  //                        draft_entered / draft_left / draft_won / marketplace_sold / cashout_completed
  // Using the WRONG collection per event = silent 0s on the dashboard.

  const [
    loginsLifetime,
    passesPurchasedLifetime,
    promosClaimedLifetime,
  ] = await Promise.all([
    count(userEvents.where('eventType', '==', 'login')),
    // pass_purchased lives in v2_activity_events with field `type` (not
    // `eventType`). Reading from v2_user_events returned 0 forever.
    count(activityEvents.where('type', '==', 'pass_purchased')),
    count(userEvents.where('eventType', '==', 'promo_claimed')),
  ]);
  // Drafts completed lives in the Go API, not Firestore — there's no
  // v2_drafts collection. The queues' completed-round counts are the
  // closest local proxy (already computed below as jackpot/hof
  // breakdowns), so leave a placeholder 0 here and surface it from a
  // dedicated source in a later pass.
  const draftsCompletedLifetime = 0;

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

  // ── Single wheel-spin scan: every per-prize / per-day / per-result
  //    metric is computed CLIENT-SIDE here. Using collectionGroup +
  //    .where() filters quietly errored when a Firestore index didn't
  //    exist, leaving the dashboard at 0. One scan, all buckets, no
  //    indexes needed. Bounded to most-recent 2000 spins.
  //
  //    Boris's exact ask: show every prize segment with today + total,
  //    even when 0. We initialize the breakdown from wheelSegments so
  //    every defined prize ("1 Draft", "5 Drafts", "10 Drafts",
  //    "20 Drafts", "Jackpot", "HOF") always renders.
  const wheelPrizeBreakdown: Record<string, { today: number; total: number }> = {};
  // Seed with every wheel-config prize. Multiple segment IDs collapse
  // onto the same human label (e.g. five 'draft-1-*' segments → "1 free
  // draft") so we dedupe by label.
  for (const seg of wheelSegments) {
    let label = 'unknown';
    if (seg.prizeType === 'draft_pass' && typeof seg.prizeValue === 'number') {
      label = `${seg.prizeValue} free draft${seg.prizeValue === 1 ? '' : 's'}`;
    } else if (seg.prizeType === 'custom' && seg.prizeValue === 'jackpot') {
      label = 'Jackpot entry';
    } else if (seg.prizeType === 'custom' && seg.prizeValue === 'hof') {
      label = 'HOF entry';
    } else if (seg.prizeType === 'nothing') {
      label = 'Nothing';
    }
    if (!wheelPrizeBreakdown[label]) wheelPrizeBreakdown[label] = { today: 0, total: 0 };
  }

  let totalFreeDraftsFromWheel = 0;
  let freeDraftsFromWheelToday = 0;
  let spinsToday = 0;
  let jackpotHits = 0;
  let hofHits = 0;
  let draftPassAwards = 0;
  let draftPassesAwardedTotal = 0;
  try {
    const spinSnap = await wheelSpinsGroup.orderBy('timestamp', 'desc').limit(2000).get();
    for (const d of spinSnap.docs) {
      const data = d.data() as { prize?: { type?: string; value?: unknown }; result?: string; timestamp?: string };
      const prizeType = data.prize?.type ?? '';
      const prizeValue = data.prize?.value;
      const tsIso = typeof data.timestamp === 'string' ? data.timestamp : '';
      const isToday = tsIso >= todayIso;
      if (isToday) spinsToday += 1;
      let label = 'unknown';
      if (prizeType === 'draft_pass' && typeof prizeValue === 'number') {
        label = `${prizeValue} free draft${prizeValue === 1 ? '' : 's'}`;
        totalFreeDraftsFromWheel += prizeValue;
        if (isToday) freeDraftsFromWheelToday += prizeValue;
        draftPassAwards += 1;
        draftPassesAwardedTotal += prizeValue;
      } else if (prizeType === 'custom' && prizeValue === 'jackpot') {
        label = 'Jackpot entry';
        jackpotHits += 1;
      } else if (prizeType === 'custom' && prizeValue === 'hof') {
        label = 'HOF entry';
        hofHits += 1;
      } else if (prizeType === 'nothing') {
        label = 'Nothing';
      } else if (data.result) {
        label = String(data.result);
      }
      if (!wheelPrizeBreakdown[label]) wheelPrizeBreakdown[label] = { today: 0, total: 0 };
      wheelPrizeBreakdown[label].total += 1;
      if (isToday) wheelPrizeBreakdown[label].today += 1;
    }
  } catch (err) {
    logger.warn('metrics.wheel_scan_failed', { err });
  }

  // JP/HOF reserved drafts — entries the user earned on the wheel but
  // hasn't yet "burned" by entering a Jackpot/HOF league. Reads the
  // sum of `jackpotEntries` / `hofEntries` across all users (capped
  // 2000 newest users). Approximation: jackpotEntries > 0 means "has
  // unredeemed wheel-earned slots."
  let jackpotReservedPending = 0;
  let hofReservedPending = 0;
  try {
    const userSnap = await users.orderBy('createdAt', 'desc').limit(2000).get();
    for (const d of userSnap.docs) {
      const data = d.data();
      const jp = typeof data.jackpotEntries === 'number' ? data.jackpotEntries : 0;
      const hof = typeof data.hofEntries === 'number' ? data.hofEntries : 0;
      jackpotReservedPending += Math.max(0, jp);
      hofReservedPending += Math.max(0, hof);
    }
  } catch (err) {
    logger.warn('metrics.reserved_drafts_failed', { err });
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

  // ── Single activity-events scan: revenue + drafters-without-promos.
  //    Scans the most-recent 2000 v2_activity_events docs once and
  //    derives both metrics client-side.
  //    - totalRevenueUsd: sum of pass_purchased metadata.totalPrice
  //    - draftersWithoutPromos: distinct users with draft_entered but
  //      0 promo_claimed in the window
  let totalRevenueUsd = 0;
  let revenueTodayUsd = 0;
  const drafters = new Set<string>();
  const promoClaimers = new Set<string>();
  try {
    const actSnap = await activityEvents.orderBy('createdAt', 'desc').limit(2000).get();
    for (const d of actSnap.docs) {
      const data = d.data() as {
        type?: string;
        userId?: string;
        metadata?: Record<string, unknown>;
        createdAtIso?: string;
      };
      const userId = (data.userId ?? '').toLowerCase();
      const isToday = (data.createdAtIso ?? '') >= todayIso;
      if (data.type === 'pass_purchased') {
        const price = Number(data.metadata?.totalPrice);
        if (Number.isFinite(price)) {
          totalRevenueUsd += price;
          if (isToday) revenueTodayUsd += price;
        }
      } else if (data.type === 'draft_entered' && userId) {
        drafters.add(userId);
      } else if (data.type === 'promo_claimed' && userId) {
        promoClaimers.add(userId);
      }
    }
  } catch (err) {
    logger.warn('metrics.activity_scan_failed', { err });
  }
  const draftersWithoutPromos = Array.from(drafters).filter((u) => !promoClaimers.has(u)).length;

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
      byWalletType: {
        privy_embedded: usersPrivyEmbedded,
        privy_external: usersPrivyExternal,
        external_connect: usersExternalConnect,
        unknown: usersUnknownWalletType,
      },
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
    wheelPrizeBreakdown,
    totalFreeDraftsFromWheel,
    freeDraftsFromWheelToday,
    totalRevenueUsd,
    revenueTodayUsd,
    draftersWithoutPromos,
    reservedDrafts: { jackpot: jackpotReservedPending, hof: hofReservedPending },
    wheelDrafts: {
      jackpot: jackpotQueueBreakdown,
      hof: hofQueueBreakdown,
    },
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
