import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import type { Firestore } from 'firebase-admin/firestore';

import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { fetchRecentErrors } from '@/lib/errorEvents';
import { listConversations } from '@/lib/crispApi';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

// Per-category "last seen" timestamps (Unix ms). Each category's count
// only includes items newer than its corresponding `since` value. Set
// to 0 (or omit) to count everything. `support` and `withdrawals` are
// state-driven (unread / pending) and ignore `since`.
interface Since {
  errors?: number;
  kyc?: number;
  offramp?: number;
  onramp?: number;
  purchases?: number;
  drafts?: number;
}

export interface NotificationCounts {
  support: number;       // Crisp unread conversations
  errors: number;        // v2_error_events since `errors`
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
      kyc,
      offramp,
      onramp,
      withdrawals,
      purchases,
      drafts,
    ] = await Promise.all([
      countSupport(),
      countErrors(since.errors ?? 0),
      countKyc(db, since.kyc ?? 0),
      countOfframp(db, since.offramp ?? 0),
      countOnramp(db, since.onramp ?? 0),
      countPendingWithdrawals(db),
      countFailedPurchases(db, since.purchases ?? 0),
      countStuckDrafts(db, stuckBefore),
    ]);

    const counts: NotificationCounts = {
      support, errors, kyc, offramp, onramp, withdrawals, purchases, drafts,
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

async function countErrors(since: number): Promise<number> {
  try {
    const records = await fetchRecentErrors(500);
    return records.filter((r) => {
      const t = r.timestamp ? new Date(r.timestamp).getTime() : 0;
      if (t <= since) return false;
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
  // Stuck = "filling state, has at least 1 player, started filling >24h ago".
  // We probe the same collections /admin/drafts probes (drafts, v2_drafts,
  // draftRooms) and union any matches. Filling-state field names vary, so
  // we accept pending / waiting / lobby / filling.
  const FILLING = ['pending', 'waiting', 'lobby', 'filling'];
  const collections = ['drafts', 'v2_drafts', 'draftRooms'];
  let total = 0;
  await Promise.all(
    collections.map(async (col) => {
      try {
        const snap = await db
          .collection(col)
          .where('status', 'in', FILLING)
          .limit(200)
          .get();
        const count = snap.docs.filter((d) => {
          const data = d.data();
          const playerCount: number = data.playerCount
            || (Array.isArray(data.participants) ? data.participants.length : 0);
          if (playerCount < 1) return false;
          const created = data.createdAt;
          const createdIso = typeof created === 'string'
            ? created
            : (created?.toDate?.().toISOString?.() ?? null);
          if (!createdIso) return false;
          return createdIso < stuckBeforeIso;
        }).length;
        total += count;
      } catch {
        // Collection missing or different schema — skip
      }
    }),
  );
  return total;
}
