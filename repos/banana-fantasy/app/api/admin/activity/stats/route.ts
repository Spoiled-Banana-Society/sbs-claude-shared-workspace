import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/activity/stats
 *
 * Accurate TODAY + SINCE-LAUNCH counters for the admin Activity page. The
 * live-stream stat cards used to compute over the SSE window (latest 100
 * events) — once log-ins/signups started emitting events, purchases scrolled
 * out of the window within hours and "Purchases (24h)" undercounted badly
 * (Boris 2026-07-03: "7 makes no sense, it was more").
 *
 * "Today" = the SBS business day: starts 03:00 America/Los_Angeles (Boris
 * keeps late hours — a 1am purchase belongs to the evening's day, not
 * "tomorrow"). Totals = since public launch (2026-06-23) so pre-launch test
 * traffic never pollutes the numbers.
 */

// Day boundary + launch anchor shared with /api/admin/metrics via lib/sbsDay —
// both surfaces MUST agree on what "today" means or the dashboard and the
// audit cards drift apart.
import { LAUNCH_ISO, sbsDayStartIso } from '@/lib/sbsDay';
import { isReturningWalletSync } from '@/lib/returningUsers';
import { getAdminBellWallets } from '@/lib/adminAllowlist';
import { readBbb4Treasury } from '@/lib/onchain/skimBbb4Usdc';

// Canonical "actual money on hand" = live BBB4 contract USDC + cold treasury
// USDC − $700 (the flat adjustment Boris tracks; same formula as the Money tab's
// "Actual total (−$700)" in ContractTreasuryPanel). This is REAL money held, not
// gross ticket sales (passesBought × $25). Cached ~60s so the 30s admin polls
// don't hammer the Base RPC; falls back to the last good value on RPC failure.
const MONEY_TTL_MS = 60_000;
let moneyCache: { at: number; usd: number | null } = { at: 0, usd: null };
async function getActualMoneyUsd(now: number): Promise<number | null> {
  if (moneyCache.usd !== null && now - moneyCache.at < MONEY_TTL_MS) return moneyCache.usd;
  try {
    const snap = await readBbb4Treasury();
    const net = BigInt(snap.contractUsdc || '0') + BigInt(snap.treasuryUsdc || '0') - 700_000_000n;
    const usd = Number(net) / 1e6;
    moneyCache = { at: now, usd };
    return usd;
  } catch {
    return moneyCache.usd; // last-known on a transient RPC hiccup
  }
}

// Wallets that must never count as customers: every team/admin wallet plus
// legacy team wallets that predate the allowlist (Boris's old Privy login,
// Richard's r8 test wallet). "Unique buyers" is a REAL-customer metric.
const EXTRA_TEAM_WALLETS = [
  '0xd3301bc039faf4223da98bceb5fb81abc9399362', // Boris old Privy login
  '0xbd2e09c009a7834cd32f9fa8a87073c5b3083f11', // Richard test wallet (r8)
];

interface Bucket {
  purchases: number;
  passesBought: number;
  purchaseUsd: number;
  newAccounts: number;
  /** Of newAccounts: how many are returning players (past-season identity).
   *  In `total` this is ALL returning-player accounts. */
  returningNewAccounts: number;
  /** Of newAccounts: signed up via Privy social (Gmail/X → embedded wallet). */
  web2NewAccounts: number;
  /** Of newAccounts: came in with their own crypto wallet. */
  web3NewAccounts: number;
  logins: number;
  spins: number;
  freeDraftsWonFromSpins: number;
  jpPassesFromSpins: number;
  hofPassesFromSpins: number;
  draftsFilled: number;      // distinct leagues that hit 10/10
  draftEntries: number;      // seat entries (enter events minus leaves)
  promosClaimed: number;
}

function emptyBucket(): Bucket {
  return {
    purchases: 0, passesBought: 0, purchaseUsd: 0,
    newAccounts: 0, returningNewAccounts: 0, web2NewAccounts: 0, web3NewAccounts: 0, logins: 0,
    spins: 0, freeDraftsWonFromSpins: 0, jpPassesFromSpins: 0, hofPassesFromSpins: 0,
    draftsFilled: 0, draftEntries: 0, promosClaimed: 0,
  };
}

/** Fold one event into a bucket. `filledLeagues` dedupes draft_filled (one event per member). */
function fold(b: Bucket, e: FirebaseFirestore.DocumentData, filledLeagues: Set<string>): void {
  switch (e.type) {
    case 'pass_purchased': {
      b.purchases++;
      b.passesBought += Number(e.quantity) || 0;
      b.purchaseUsd += Number(e.metadata?.totalPrice) || 0;
      break;
    }
    case 'user_signed_up': b.newAccounts++; break;
    case 'user_returned': b.logins++; break;
    case 'spin_won': {
      b.spins++;
      const m = e.metadata ?? {};
      if (m.prizeType === 'draft_pass') b.freeDraftsWonFromSpins += Number(m.prizeValue) || 0;
      else if (m.prizeValue === 'jackpot') b.jpPassesFromSpins++;
      else if (m.prizeValue === 'hof') b.hofPassesFromSpins++;
      break;
    }
    case 'draft_filled': {
      // One event per MEMBER of the filled draft — dedupe by draftId.
      const lid = String(e.metadata?.draftId ?? e.metadata?.leagueId ?? '');
      if (lid && !filledLeagues.has(lid)) { filledLeagues.add(lid); b.draftsFilled++; }
      break;
    }
    case 'draft_entered': b.draftEntries++; break;
    case 'draft_left': b.draftEntries--; break;
    case 'promo_claimed': b.promosClaimed++; break;
  }
}

export async function GET(_req: Request) {
  // RETIRED (2026-09-01, cost audit): this endpoint scanned up to 120k docs
  // per call (20k activity events + 50k wheelSpins + 50k promo claims) and
  // was auto-polled every 30-45s by the Dashboard/Live Activity tabs. Those
  // tabs are gone, but STALE admin tabs running old bundles keep polling —
  // 410 with zero Firestore work is what stops them from billing us.
  // The scan code below is kept for a future one-shot admin tool.
  return jsonError('Gone — dashboard stats retired (cost audit 2026-09-01)', 410);
}

// Legacy implementation, unexported — kept for a future one-shot admin tool.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _legacyStats(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Not configured', 503);

  try {
    await requireAdmin(req);

    const db = getAdminFirestore();
    const dayStartIso = sbsDayStartIso();

    // ONE ordered scan since launch covers both buckets (all-time volume is
    // a few thousand docs at current scale — revisit with pagination when
    // that 10x's; the scan is capped and we report if it truncates).
    const SCAN_CAP = 20_000;
    const snap = await db
      .collection(ACTIVITY_EVENTS_COLLECTION)
      .where('createdAtIso', '>=', LAUNCH_ISO)
      .orderBy('createdAtIso', 'asc')
      .limit(SCAN_CAP)
      .get();

    const total = emptyBucket();
    const today = emptyBucket();
    const totalLeagues = new Set<string>();
    const todayLeagues = new Set<string>();
    // Distinct REAL customers who bought ≥1 pass (team wallets excluded) —
    // Boris 2026-07-03: "how many unique users bought at least 1, total vs daily".
    const teamWallets = new Set([...getAdminBellWallets(), ...EXTRA_TEAM_WALLETS].map((w) => w.toLowerCase()));
    const buyersTotal = new Set<string>();
    const buyersToday = new Set<string>();
    for (const doc of snap.docs) {
      const e = doc.data();
      fold(total, e, totalLeagues);
      const isToday = typeof e.createdAtIso === 'string' && e.createdAtIso >= dayStartIso;
      if (isToday) {
        fold(today, e, todayLeagues);
      }
      if (e.type === 'pass_purchased') {
        const w = String(e.walletAddress || '').toLowerCase();
        if (w && !teamWallets.has(w)) {
          buyersTotal.add(w);
          if (isToday) buyersToday.add(w);
        }
      }
    }
    // Leaves can outnumber enters inside a window edge — floor at 0 for sanity.
    total.draftEntries = Math.max(0, total.draftEntries);
    today.draftEntries = Math.max(0, today.draftEntries);

    // ── AUTHORITATIVE OVERRIDES ─────────────────────────────────────────
    // Event-derived counts are only as old as each event type — user_signed_up
    // began 2026-07-03, spin_won misses seeds, promo_claimed undercounts. For
    // those buckets the real records are cheap to read, so the records win
    // (Boris 2026-07-03: "we had 25 new accounts just today??" — real answer
    // was 11). Purchases / drafts filled / entries stay event-based: their
    // events have run since launch and match the money.

    // New accounts: v2_users is the record of truth (createdAt = ISO string).
    // Same source as the dashboard Users box, so the two can never disagree.
    const usersColl = db.collection('v2_users');
    // walletType tags the signup rail: privy_embedded = social login (Gmail/X,
    // we made them a wallet) = "web2"; privy_external / external_connect =
    // brought their own crypto wallet = "web3".
    const isWeb2 = (wt: string | undefined) => wt === 'privy_embedded';
    const isWeb3 = (wt: string | undefined) => wt === 'privy_external' || wt === 'external_connect';
    const [usersTotalCnt, newTodaySnap, returningTotalCnt, web2TotalCnt, web3ExtCnt, web3ConnCnt] = await Promise.all([
      usersColl.count().get(),
      usersColl.where('createdAt', '>=', dayStartIso).get(),
      usersColl.where('isReturningPlayer', '==', true).count().get(),
      usersColl.where('walletType', '==', 'privy_embedded').count().get(),
      usersColl.where('walletType', '==', 'privy_external').count().get(),
      usersColl.where('walletType', '==', 'external_connect').count().get(),
    ]);
    today.newAccounts = newTodaySnap.size;
    for (const d of newTodaySnap.docs) {
      const u = d.data() as { isReturningPlayer?: boolean; walletType?: string };
      if (u.isReturningPlayer === true) today.returningNewAccounts++;
      if (isWeb2(u.walletType)) today.web2NewAccounts++;
      else if (isWeb3(u.walletType)) today.web3NewAccounts++;
    }
    total.newAccounts = usersTotalCnt.data().count;
    total.returningNewAccounts = returningTotalCnt.data().count;
    total.web2NewAccounts = web2TotalCnt.data().count;
    total.web3NewAccounts = web3ExtCnt.data().count + web3ConnCnt.data().count;

    // Spins + wheel winnings: walk v2_users/*/wheelSpins (the record of every
    // spin — same walk as /api/admin/metrics, incl. the seed shapes). Totals
    // are lifetime to match the dashboard Spins box.
    const spinSnap = await db.collectionGroup('wheelSpins').limit(50_000).get();
    let spinsToday = 0; let fdToday = 0; let fdTotal = 0;
    let jpToday = 0; let jpTotal = 0; let hofToday = 0; let hofTotal = 0;
    for (const d of spinSnap.docs) {
      const x = d.data() as {
        prize?: { type?: string; value?: unknown; amount?: unknown };
        timestamp?: string; date?: string;
      };
      const ts = typeof x.timestamp === 'string' ? x.timestamp : (typeof x.date === 'string' ? x.date : '');
      const isToday = ts >= dayStartIso;
      if (isToday) spinsToday++;
      const pt = x.prize?.type ?? ''; const pv = x.prize?.value; const pa = x.prize?.amount;
      let fd = 0;
      if (pt === 'draft_pass' && typeof pv === 'number') fd = pv;
      else if (pt === 'drafts' && typeof pa === 'number') fd = pa;
      else if ((pt === 'custom' && pv === 'jackpot') || pt === 'jackpot') { jpTotal++; if (isToday) jpToday++; }
      else if ((pt === 'custom' && pv === 'hof') || pt === 'hof') { hofTotal++; if (isToday) hofToday++; }
      fdTotal += fd; if (isToday) fdToday += fd;
    }
    today.spins = spinsToday; total.spins = spinSnap.size;
    today.freeDraftsWonFromSpins = fdToday; total.freeDraftsWonFromSpins = fdTotal;
    today.jpPassesFromSpins = jpToday; total.jpPassesFromSpins = jpTotal;
    today.hofPassesFromSpins = hofToday; total.hofPassesFromSpins = hofTotal;

    // Promos claimed: v2_user_events promo_claimed is the complete record
    // (the activity-event copy started later and undercounts — 226 vs 366).
    const promoSnap = await db.collection('v2_user_events')
      .where('eventType', '==', 'promo_claimed').limit(50_000).get();
    let promoToday = 0;
    for (const d of promoSnap.docs) {
      if (((d.data() as { timestamp?: string }).timestamp ?? '') >= dayStartIso) promoToday++;
    }
    today.promosClaimed = promoToday;
    total.promosClaimed = promoSnap.size;

    // Buyer identity splits: gmail/social vs own-wallet signup, and returning
    // (past-season identity, flag OR wallet snapshot — same rule as the OLD
    // chips) vs brand-new. ~dozens of buyer docs, one batched getAll.
    let buyersWeb2 = 0; let buyersWeb3 = 0; let buyersUntagged = 0; let buyersReturning = 0;
    if (buyersTotal.size > 0) {
      const buyerDocs = await db.getAll(...[...buyersTotal].map((w) => db.doc(`v2_users/${w}`)));
      for (const d of buyerDocs) {
        const u = (d.exists ? d.data() : {}) as { walletType?: string; isReturningPlayer?: boolean };
        if (u.walletType === 'privy_embedded') buyersWeb2++;
        else if (u.walletType === 'privy_external' || u.walletType === 'external_connect') buyersWeb3++;
        else buyersUntagged++;
        if (u.isReturningPlayer === true || isReturningWalletSync(d.id)) buyersReturning++;
      }
    }
    const uniqueBuyers = {
      total: buyersTotal.size,
      today: buyersToday.size,
      web2: buyersWeb2,
      web3: buyersWeb3,
      untagged: buyersUntagged,
      returning: buyersReturning,
      newUsers: buyersTotal.size - buyersReturning,
    };

    const actualMoneyUsd = await getActualMoneyUsd(Date.now());

    return json({
      uniqueBuyers,
      dayStartIso,
      launchIso: LAUNCH_ISO,
      scanned: snap.size,
      truncated: snap.size >= SCAN_CAP,
      today,
      total,
      // Real money on hand (contract + treasury − $700), live on-chain. Null if
      // the RPC read failed and there's no cached value yet.
      actualMoneyUsd,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.activity.stats.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
