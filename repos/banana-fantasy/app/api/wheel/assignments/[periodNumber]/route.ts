/**
 * GET /api/wheel/assignments/{periodNumber}?limit=100&before=N
 *
 * Public real-time feed of (spinIndex, wallet, timestamp) assignments
 * for a wheel period. Anyone can poll this to watch the order in which
 * wallets received spinIndexes — combined with the on-chain assignment
 * batches, this is the user-facing "you can't quietly reorder spins"
 * audit trail.
 *
 * No auth. Rate-limited to avoid noisy polling from a stuck client.
 * Short cache so the feed feels live without thundering Firestore.
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import {
  ASSIGNMENT_BATCH_SIZE,
  listCommittedBatches,
  readJournalStatus,
  type AssignmentBatchSummary,
} from '@/lib/wheelAssignmentJournal';
import { getWheelAssignmentJournalAddress } from '@/lib/wheelAssignmentContract';

export const dynamic = 'force-dynamic';

const ENTRIES_PAGE_DEFAULT = 100;
const ENTRIES_PAGE_MAX = 250;

function shortHex(w: string): string {
  if (!w) return '';
  const hex = w.replace(/^0x/i, '');
  return `0x${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

export async function GET(
  req: Request,
  ctx: { params: { periodNumber: string } },
) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const periodNumber = Number.parseInt(ctx.params.periodNumber ?? '', 10);
    if (!Number.isFinite(periodNumber) || periodNumber < 1) {
      throw new ApiError(400, 'invalid periodNumber');
    }

    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '', 10) || ENTRIES_PAGE_DEFAULT),
      ENTRIES_PAGE_MAX,
    );
    const beforeRaw = url.searchParams.get('before');
    const before = beforeRaw ? Number.parseInt(beforeRaw, 10) : null;

    const db = getAdminFirestore();
    let query = db
      .collection('wheelAssignmentJournal')
      .doc(String(periodNumber))
      .collection('entries')
      .orderBy('spinIndex', 'desc')
      .limit(limit);
    if (before !== null && Number.isFinite(before)) {
      query = db
        .collection('wheelAssignmentJournal')
        .doc(String(periodNumber))
        .collection('entries')
        .where('spinIndex', '<', before)
        .orderBy('spinIndex', 'desc')
        .limit(limit);
    }
    const snap = await query.get();
    const entries = snap.docs.map((d) => {
      const data = d.data() as { spinIndex: number; wallet: string; timestamp: number };
      return {
        spinIndex: data.spinIndex,
        wallet: data.wallet,
        walletShort: shortHex(data.wallet),
        timestamp: data.timestamp,
      };
    });

    const [status, batches, contractAddress] = await Promise.all([
      readJournalStatus(periodNumber),
      listCommittedBatches(periodNumber, 20),
      getWheelAssignmentJournalAddress(),
    ]);

    const response: {
      ok: true;
      periodNumber: number;
      batchSize: number;
      contractAddress: string | null;
      status: typeof status;
      entries: typeof entries;
      batches: AssignmentBatchSummary[];
    } = {
      ok: true,
      periodNumber,
      batchSize: ASSIGNMENT_BATCH_SIZE,
      contractAddress: contractAddress ?? null,
      status,
      entries,
      batches,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
