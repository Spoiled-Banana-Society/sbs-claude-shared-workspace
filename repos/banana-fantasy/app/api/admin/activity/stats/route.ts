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

const LAUNCH_ISO = '2026-06-23T00:00:00.000Z';
const DAY_START_HOUR_PT = 3;

/** ISO instant of the most recent 3:00 AM Pacific. */
function sbsDayStartIso(now = new Date()): string {
  // Get the current wall-clock parts in LA (handles PDT/PST automatically).
  const la = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  // LA date, possibly rolled back a day if before 3am LA time.
  let y = Number(la.year), m = Number(la.month), d = Number(la.day);
  if (Number(la.hour) < DAY_START_HOUR_PT) {
    const rolled = new Date(Date.UTC(y, m - 1, d));
    rolled.setUTCDate(rolled.getUTCDate() - 1);
    y = rolled.getUTCFullYear(); m = rolled.getUTCMonth() + 1; d = rolled.getUTCDate();
  }

  // Find the UTC instant when LA wall-clock hits 3:00 on (y,m,d): LA is
  // UTC-7 (PDT) or UTC-8 (PST); try both and keep the one that round-trips.
  for (const offset of [7, 8]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR_PT + offset, 0, 0));
    const check = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false, day: '2-digit',
    }).formatToParts(candidate).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    if (Number(check.hour) === DAY_START_HOUR_PT && Number(check.day) === d) return candidate.toISOString();
  }
  // Unreachable fallback: UTC-7.
  return new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR_PT + 7, 0, 0)).toISOString();
}

interface Bucket {
  purchases: number;
  passesBought: number;
  purchaseUsd: number;
  newAccounts: number;
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
    newAccounts: 0, logins: 0,
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

export async function GET(req: Request) {
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
    for (const doc of snap.docs) {
      const e = doc.data();
      fold(total, e, totalLeagues);
      if (typeof e.createdAtIso === 'string' && e.createdAtIso >= dayStartIso) {
        fold(today, e, todayLeagues);
      }
    }
    // Leaves can outnumber enters inside a window edge — floor at 0 for sanity.
    total.draftEntries = Math.max(0, total.draftEntries);
    today.draftEntries = Math.max(0, today.draftEntries);

    return json({
      dayStartIso,
      launchIso: LAUNCH_ISO,
      scanned: snap.size,
      truncated: snap.size >= SCAN_CAP,
      today,
      total,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.activity.stats.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
