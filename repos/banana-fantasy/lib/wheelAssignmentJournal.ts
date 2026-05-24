/**
 * Per-spin assignment journal for the wheel. Companion to wheelPeriod.ts.
 *
 * Goal: cryptographically commit "wallet W received spinIndex N" to the
 * chain in batches of ~100 spins, so the order in which we hand out
 * pre-committed outcomes can't be secretly rewritten. Closes the only
 * remaining trust gap in the provably-fair wheel.
 *
 * Two surfaces:
 *
 *   1) Per-spin journal writes (synchronous, in the spin transaction)
 *      └─ writeJournalEntryTx() — one Firestore write inside the existing
 *         spin tx. Zero added latency, no on-chain call here.
 *
 *   2) Async batch commitments (background, via wheel-period-keeper cron)
 *      └─ commitPendingBatches() — detects any period with ≥BATCH_SIZE
 *         unbatched entries, builds Merkle tree, submits on-chain tx,
 *         records batch metadata.
 *
 * Storage layout in Firestore:
 *
 *   wheelAssignmentJournal/{periodNumber}/entries/{spinIndex}
 *     { spinIndex: number, wallet: string, timestamp: number }
 *
 *   wheelAssignmentJournal/{periodNumber}/batches/{batchIndex}
 *     { batchIndex, fromIndex, toIndex, root, txHash, committedAt,
 *       leaves: Hex[] (the per-spin leaves for proof reconstruction) }
 *
 *   wheelAssignmentJournal/{periodNumber}    (parent doc — counters)
 *     { totalBatchesCommitted: number,
 *       highestEntryIndex: number,  // monotonic per-period spinIndex max
 *       updatedAt: number }
 */

import type { Hex } from 'viem';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import {
  buildAssignmentMerkleTree,
  type AssignmentLeafInput,
} from '@/lib/wheelAssignmentMerkle';
import {
  callCommitAssignmentBatch,
  getWheelAssignmentJournalAddress,
} from '@/lib/wheelAssignmentContract';
import { logger } from '@/lib/logger';

/** Number of spins per on-chain commit. Pick once, bake in. */
export const ASSIGNMENT_BATCH_SIZE = 100;

const JOURNAL_COLLECTION = 'wheelAssignmentJournal';
const ENTRIES_SUBCOLLECTION = 'entries';
const BATCHES_SUBCOLLECTION = 'batches';

export interface JournalEntry {
  spinIndex: number;
  wallet: string;
  timestamp: number;
}

export interface JournalBatch {
  batchIndex: number;
  fromIndex: number;
  toIndex: number;
  root: string;
  txHash: string;
  committedAt: number;
  leaves: string[];
}

/**
 * Per-spin write — called from inside the spin Firestore transaction so
 * it shares atomicity with the spinIndex claim. Zero added on-chain
 * work; just one extra Firestore write per spin.
 */
export function writeJournalEntryTx(
  tx: FirebaseFirestore.Transaction,
  input: { periodNumber: number; spinIndex: number; wallet: string },
): void {
  const db = getAdminFirestore();
  const ref = db
    .collection(JOURNAL_COLLECTION)
    .doc(String(input.periodNumber))
    .collection(ENTRIES_SUBCOLLECTION)
    .doc(String(input.spinIndex));
  tx.set(ref, {
    spinIndex: input.spinIndex,
    wallet: input.wallet.toLowerCase(),
    timestamp: Date.now(),
  });
}

/**
 * Read the current on-chain commitment cursor for a period. Returns the
 * next batchIndex we're allowed to commit (== count of batches already
 * committed — the contract enforces strict ordering).
 */
async function readNextExpectedBatchIndex(periodNumber: number): Promise<number> {
  const db = getAdminFirestore();
  const snap = await db.collection(JOURNAL_COLLECTION).doc(String(periodNumber)).get();
  if (!snap.exists) return 0;
  const data = snap.data() as { totalBatchesCommitted?: number } | undefined;
  return data?.totalBatchesCommitted ?? 0;
}

/**
 * Returns the entry docs covering spinIndex range [from, to] inclusive
 * for a period. Sorted ascending so the leaf order matches what the
 * Merkle tree expects.
 */
async function readEntriesInRange(
  periodNumber: number,
  from: number,
  to: number,
): Promise<JournalEntry[]> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(JOURNAL_COLLECTION)
    .doc(String(periodNumber))
    .collection(ENTRIES_SUBCOLLECTION)
    .where('spinIndex', '>=', from)
    .where('spinIndex', '<=', to)
    .orderBy('spinIndex', 'asc')
    .get();
  return snap.docs.map((d) => d.data() as JournalEntry);
}

/**
 * Look up the persisted batch metadata for a single committed batch.
 * Used by the per-spin assignment-proof endpoint to surface the on-chain
 * tx hash + the Merkle leaves needed to rebuild the proof path.
 */
export async function getCommittedBatch(
  periodNumber: number,
  batchIndex: number,
): Promise<JournalBatch | null> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(JOURNAL_COLLECTION)
    .doc(String(periodNumber))
    .collection(BATCHES_SUBCOLLECTION)
    .doc(String(batchIndex))
    .get();
  if (!snap.exists) return null;
  return snap.data() as JournalBatch;
}

/**
 * The committed batch index that a given spinIndex belongs to, IF a
 * batch covering it has already been committed. Returns null if the
 * spinIndex falls in the still-uncommitted tail of the journal.
 */
export async function findBatchForSpin(
  periodNumber: number,
  spinIndex: number,
): Promise<JournalBatch | null> {
  const batchIndex = Math.floor(spinIndex / ASSIGNMENT_BATCH_SIZE);
  return getCommittedBatch(periodNumber, batchIndex);
}

export interface CommitResult {
  periodNumber: number;
  batchIndex: number;
  fromIndex: number;
  toIndex: number;
  root: string;
  txHash: string;
}

/**
 * Async background job — looks at every period with active journaling,
 * detects any complete unbatched window of ASSIGNMENT_BATCH_SIZE entries,
 * commits its Merkle root on-chain, and persists batch metadata.
 *
 * Idempotent: a partial failure (e.g. tx revert) leaves the next call
 * able to retry the same batch. Contract enforces ordering, so we can't
 * accidentally double-commit.
 *
 * The currently active wheel period is fed in so we don't scan
 * unrelated periods on every cron tick. The cron loops through any
 * recent periods (current + a couple back) to mop up tails that
 * arrived after the period rolled over.
 */
export async function commitPendingBatches(
  periodNumbers: number[],
): Promise<CommitResult[]> {
  const contractAddress = await getWheelAssignmentJournalAddress();
  if (!contractAddress) {
    // Not deployed yet — journal writes happen but on-chain commits are
    // gated on the contract being live. Once Boris deploys, the cron
    // backfills any pending batches automatically.
    return [];
  }

  const results: CommitResult[] = [];
  for (const periodNumber of periodNumbers) {
    try {
      let made: CommitResult | null;
      // One period might have multiple pending batches (e.g. cron was
      // down briefly and 250+ spins accumulated). Drain them in order.
      // Cap at 10 per period per tick so a backlog doesn't tie up the
      // cron's full 5-minute window — next tick gets the rest.
      let drained = 0;
      do {
        made = await commitNextBatchForPeriod(contractAddress, periodNumber);
        if (made) {
          results.push(made);
          drained += 1;
        }
      } while (made && drained < 10);
    } catch (err) {
      logger.error('wheel.assignment.commit_failed', {
        err: err instanceof Error ? err : String(err),
        route: 'cron/wheel-period-keeper',
        context: { periodNumber },
      });
    }
  }
  return results;
}

async function commitNextBatchForPeriod(
  contractAddress: `0x${string}`,
  periodNumber: number,
): Promise<CommitResult | null> {
  const nextBatchIndex = await readNextExpectedBatchIndex(periodNumber);
  const fromIndex = nextBatchIndex * ASSIGNMENT_BATCH_SIZE;
  const toIndex = fromIndex + ASSIGNMENT_BATCH_SIZE - 1;

  const entries = await readEntriesInRange(periodNumber, fromIndex, toIndex);
  // Only commit when we have the FULL batch — partial batches commit on
  // the next cron tick after enough spins arrive.
  if (entries.length < ASSIGNMENT_BATCH_SIZE) return null;

  // Defensive: make sure entries are contiguous (no holes), in case
  // some Firestore index race left a gap. Easy invariant to enforce
  // before we lock anything on-chain.
  for (let i = 0; i < entries.length; i += 1) {
    const expectedIndex = fromIndex + i;
    if (entries[i].spinIndex !== expectedIndex) {
      throw new Error(
        `Assignment batch ${nextBatchIndex} for period ${periodNumber} has a hole — ` +
          `expected spinIndex ${expectedIndex}, got ${entries[i].spinIndex}`,
      );
    }
  }

  const leafInputs: AssignmentLeafInput[] = entries.map((e) => ({
    spinIndex: e.spinIndex,
    wallet: e.wallet,
  }));
  const tree = buildAssignmentMerkleTree(leafInputs);

  const txHash = await callCommitAssignmentBatch({
    contractAddress,
    periodNumber,
    batchIndex: nextBatchIndex,
    fromIndex,
    toIndex,
    root: tree.root,
  });

  // Persist the committed batch — leaves are stored alongside so the
  // per-spin assignment-proof endpoint can regenerate any proof path
  // without re-fetching the entries collection.
  const db = getAdminFirestore();
  const periodRef = db.collection(JOURNAL_COLLECTION).doc(String(periodNumber));
  const batchRef = periodRef.collection(BATCHES_SUBCOLLECTION).doc(String(nextBatchIndex));

  await db.runTransaction(async (tx) => {
    tx.set(batchRef, {
      batchIndex: nextBatchIndex,
      fromIndex,
      toIndex,
      root: tree.root,
      txHash,
      committedAt: Date.now(),
      leaves: tree.leaves,
    } as JournalBatch);
    tx.set(
      periodRef,
      {
        totalBatchesCommitted: nextBatchIndex + 1,
        highestEntryIndex: toIndex,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  });

  logger.info('wheel.assignment.batch_committed', {
    periodNumber,
    batchIndex: nextBatchIndex,
    fromIndex,
    toIndex,
    txHash,
  });

  return {
    periodNumber,
    batchIndex: nextBatchIndex,
    fromIndex,
    toIndex,
    root: tree.root,
    txHash,
  };
}

/**
 * Public-facing summary for the live feed and /wheel-batches page.
 * Returns recent committed batches for a period plus the count of
 * uncommitted-tail entries (so the UI can show "next batch: X% full").
 */
export interface AssignmentBatchSummary {
  batchIndex: number;
  fromIndex: number;
  toIndex: number;
  count: number;
  root: string;
  txHash: string;
  committedAt: number;
}

export async function listCommittedBatches(
  periodNumber: number,
  limit = 20,
): Promise<AssignmentBatchSummary[]> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(JOURNAL_COLLECTION)
    .doc(String(periodNumber))
    .collection(BATCHES_SUBCOLLECTION)
    .orderBy('batchIndex', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as JournalBatch;
    return {
      batchIndex: data.batchIndex,
      fromIndex: data.fromIndex,
      toIndex: data.toIndex,
      count: data.toIndex - data.fromIndex + 1,
      root: data.root,
      txHash: data.txHash,
      committedAt: data.committedAt,
    };
  });
}

export interface AssignmentJournalStatus {
  periodNumber: number;
  totalBatchesCommitted: number;
  highestEntryIndex: number;
  unbatchedEntryCount: number; // entries past the committed boundary
}

/**
 * Quick public-feed style status — how far on-chain is, how many entries
 * are queued for the next batch. Drives the small "next batch: 73/100"
 * line on the wheel page.
 */
export async function readJournalStatus(periodNumber: number): Promise<AssignmentJournalStatus> {
  const db = getAdminFirestore();
  const parentSnap = await db.collection(JOURNAL_COLLECTION).doc(String(periodNumber)).get();
  const totalBatchesCommitted = parentSnap.exists
    ? ((parentSnap.data() as { totalBatchesCommitted?: number }).totalBatchesCommitted ?? 0)
    : 0;
  const committedThrough = totalBatchesCommitted * ASSIGNMENT_BATCH_SIZE - 1;

  const tailSnap = await db
    .collection(JOURNAL_COLLECTION)
    .doc(String(periodNumber))
    .collection(ENTRIES_SUBCOLLECTION)
    .where('spinIndex', '>', committedThrough)
    .orderBy('spinIndex', 'desc')
    .limit(1)
    .get();
  const highestEntryIndex = tailSnap.empty
    ? committedThrough
    : (tailSnap.docs[0].data() as JournalEntry).spinIndex;
  const unbatchedEntryCount = Math.max(0, highestEntryIndex - committedThrough);

  return {
    periodNumber,
    totalBatchesCommitted,
    highestEntryIndex,
    unbatchedEntryCount,
  };
}

// Marker so a quick grep confirms this file shipped with both surfaces.
export const ASSIGNMENT_JOURNAL_SURFACES: Hex[] = [];
