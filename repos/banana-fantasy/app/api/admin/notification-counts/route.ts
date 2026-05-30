import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import type { Firestore } from 'firebase-admin/firestore';

import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, getAdminDatabase } from '@/lib/firebaseAdmin';
import { fetchRecentErrors } from '@/lib/errorEvents';
import { isTestNoiseError } from '@/lib/logSources';
import { listConversations } from '@/lib/crispApi';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

// Per-category "last seen" timestamps (Unix ms). Each category's count
// only includes items newer than its corresponding `since` value. Set
// to 0 (or omit) to count everything. `support` and `withdrawals` are
// state-driven (unread / pending) and ignore `since`.
interface Since {
  logs?: number;
  kyc?: number;
  offramp?: number;
  onramp?: number;
  purchases?: number;
  drafts?: number;
}

export interface NotificationCounts {
  support: number;       // Crisp unread conversations
  logs: number;          // important v2_error_events + unresolved Sentry issues since `logs`
  kyc: number;           // kyc_attempts in review states since `kyc`
  offramp: number;       // offramp_attempts with failure status since `offramp`
  onramp: number;        // onramp_attempts tx_failed since `onramp`
  withdrawals: number;   // withdrawalRequests pending (no since filter)
  purchases: number;     // failed_mints since `purchases`
  drafts: number;        // drafts in filling >24h with players
}

export interface NotificationCountsResponse {
  counts: NotificationCounts;
  requestId?: string;
}

const STUCK_DRAFT_MS = 24 * 60 * 60 * 1000;

const KYC_REVIEW_STATUSES = ['name_mismatch', 'dob_mismatch', 'blocked', 'error'];

// Error events worth waking the admin up for. Anything matching these
// patterns counts toward the badge; everything else still shows in the
// full Server Errors tab but doesn't trigger a notification.
//
// Rules of thumb:
//   - User-money flows (mints, prizes, withdrawals) are always important
//   - "unhandled" by definition = unexpected = important
//   - Webhook / config errors that break inbound flows
//   - Anything blocking treasury operations
//
// Noise we explicitly skip:
//   - admin.* read-endpoint failures (called by bots, scrapers, transient)
//   - crisp.* (Crisp API hiccups, retries handle it)
//   - [team-nicknames] / [user-positional-limits] / [WS] (UI/transport flake)
//   - debug.*, spectate.*, founder-schedule.* (internal tooling)
const IMPORTANT_ERROR_PATTERNS: RegExp[] = [
  /mint_failed/i,
  /transferFrom_failed/i,
  /\.unhandled$/i,
  /admin_wallet_low_balance/i,
  /skim\.(transfer|withdraw)_failed/i,
  /alchemy\.webhook/i,
  /jackpot[-_]reveal\.failed/i,
  /^batches\.(current|proof)\.failed$/i,
  /^card-mint\./i,
  /^wheel\.spin\./i,
  /^promo\.claim\./i,
  /privy\.fetch_user\.error/i,
  /^admin\.(grant_drafts|grant_prize|kyc_verify|reconcile_passes|retry_purchase|withdrawal_status|transfer_batchproof|deploy_batch_proof|revoke7702|user_ban|set_entries|zero_free_drafts|reset_user|reset_queue)\.failed$/i,
  // Draft-room user-impact signals — anything WS/REST related to
  // drafts blocking play. ws.connect_failed catches the kind of
  // 401 freeze we hit on May 12, 2026.
  /^ws\./i,
  /^draft\.(pick|state)_error/i,
  /^draft\.autopick_failed/i,
  // Draft money + blocking gaps (Phase 1 coverage). Note: `^ws\.` does NOT
  // match `draft.ws.*`, and `autopick_failed` does NOT match
  // `autopick_submit_failed` — so these are listed explicitly.
  /^draft\.leave/i,
  /^draft\.join_refund/i,
  /^draft\.autopick_submit_failed/i,
  /^draft\.ws\.message_parse_failed/i,
  /^draft\.queue\.create_draft_failed/i,
  // Notification system failures — user-facing impact (they miss a
  // "your draft is starting" or "it's your pick" alert). Every channel
  // failure + the silent-success-but-zero-recipients case should raise
  // the admin badge so the team can DM the user proactively.
  /^notifications\./i,
  // Bridged Go-service errors from /api/crons/sync-cloud-errors. The
  // bridge already filters to severity>=ERROR and tries to classify
  // common Go failure modes — anything that gets through is worth a
  // badge. Added after the 2026-05-12 outage where a 1.92 MB Firestore
  // doc-size error logged loudly to Cloud Logging but never reached
  // admin because there was no Go→admin bridge.
  /^backend\./i,
  // Legacy Go bridge format (`go:{service}/{revision}`). Older entries
  // and any future writer that hasn't been updated to the new
  // `backend.api.error` shape still light up the badge — better to be
  // noisy than miss a real outage. Added 2026-05-17.
  /^go:/i,
];

function isImportantError(source: string | undefined): boolean {
  if (!source) return false;
  return IMPORTANT_ERROR_PATTERNS.some((p) => p.test(source));
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    let since: Since = {};
    try {
      const sinceParam = new URL(req.url).searchParams.get('since');
      if (sinceParam) since = JSON.parse(sinceParam);
    } catch {
      // Bad JSON → treat as no filter
    }

    const db = getAdminFirestore();
    const stuckBefore = new Date(Date.now() - STUCK_DRAFT_MS).toISOString();

    const [
      support,
      errors,
      sentry,
      kyc,
      offramp,
      onramp,
      withdrawals,
      purchases,
      drafts,
    ] = await Promise.all([
      countSupport(),
      countErrors(since.logs ?? 0),
      countSentryUnresolved(since.logs ?? 0),
      countKyc(db, since.kyc ?? 0),
      countOfframp(db, since.offramp ?? 0),
      countOnramp(db, since.onramp ?? 0),
      countPendingWithdrawals(db),
      countFailedPurchases(db, since.purchases ?? 0),
      countStuckDrafts(db, stuckBefore),
    ]);

    // The Logs tab merges server errors + Sentry issues into one feed,
    // so the badge is their combined count.
    const counts: NotificationCounts = {
      support, logs: errors + sentry, kyc, offramp, onramp, withdrawals, purchases, drafts,
    };

    logger.info('admin.notif_counts.ok', {
      requestId,
      counts,
      durationMs: Date.now() - start,
    });

    return json({ counts, requestId } as NotificationCountsResponse);
  } catch (err) {
    logger.error('admin.notif_counts.failed', { requestId, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}

// ─── Per-category counters (each defensively wrapped) ──────────────

async function countSupport(): Promise<number> {
  try {
    const { conversations } = await listConversations({ filterUnread: true });
    return conversations.reduce((sum, c) => {
      const unread = typeof c.unread === 'number' ? c.unread : (c.unread?.operator ?? 0);
      return sum + (unread > 0 ? 1 : 0);
    }, 0);
  } catch { return 0; }
}

async function countSentryUnresolved(since: number): Promise<number> {
  try {
    const token = process.env.SENTRY_AUTH_TOKEN;
    if (!token) return 0;
    const org = process.env.SENTRY_ORG || 'sbs-ti';
    const project = process.env.SENTRY_PROJECT_SLUG || 'javascript-nextjs';
    // Last 24h of unresolved issues — keeps the badge bounded to
    // "recently broken" instead of every issue ever logged.
    const url = `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?statsPeriod=24h&limit=100&query=is%3Aunresolved`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    const raw = (await res.json()) as Array<{ lastSeen?: string }>;
    return raw.filter((r) => {
      const t = r.lastSeen ? new Date(r.lastSeen).getTime() : 0;
      return t > since;
    }).length;
  } catch { return 0; }
}

async function countErrors(since: number): Promise<number> {
  try {
    const records = await fetchRecentErrors(500);
    return records.filter((r) => {
      const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
      if (t <= since) return false;
      // Automated-test traffic (fake draft ids / wallets) is real 500s
      // but not user-facing — never badge it.
      if (isTestNoiseError(r)) return false;
      // Only "important" errors (real bugs / user-money / ops issues)
      // trigger the badge. Noisy admin-read and Crisp-API failures
      // still show in the Error Log tab but don't ping the admin.
      return isImportantError(r.source);
    }).length;
  } catch { return 0; }
}

async function countKyc(db: Firestore, since: number): Promise<number> {
  try {
    // Firestore can't mix `in` with `where('timestamp', '>')` without a
    // composite index, so we filter timestamp client-side. Cap at 200
    // rows — anything beyond that the admin should see in the tab itself.
    const snap = await db
      .collection('kyc_attempts')
      .where('status', 'in', KYC_REVIEW_STATUSES)
      .orderBy('timestamp', 'desc')
      .limit(200)
      .get();
    return snap.docs.filter((d) => {
      const ts = d.data().timestamp;
      const t = typeof ts === 'string' ? new Date(ts).getTime() : 0;
      return t > since;
    }).length;
  } catch { return 0; }
}

async function countOfframp(db: Firestore, since: number): Promise<number> {
  try {
    const snap = await db
      .collection('offramp_attempts')
      .where('status', '==', 'failed')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    return snap.docs.filter((d) => {
      const ts = d.data().createdAt;
      const t = typeof ts === 'string' ? new Date(ts).getTime() : 0;
      return t > since;
    }).length;
  } catch { return 0; }
}

async function countOnramp(db: Firestore, since: number): Promise<number> {
  try {
    const snap = await db
      .collection('onramp_attempts')
      .where('status', '==', 'tx_failed')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    return snap.docs.filter((d) => {
      const ts = d.data().createdAt;
      const t = typeof ts === 'string' ? new Date(ts).getTime() : 0;
      return t > since;
    }).length;
  } catch { return 0; }
}

async function countPendingWithdrawals(db: Firestore): Promise<number> {
  try {
    const snap = await db
      .collection('withdrawalRequests')
      .where('status', '==', 'pending')
      .limit(200)
      .get();
    return snap.size;
  } catch { return 0; }
}

async function countFailedPurchases(db: Firestore, since: number): Promise<number> {
  try {
    const sinceIso = new Date(since).toISOString();
    const snap = await db
      .collection('failed_mints')
      .where('createdAt', '>', sinceIso)
      .limit(200)
      .get();
    return snap.size;
  } catch {
    // Fallback: no createdAt index → grab everything and filter client-side
    try {
      const snap = await db.collection('failed_mints').limit(200).get();
      return snap.docs.filter((d) => {
        const ts = d.data().createdAt;
        const t = typeof ts === 'string' ? new Date(ts).getTime() : 0;
        return t > since;
      }).length;
    } catch { return 0; }
  }
}

async function countStuckDrafts(db: Firestore, stuckBeforeIso: string): Promise<number> {
  // Detect stuck drafts via the REAL schema. The earlier version
  // queried `drafts.status` but that field doesn't exist on the
  // actual `drafts/{id}` docs (they only carry league metadata —
  // ADP, DraftType, CurrentUsers, etc). That query silently
  // returned zero forever, which is why draft 808's pick-49 freeze
  // on 2026-05-17 never lit up the admin badge.
  //
  // New detection uses the source of truth that's actually written
  // every pick: RTDB `drafts/{leagueId}/realTimeDraftInfo.PickEndTime`
  // is updated each time the next pick's timer starts. If now is
  // more than 60s past that timestamp AND the draft isn't complete,
  // the draft is genuinely stuck — the timer should have advanced.
  //
  // We bound the work by reading the draftTracker doc to know how
  // many active draft ids exist, then point-checking each one's
  // RTDB realTimeDraftInfo. Cheap: ~one RTDB read per active draft.
  const stalledBeforeMs = Date.now() / 1000 - 60; // PickEndTime is unix seconds, allow 60s grace
  let total = 0;

  try {
    // Tracker tells us the highest in-use draft id per (year, speed).
    // We scan back a small window so finished older drafts don't
    // accidentally count — RecoverActiveDrafts uses the same pattern.
    const trackerDoc = await db.collection('drafts').doc('draftTracker').get();
    if (!trackerDoc.exists) return 0;
    const tracker = trackerDoc.data() || {};
    const liveCount = Number(tracker.currentLiveDraftCount || 0);
    const slowCount = Number(tracker.currentScheduledDraftCount || 0);

    // Look back 20 drafts per speed — fast drafts complete in ~25 min
    // so anything that started in the last few hours is in this range.
    // Older drafts are either done (caught by IsDraftComplete in RTDB)
    // or genuinely abandoned (no badge needed, admin can scan manually).
    const LOOKBACK = 20;
    const ids: string[] = [];
    for (let n = Math.max(1, liveCount - LOOKBACK); n <= liveCount; n++) {
      ids.push(`2024-fast-draft-${n}`);
      ids.push(`2025-fast-draft-${n}`);
    }
    for (let n = Math.max(1, slowCount - LOOKBACK); n <= slowCount; n++) {
      ids.push(`2024-slow-draft-${n}`);
      ids.push(`2025-slow-draft-${n}`);
    }

    // Use RTDB realTimeDraftInfo as the freshness check. We hit
    // Firestore state/info as a fallback for older drafts whose RTDB
    // entry may have aged out — both writes happen on every pick.
    const rtdb = getAdminDatabase();
    const results = await Promise.all(
      ids.map(async (draftId) => {
        try {
          const snap = await rtdb.ref(`drafts/${draftId}/realTimeDraftInfo`).get();
          if (!snap.exists()) return false;
          const rt = snap.val() as {
            IsDraftComplete?: boolean;
            CurrentPickNumber?: number;
            PickEndTime?: number;
          };
          if (rt.IsDraftComplete) return false;
          if (!rt.PickEndTime || rt.PickEndTime <= 0) return false;
          if ((rt.CurrentPickNumber ?? 0) < 1) return false;
          if ((rt.CurrentPickNumber ?? 0) > 150) return false;
          return rt.PickEndTime < stalledBeforeMs;
        } catch {
          return false;
        }
      }),
    );
    total = results.filter(Boolean).length;
  } catch (err) {
    logger.warn('countStuckDrafts.failed', { err: err instanceof Error ? err.message : String(err) });
    return 0;
  }

  // Pre-existing lobby-stuck check (≥1 joiner, sat >24h) — keep the
  // collection-scan version since lobby docs DO have a status field
  // in the v2_drafts / draftRooms collections. Silent-fail per
  // collection so a schema mismatch in one doesn't kill the others.
  const FILLING = ['pending', 'waiting', 'lobby', 'filling'];
  const lobbyCollections = ['v2_drafts', 'draftRooms'];
  await Promise.all(
    lobbyCollections.map(async (col) => {
      try {
        const fillingSnap = await db
          .collection(col)
          .where('status', 'in', FILLING)
          .limit(200)
          .get();
        for (const d of fillingSnap.docs) {
          const data = d.data();
          const playerCount: number = data.playerCount
            || (Array.isArray(data.participants) ? data.participants.length : 0);
          if (playerCount < 1) continue;
          const createdIso = toIsoString(data.createdAt);
          if (!createdIso) continue;
          if (createdIso < stuckBeforeIso) total += 1;
        }
      } catch { /* schema mismatch — skip */ }
    }),
  );

  return total;
}

// Coerce common Firestore date shapes into an ISO string, or null.
function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value || null;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    } catch { return null; }
  }
  return null;
}
