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
  // drafts", "Jackpot entry", "HOF entry", "Nothing"). Counts come from
  // a bounded scan of the most-recent 2000 spins.
  wheelPrizeBreakdown: Record<string, number>;
  /** Sum of free draft passes given out via wheel wins (scan window). */
  totalFreeDraftsFromWheel: number;
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

  // Wheel spins: timestamp is ISO string. Reads the per-user
  // `wheelSpins` subcollections via collectionGroup so the counts
  // reflect every spin every user has ever taken — not the (mostly
  // empty / legacy) top-level `wheelSpins` collection.
  const [totalSpins, spinsToday, jackpotHits, hofHits, draftPassAwards] = await Promise.all([
    count(wheelSpinsGroup),
    count(wheelSpinsGroup.where('timestamp', '>=', todayIso)),
    count(wheelSpinsGroup.where('result', '==', 'jackpot')),
    count(wheelSpinsGroup.where('result', '==', 'hof')),
    count(wheelSpinsGroup.where('prize.type', '==', 'draft_pass')),
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

  // Draft passes awarded (sum prize.value across every draft_pass spin).
  // Firestore can't sum — bounded scan to 500 most-recent. Uses the
  // collectionGroup so it reads from where spins actually live.
  let draftPassesAwardedTotal = 0;
  try {
    const awardedSnap = await wheelSpinsGroup
      .where('prize.type', '==', 'draft_pass')
      .orderBy('timestamp', 'desc')
      .limit(500)
      .get();
    for (const d of awardedSnap.docs) {
      const v = (d.data() as { prize?: { value?: unknown } }).prize?.value;
      if (typeof v === 'number') draftPassesAwardedTotal += v;
    }
  } catch (err) {
    // Non-fatal — collectionGroup ordered queries sometimes require an
    // index on first use. Log so we know to add one.
    logger.warn('metrics.draft_passes_awarded_failed', { err });
  }

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

  // Wheel-prize breakdown by exact prize label. Boris's ask: "from the
  // banana wheel spins how many wins are what — 1 draft, 5 draft, 20 drafts,
  // JP and HOF." We scan up to 2000 most-recent spins and bucket by the
  // resolved prize string ("1 free draft", "5 free drafts", "Jackpot entry",
  // "HOF entry"). Bounded to keep latency under 1s on cold cache.
  // Also accumulates totalFreeDraftsFromWheel (sum of prize.value across
  // every draft_pass-prize spin), which feeds the free-vs-paid pass ratio
  // shown on the dashboard.
  const wheelPrizeBreakdown: Record<string, number> = {};
  let totalFreeDraftsFromWheel = 0;
  try {
    const spinSnap = await wheelSpinsGroup.orderBy('timestamp', 'desc').limit(2000).get();
    for (const d of spinSnap.docs) {
      const data = d.data() as { prize?: { type?: string; value?: unknown }; result?: string };
      const prizeType = data.prize?.type ?? '';
      const prizeValue = data.prize?.value;
      let label = 'unknown';
      if (prizeType === 'draft_pass' && typeof prizeValue === 'number') {
        label = `${prizeValue} free draft${prizeValue === 1 ? '' : 's'}`;
        totalFreeDraftsFromWheel += prizeValue;
      } else if (prizeType === 'custom' && prizeValue === 'jackpot') {
        label = 'Jackpot entry';
      } else if (prizeType === 'custom' && prizeValue === 'hof') {
        label = 'HOF entry';
      } else if (prizeType === 'nothing') {
        label = 'Nothing';
      } else if (data.result) {
        label = String(data.result);
      }
      wheelPrizeBreakdown[label] = (wheelPrizeBreakdown[label] ?? 0) + 1;
    }
  } catch (err) {
    logger.warn('metrics.wheel_prize_breakdown_failed', { err });
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
