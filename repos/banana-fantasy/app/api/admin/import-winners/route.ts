// Admin-only: batch-import contest winners as prize records.
//
// This is the pipeline ENTRANCE for the payout system: Boris determines
// winners off-platform, pastes a CSV (wallet,amount,contestName[,draftId])
// into Admin → Tools, and this endpoint creates one prize record per row
// in synthetic_prizes. From there the existing machine takes over:
// winner sees balance on /winnings → withdraws → admin approves →
// Gnosis CSV batch → verified mark-paid.
//
// IDEMPOTENT: each row maps to a deterministic doc id
// `syn_imp_<sha256(wallet|contestName|amount)[:20]>` written with
// Firestore .create(), so re-pasting the same CSV reports "skipped"
// rows instead of double-granting. Two genuinely identical prizes for
// the same wallet need distinct contest names (e.g. "BBB Finals — 2nd
// entry").
//
// dryRun: true validates + dedupe-checks without writing — the admin
// panel uses it for the preview step.

export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { createPrizeRecordWithId } from '@/lib/prizeOverlay';
import { createNotification } from '@/lib/queueNotifications';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_ROWS = 500;
const MAX_AMOUNT = 100000; // matches grant-prize bounds
const MAX_CONTEST_NAME = 120;

interface WinnerRow {
  wallet: string;
  amount: number;
  contestName: string;
  draftId?: string;
}

interface RowResult {
  wallet: string;
  amount: number;
  contestName: string;
  status: 'created' | 'exists' | 'invalid' | 'failed';
  prizeId?: string;
  error?: string;
}

function prizeIdForRow(row: WinnerRow): string {
  const key = `${row.wallet.toLowerCase()}|${row.contestName}|${row.amount}`;
  return `syn_imp_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

function validateRow(raw: unknown): { row?: WinnerRow; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'row is not an object' };
  const r = raw as Record<string, unknown>;
  const wallet = typeof r.wallet === 'string' ? r.wallet.trim().toLowerCase() : '';
  if (!ETH_ADDRESS_RE.test(wallet)) return { error: 'invalid wallet address' };
  const amount = typeof r.amount === 'number' ? r.amount : Number(r.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { error: `amount must be > 0 and ≤ ${MAX_AMOUNT}` };
  }
  const contestName = typeof r.contestName === 'string' ? r.contestName.trim() : '';
  if (!contestName || contestName.length > MAX_CONTEST_NAME) {
    return { error: `contestName required, ≤ ${MAX_CONTEST_NAME} chars` };
  }
  const draftId = typeof r.draftId === 'string' && r.draftId.trim() ? r.draftId.trim() : undefined;
  return { row: { wallet, amount, contestName, draftId } };
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actor = '';
  try {
    const admin = await requireAdmin(req);
    actor = admin.walletAddress ?? admin.userId;

    const body = await parseBody(req);
    const dryRun = body.dryRun === true;
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      throw new ApiError(400, 'rows must be a non-empty array');
    }
    if (body.rows.length > MAX_ROWS) {
      throw new ApiError(400, `Too many rows — max ${MAX_ROWS} per import`);
    }

    // Validate every row up front. Also catch in-batch duplicates (same
    // wallet+contest+amount twice in one paste) — they'd map to the same
    // doc id, so the second is a duplicate even before Firestore says so.
    const results: RowResult[] = [];
    const valid: { row: WinnerRow; prizeId: string }[] = [];
    const seenIds = new Set<string>();
    for (const raw of body.rows) {
      const { row, error } = validateRow(raw);
      if (!row) {
        const r = (raw ?? {}) as Record<string, unknown>;
        results.push({
          wallet: typeof r.wallet === 'string' ? r.wallet : '',
          amount: Number(r.amount) || 0,
          contestName: typeof r.contestName === 'string' ? r.contestName : '',
          status: 'invalid',
          error,
        });
        continue;
      }
      const prizeId = prizeIdForRow(row);
      if (seenIds.has(prizeId)) {
        results.push({ ...row, status: 'invalid', error: 'duplicate row in this CSV (same wallet+contest+amount)' });
        continue;
      }
      seenIds.add(prizeId);
      valid.push({ row, prizeId });
      results.push({ ...row, status: 'created', prizeId }); // provisional; flipped below
    }

    if (dryRun) {
      // Check which valid rows already exist without writing.
      if (isFirestoreConfigured() && valid.length > 0) {
        const db = getAdminFirestore();
        const refs = valid.map((v) => db.collection('synthetic_prizes').doc(v.prizeId));
        const snaps = await db.getAll(...refs);
        snaps.forEach((snap, i) => {
          if (snap.exists) {
            const r = results.find((x) => x.prizeId === valid[i].prizeId);
            if (r) r.status = 'exists';
          }
        });
      }
      const newRows = results.filter((r) => r.status === 'created');
      return json({
        dryRun: true,
        results,
        newCount: newRows.length,
        existsCount: results.filter((r) => r.status === 'exists').length,
        invalidCount: results.filter((r) => r.status === 'invalid').length,
        totalAmount: newRows.reduce((s, r) => s + r.amount, 0),
        requestId,
      });
    }

    // Real import. Sequential writes — N ≤ 500 and each is tiny; keeps
    // per-row error isolation simple.
    let createdCount = 0;
    let existsCount = 0;
    let failCount = 0;
    for (const { row, prizeId } of valid) {
      const r = results.find((x) => x.prizeId === prizeId)!;
      try {
        const outcome = await createPrizeRecordWithId(prizeId, {
          userId: row.wallet,
          amount: row.amount,
          contestName: row.contestName,
          draftId: row.draftId,
          note: 'winners import',
          grantedBy: actor,
        });
        if (outcome === 'created') {
          createdCount += 1;
          // Tell the winner immediately — bell + stream. dedupeKey =
          // prize id so a retried import can't double-notify.
          await createNotification(row.wallet, {
            type: 'prize_won',
            title: `🏆 You won $${row.amount.toLocaleString()}!`,
            message: `${row.contestName} — your winnings are ready on the Winnings page.`,
            link: '/winnings',
            dedupeKey: `prize-won-${prizeId}`,
          }).catch((err) => logger.warn('import-winners.notify_failed', { prizeId, err: (err as Error).message }));
        } else if (outcome === 'exists') {
          existsCount += 1;
          r.status = 'exists';
        } else {
          failCount += 1;
          r.status = 'failed';
          r.error = 'Firestore not configured';
        }
      } catch (err) {
        failCount += 1;
        r.status = 'failed';
        r.error = err instanceof Error ? err.message : String(err);
      }
    }

    const invalidCount = results.filter((x) => x.status === 'invalid').length;
    const totalAmount = results.filter((x) => x.status === 'created').reduce((s, x) => s + x.amount, 0);

    await logAdminAction({
      actor,
      action: 'import-winners',
      target: `rows:${body.rows.length}`,
      after: { createdCount, existsCount, invalidCount, failCount, totalAmount },
      requestId,
    });

    logger.info('admin.import_winners.ok', {
      requestId,
      actor,
      createdCount,
      existsCount,
      invalidCount,
      failCount,
      totalAmount,
      durationMs: Date.now() - start,
    });

    return json({
      dryRun: false,
      results,
      createdCount,
      existsCount,
      invalidCount,
      failCount,
      totalAmount,
      requestId,
    });
  } catch (err) {
    logger.error('admin.import_winners.failed', {
      requestId,
      actor,
      err,
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
