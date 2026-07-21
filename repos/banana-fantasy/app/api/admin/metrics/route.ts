import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { Timestamp, type Query, type DocumentData } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { allKnownSegmentsById } from '@/lib/wheelConfig';
import { sbsDayStartIso } from '@/lib/sbsDay';

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
  /** Drafts entered today + total (from v2_activity_events.draft_entered). */
  draftsEnteredToday: number;
  draftsEnteredTotal: number;
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
  // "Today" = the SBS business day (starts 3 AM PT — lib/sbsDay), NOT a
  // rolling 24h window. Must match /api/admin/activity/stats or the
  // dashboard's TODAY column disagrees with the activity cards.
  const today = new Date(sbsDayStartIso());
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
    // Verified users — the real field is `isVerified` (40 true). The old
    // `blueCheckVerified`/`isBlueCheckVerified` fields don't exist on any
    // v2_users doc, so the dashboard showed 0 verified forever. Keep the
    // legacy field as a Math.max fallback below in case old docs use it.
    count(users.where('isVerified', '==', true)),
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

  // User events buckets — per-day counts of signup / login / promo_claimed.
  //
  // The wrong way (what we had): one giant `orderBy(timestamp).limit(5000)`
  // scan + client-side bucketing. Silently undercounts the moment
  // total events crosses 5k.
  //
  // The right way: ONE single-field where (auto-indexed) per event
  // type, scan ALL matching docs, bucket by day client-side. Single-
  // field where queries don't need composite indexes and the per-
  // event-type doc volume stays small (signups ≪ logins). Limits set
  // 10× ahead of where staging is today so a sudden surge can't blow
  // through them silently.
  let signupsToday = 0;
  let signupsWeek = 0;
  let loginsToday = 0;
  let loginsWeek = 0;
  let promoClaimsToday = 0;
  let signupsScanSize = 0;
  let loginsScanSize = 0;
  let promosScanSize = 0;
  try {
    const [signupsSnap, loginsSnap, promosSnap] = await Promise.all([
      userEvents.where('eventType', '==', 'signup').limit(50000).get(),
      userEvents.where('eventType', '==', 'login').limit(200000).get(),
      userEvents.where('eventType', '==', 'promo_claimed').limit(50000).get(),
    ]);
    signupsScanSize = signupsSnap.size;
    loginsScanSize = loginsSnap.size;
    promosScanSize = promosSnap.size;
    for (const d of signupsSnap.docs) {
      const ts = (d.data() as { timestamp?: string }).timestamp ?? '';
      if (ts >= todayIso) signupsToday += 1;
      if (ts >= weekIso) signupsWeek += 1;
    }
    for (const d of loginsSnap.docs) {
      const ts = (d.data() as { timestamp?: string }).timestamp ?? '';
      if (ts >= todayIso) loginsToday += 1;
      if (ts >= weekIso) loginsWeek += 1;
    }
    for (const d of promosSnap.docs) {
      const ts = (d.data() as { timestamp?: string }).timestamp ?? '';
      if (ts >= todayIso) promoClaimsToday += 1;
    }
    logger.info('metrics.user_events_scan_ok', {
      context: { signupsScanSize, loginsScanSize, promosScanSize, signupsToday, loginsToday, promoClaimsToday },
    });
  } catch (err) {
    logger.warn('metrics.user_events_scan_failed', { err });
  }

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

  // Withdrawal volume (sum of approved+pending). Now uses a single-
  // field where on `status` per bucket — auto-indexed, no truncation
  // possible up to the (generous) limit. Old version was an orderBy
  // scan with a 2k limit that undercounted as soon as we crossed 2k
  // withdrawal docs.
  let totalVolume = 0;
  try {
    const [appSnap, pendSnap] = await Promise.all([
      withdrawals.where('status', '==', 'approved').limit(50000).get(),
      withdrawals.where('status', '==', 'pending').limit(50000).get(),
    ]);
    for (const d of [...appSnap.docs, ...pendSnap.docs]) {
      const amt = (d.data() as { amount?: number }).amount;
      if (typeof amt === 'number' && Number.isFinite(amt)) totalVolume += amt;
    }
  } catch (err) {
    logger.warn('metrics.withdrawal_volume_scan_failed', { err });
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
  ] = await Promise.all([
    count(userEvents.where('eventType', '==', 'login')),
    // pass_purchased lives in v2_activity_events with field `type` (not
    // `eventType`). Reading from v2_user_events returned 0 forever.
    count(activityEvents.where('type', '==', 'pass_purchased')),
  ]);
  // NOTE: lifetime "promos claimed" is NOT counted from the promo_claimed event
  // log (fire-and-forget writes drop — it undercounted 28 vs a true ~506). It's
  // derived below from the canonical per-promo claimCount sum (same source as
  // promoBreakdown), so the headline KPI agrees with its own breakdown.
  // Drafts completed lives in the Go API, not Firestore — there's no
  // v2_drafts collection. The queues' completed-round counts are the
  // closest local proxy (already computed below as jackpot/hof
  // breakdowns), so leave a placeholder 0 here and surface it from a
  // dedicated source in a later pass.
  const draftsCompletedLifetime = 0;

  // Withdrawals paid volume (lifetime). Same single-field where +
  // generous limit pattern as totalVolume above. Sums across both
  // `paid` and `completed` statuses — historical records use the
  // older 'paid' label, the current path writes 'completed'.
  let withdrawalsPaidVolume = 0;
  try {
    const [paidSnap, completedSnap] = await Promise.all([
      withdrawals.where('status', '==', 'paid').limit(50000).get(),
      withdrawals.where('status', '==', 'completed').limit(50000).get(),
    ]);
    for (const d of [...paidSnap.docs, ...completedSnap.docs]) {
      const amt = (d.data() as { amount?: number }).amount;
      if (typeof amt === 'number' && Number.isFinite(amt)) withdrawalsPaidVolume += amt;
    }
  } catch (err) {
    logger.warn('metrics.withdrawal_paid_volume_scan_failed', { err });
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
  for (const seg of allKnownSegmentsById.values()) {
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
  let wheelScanSize = 0;
  let wheelLegacyDocs = 0;  // spins that don't match any known prize shape — surfaces in UI so the math reconciles with totalSpins.
  try {
    // NO orderBy + NO limit (or limit set well above today's volume).
    // collectionGroup('wheelSpins').orderBy('timestamp') needs a per-
    // collection-group index that doesn't exist, so we walk every doc
    // sans-ordering — counts don't need an order. We previously capped
    // this at 2000 docs which already exceeds today's 424 total, but
    // Boris pointed out the per-prize breakdown summed to 169 — the
    // gap (255) is real spins whose doc shape doesn't match the
    // current `prize: {type, value}` schema (legacy spins). We now
    // surface that gap as a "Legacy / unknown" row so the breakdown
    // ALWAYS sums to totalSpins. Limit 50k is 100× headroom for the
    // wheel system; raise if we ever approach.
    const spinSnap = await wheelSpinsGroup.limit(50000).get();
    wheelScanSize = spinSnap.size;
    for (const d of spinSnap.docs) {
      // Verified shapes from staging (scripts/inspect-promo-and-wheel-shapes.mjs):
      //   LIVE (current):  prize: { type: 'draft_pass', value: 1|5|10|20 }, result: segment.id
      //   LIVE (current):  prize: { type: 'custom', value: 'jackpot' | 'hof' }
      //   SEED (every new user gets seeded 5 mock spins):
      //     prize: { type: 'drafts', amount: 1|5|10 }   ← plural + `amount`
      //     prize: { type: 'jackpot' }                  ← bare, no value
      //     prize: { type: 'hof' }                      ← bare, no value
      // Boris's "Legacy / unknown 255" was the union of the 3 seed
      // shapes. We now parse all five canonically.
      const data = d.data() as {
        prize?: { type?: string; value?: unknown; amount?: unknown };
        result?: string;
        timestamp?: string;
        date?: string;  // seed shape uses `date` not `timestamp`
      };
      const prizeType = data.prize?.type ?? '';
      const prizeValue = data.prize?.value;
      const prizeAmount = data.prize?.amount;
      const tsIso = typeof data.timestamp === 'string'
        ? data.timestamp
        : (typeof data.date === 'string' ? data.date : '');
      const isToday = tsIso >= todayIso;
      if (isToday) spinsToday += 1;
      let label: string | null = null;

      // 1. Live shape: prize.type=draft_pass + numeric prize.value
      if (prizeType === 'draft_pass' && typeof prizeValue === 'number') {
        label = `${prizeValue} free draft${prizeValue === 1 ? '' : 's'}`;
        totalFreeDraftsFromWheel += prizeValue;
        if (isToday) freeDraftsFromWheelToday += prizeValue;
        draftPassAwards += 1;
        draftPassesAwardedTotal += prizeValue;

      // 2. Seed shape: prize.type='drafts' (plural) + numeric prize.amount
      } else if (prizeType === 'drafts' && typeof prizeAmount === 'number') {
        label = `${prizeAmount} free draft${prizeAmount === 1 ? '' : 's'}`;
        totalFreeDraftsFromWheel += prizeAmount;
        if (isToday) freeDraftsFromWheelToday += prizeAmount;
        draftPassAwards += 1;
        draftPassesAwardedTotal += prizeAmount;

      // 3. Live shape: prize.type=custom + prize.value='jackpot'|'hof'
      } else if (prizeType === 'custom' && prizeValue === 'jackpot') {
        label = 'Jackpot entry';
        jackpotHits += 1;
      } else if (prizeType === 'custom' && prizeValue === 'hof') {
        label = 'HOF entry';
        hofHits += 1;

      // 4. Seed shape: bare prize.type='jackpot' / 'hof'
      } else if (prizeType === 'jackpot') {
        label = 'Jackpot entry';
        jackpotHits += 1;
      } else if (prizeType === 'hof') {
        label = 'HOF entry';
        hofHits += 1;

      } else if (prizeType === 'nothing') {
        label = 'Nothing';
      } else if (typeof data.result === 'string' && data.result.trim()) {
        // Result-string only fallback (legacy free-form `result`).
        const r = data.result.trim().toLowerCase();
        if (r.includes('jackpot')) { label = 'Jackpot entry'; jackpotHits += 1; }
        else if (r.includes('hof')) { label = 'HOF entry'; hofHits += 1; }
        else {
          const m = r.match(/^(\d+)/);
          if (m) {
            const n = parseInt(m[1], 10);
            label = `${n} free draft${n === 1 ? '' : 's'}`;
            totalFreeDraftsFromWheel += n;
            if (isToday) freeDraftsFromWheelToday += n;
            draftPassAwards += 1;
            draftPassesAwardedTotal += n;
          }
        }
      }
      if (label === null) {
        // Should never happen now — every doc on staging maps to one
        // of the five known shapes. Surfaces in UI if it ever does so
        // we catch a new schema variant early.
        label = 'Legacy / unknown';
        wheelLegacyDocs += 1;
      }
      if (!wheelPrizeBreakdown[label]) wheelPrizeBreakdown[label] = { today: 0, total: 0 };
      wheelPrizeBreakdown[label].total += 1;
      if (isToday) wheelPrizeBreakdown[label].today += 1;
    }
    logger.info('metrics.wheel_scan_ok', {
      context: {
        scanned: wheelScanSize,
        spinsTodayCounted: spinsToday,
        jackpotHits,
        hofHits,
        draftPassAwards,
        totalFreeDraftsFromWheel,
        legacyDocs: wheelLegacyDocs,
      },
    });
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
    // Was limit(2000) — bumped to 50k so every user's JP/HOF reservation
    // counts, not just the most-recent 2k signups. (Today: ~200 users.)
    const userSnap = await users.orderBy('createdAt', 'desc').limit(50000).get();
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

  // Promo breakdown by type. Earlier we ran two compound queries —
  // `where(eventType=promo_claimed).where(timestamp>=)` and
  // `where(eventType=).orderBy(timestamp)` — both needing the same
  // (eventType, timestamp) composite index that doesn't exist, so both
  // threw and the dashboard showed 0.
  //
  // First fix used a single orderBy(timestamp).limit(5000), which works
  // index-wise but undercounts on staging where total user_events has
  // crossed 5k — older claims fall off the bottom. Boris caught this
  // (mint showed 11 lifetime; he and Richard alone have ~that many).
  //
  // Real fix: scan with a single-field where (auto-indexed, no
  // composite required) plus a hefty doc limit + cross-source merge
  // from v2_activity_events which also writes promo_claimed events.
  // Promo IDs are unique per (user, type) so we dedupe by doc id to
  // avoid double-counting when both collections recorded the same
  // claim.
  // Promo breakdown — sourced from the canonical claimCount field on
  // the promo doc (atomic, transaction-guaranteed). Previous version
  // counted promo_claimed events from v2_user_events, which uses
  // fire-and-forget writes that drop — Boris caught it: mint showed
  // 11 lifetime when the true claimCount sum was 35 (some users had
  // 9 mint claims each that never reached the event log).
  //
  // See lib/admin/metricSources.ts for the canonical-source table.
  const promoBreakdown: Record<string, { claimsToday: number; claimsTotal: number }> = {};
  try {
    const { readPromoCounts } = await import('@/lib/admin/metricSources');
    const { byType, diag } = await readPromoCounts({ todayIso });
    for (const [t, c] of Object.entries(byType)) {
      promoBreakdown[t] = { claimsToday: c.claimsToday, claimsTotal: c.claimsTotal };
    }
    logger.info('metrics.promo_breakdown_ok', {
      context: {
        uniqueTypes: Object.keys(promoBreakdown).length,
        totalClaims: Object.values(promoBreakdown).reduce((s, v) => s + v.claimsTotal, 0),
        promoDocsScanned: diag.promoDocs,
        eventsLifetimeScanned: diag.eventsLifetime,
        eventsTodayScanned: diag.eventsToday,
      },
    });
  } catch (err) {
    logger.warn('metrics.promo_breakdown_failed', { err });
  }

  // ── Activity-events: revenue + drafts-entered + drafters-without-
  //    promos. Each metric runs as its own single-field where so the
  //    auto-index handles it, then we bucket by day client-side. No
  //    composite indexes needed, no compound-where silent-zero trap,
  //    each scan limited 50k (100× current staging volume).
  let totalRevenueUsd = 0;
  let revenueTodayUsd = 0;
  let draftsEnteredTotal = 0;
  let draftsEnteredToday = 0;
  const drafters = new Set<string>();
  const promoClaimers = new Set<string>();
  try {
    const [purchSnap, enterSnap, claimSnap] = await Promise.all([
      activityEvents.where('type', '==', 'pass_purchased').limit(50000).get(),
      activityEvents.where('type', '==', 'draft_entered').limit(50000).get(),
      activityEvents.where('type', '==', 'promo_claimed').limit(50000).get(),
    ]);
    for (const d of purchSnap.docs) {
      const data = d.data() as { metadata?: Record<string, unknown>; createdAtIso?: string };
      const price = Number(data.metadata?.totalPrice);
      if (!Number.isFinite(price)) continue;
      totalRevenueUsd += price;
      if ((data.createdAtIso ?? '') >= todayIso) revenueTodayUsd += price;
    }
    for (const d of enterSnap.docs) {
      const data = d.data() as { userId?: string; createdAtIso?: string };
      draftsEnteredTotal += 1;
      if ((data.createdAtIso ?? '') >= todayIso) draftsEnteredToday += 1;
      const userId = (data.userId ?? '').toLowerCase();
      if (userId) drafters.add(userId);
    }
    for (const d of claimSnap.docs) {
      const userId = ((d.data() as { userId?: string }).userId ?? '').toLowerCase();
      if (userId) promoClaimers.add(userId);
    }
    logger.info('metrics.activity_scan_ok', {
      context: {
        purchases: purchSnap.size,
        enters: enterSnap.size,
        claims: claimSnap.size,
        totalRevenueUsd,
        draftsEnteredTotal,
      },
    });
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
      promosClaimed: Object.values(promoBreakdown).reduce((s, v) => s + v.claimsTotal, 0),
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
    draftsEnteredToday,
    draftsEnteredTotal,
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
