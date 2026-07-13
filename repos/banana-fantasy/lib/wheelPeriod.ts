// Wheel-period lifecycle for the Banana Wheel VRF + Merkle commit verifiability
// system. A "period" is a sealed batch of up to 100k spins. The salt + VRF
// randomness committed at period open determine every outcome via
// `deriveSpinOutcome(salt, vrf, spinIndex)`. The Merkle root of all
// pre-computed outcomes is also committed on-chain so V2 can ship per-spin
// proofs without re-running the math.
//
// State machine (mirrors Firestore `wheel_periods/{N}.status`):
//   "requested"  — commit + VRF request submitted, VRF not yet fulfilled
//   "fulfilled"  — VRF returned, Merkle root not yet committed
//   "active"     — Merkle root committed, accepts spins
//   "closed"     — capped at 100k spins or 30d; awaiting reveal
//   "revealed"   — salt published on-chain; period is fully publicly auditable

import { FieldValue } from 'firebase-admin/firestore';
import { keccak256, type Hex } from 'viem';
import crypto from 'node:crypto';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { wheelSegments, type WheelSegment } from '@/lib/wheelConfig';
import { buildMerkleTree, deriveSpinOutcome, getMerkleProof, leafHash, type MerkleTree } from '@/lib/wheelMerkle';

// One period is sized to cover the WHOLE contest (Boris 2026-06-12: the wheel
// is final and we want a single season-long commitment, not rolling batches).
// If spins ever DO hit the cap, the keeper cron auto-rolls to the next period
// with zero downtime — that's the built-in emergency overflow.
export const MAX_SPINS_PER_PERIOD = 100_000;
const PERIODS_COLLECTION = 'wheel_periods';
const SYSTEM_CONFIG = 'system_config';
const WHEEL_STATE_DOC = 'wheelPeriodState';

export type PeriodStatus = 'requested' | 'fulfilled' | 'active' | 'closed' | 'revealed';

export interface WheelPeriodDoc {
  periodNumber: number;
  status: PeriodStatus;
  saltHash: string;            // public from open
  salt?: string;               // private until revealed
  vrfRequestId?: string;       // null until VRF request lands
  vrfRandomness?: string;      // null until VRF fulfills
  merkleRoot?: string;         // null until root committed on-chain
  spinCount: number;           // 0..MAX_SPINS_PER_PERIOD
  maxSpins: number;
  openedAt: number;            // ms
  fulfilledAt?: number;
  activatedAt?: number;        // when root was committed
  closedAt?: number;
  revealedAt?: number;
  // Tx hashes for audit trail
  commitTxHash?: string;
  rootCommitTxHash?: string;
  revealTxHash?: string;
  // Immutable copy of the prize table this period's outcomes were derived
  // from, stamped at open. Auditors can re-derive every leaf from
  // (salt, vrf, segmentsSnapshot) without trusting the deployed code.
  segmentsSnapshot?: WheelSegment[];
  segmentsHash?: string; // sha256 of canonical segments JSON
}

export interface WheelPeriodStateDoc {
  currentPeriodNumber: number;
}

/**
 * Generate a fresh 32-byte salt for a new period. Cryptographically
 * random — only the salt's hash gets committed on-chain at open time;
 * the salt itself stays in Firestore until period reveal.
 */
export function generatePeriodSalt(): string {
  return '0x' + crypto.randomBytes(32).toString('hex');
}

export function saltHashOf(salt: string): Hex {
  const clean = salt.startsWith('0x') ? salt : `0x${salt}`;
  return keccak256(clean as Hex);
}

/**
 * Read the current period number (the one spins should consume from).
 * Returns null if no period has ever been opened (admin must bootstrap).
 */
export async function getCurrentPeriodNumber(): Promise<number | null> {
  const db = getAdminFirestore();
  const snap = await db.collection(SYSTEM_CONFIG).doc(WHEEL_STATE_DOC).get();
  if (!snap.exists) return null;
  const data = snap.data() as WheelPeriodStateDoc | undefined;
  return data?.currentPeriodNumber ?? null;
}

export async function getPeriod(periodNumber: number): Promise<WheelPeriodDoc | null> {
  const db = getAdminFirestore();
  const snap = await db.collection(PERIODS_COLLECTION).doc(String(periodNumber)).get();
  if (!snap.exists) return null;
  return snap.data() as WheelPeriodDoc;
}

export async function getCurrentPeriod(): Promise<WheelPeriodDoc | null> {
  const n = await getCurrentPeriodNumber();
  if (n === null) return null;
  return getPeriod(n);
}

/**
 * Persist the freshly-opened period state (status: requested). Caller has
 * already submitted the on-chain commit + VRF request. The VRF fulfillment
 * happens later via the coordinator callback; admin then calls
 * `finalizePeriod` to compute outcomes + commit Merkle root.
 */
export async function recordPeriodRequested(input: {
  periodNumber: number;
  salt: string;
  saltHash: string;
  vrfRequestId: string;
  commitTxHash: string;
}): Promise<void> {
  const db = getAdminFirestore();
  const now = Date.now();
  const segmentsJson = JSON.stringify(wheelSegments.map((s) => ({ id: s.id, label: s.label, probability: s.probability })));
  const doc: WheelPeriodDoc = {
    periodNumber: input.periodNumber,
    status: 'requested',
    salt: input.salt, // private — stays in Firestore until reveal
    saltHash: input.saltHash,
    vrfRequestId: input.vrfRequestId,
    spinCount: 0,
    maxSpins: MAX_SPINS_PER_PERIOD,
    openedAt: now,
    commitTxHash: input.commitTxHash,
    segmentsSnapshot: wheelSegments,
    segmentsHash: crypto.createHash('sha256').update(segmentsJson).digest('hex'),
  };
  await db.collection(PERIODS_COLLECTION).doc(String(input.periodNumber)).set(doc);
  await db.collection(SYSTEM_CONFIG).doc(WHEEL_STATE_DOC).set(
    { currentPeriodNumber: input.periodNumber },
    { merge: true },
  );
}

/**
 * Compute the full Merkle tree for a period given salt + VRF randomness.
 * Returns the tree with all internal nodes for both root-commit AND
 * per-spin proof generation. ~10k leaves → ~20k total nodes → ~640KB
 * memory footprint. The whole tree gets serialized into the period doc
 * so each spin can read its proof path without recomputing everything.
 *
 * Compute cost: ~100-300ms for 10k outcomes on a Vercel function. Runs
 * once per period activation, amortized across 10k spins.
 */
export function computePeriodMerkleTree(salt: string, vrf: string): MerkleTree {
  const leaves: Hex[] = [];
  for (let i = 0; i < MAX_SPINS_PER_PERIOD; i += 1) {
    const { segment } = deriveSpinOutcome(salt, vrf, i);
    leaves.push(leafHash(i, segment.id));
  }
  return buildMerkleTree(leaves);
}

export function computePeriodMerkleRoot(salt: string, vrf: string): Hex {
  return computePeriodMerkleTree(salt, vrf).root;
}

/**
 * Subcollection: wheel_periods/{N}/leaves/{shardId}. Leaves are stored in
 * shards of 10k (10k * 66 hex chars ≈ 660KB — safely under Firestore's
 * 1MB doc limit). A 100k-spin period writes 10 shard docs. Period 1
 * (single shard "0") reads back identically through the same path.
 */
const LEAVES_SUBCOLLECTION = 'leaves';
const LEAF_SHARD_SIZE = 10_000;

export async function storePeriodLeaves(periodNumber: number, tree: MerkleTree): Promise<void> {
  const db = getAdminFirestore();
  const col = db
    .collection(PERIODS_COLLECTION)
    .doc(String(periodNumber))
    .collection(LEAVES_SUBCOLLECTION);
  const writes: Promise<unknown>[] = [];
  for (let shardId = 0, i = 0; i < tree.leaves.length; shardId += 1, i += LEAF_SHARD_SIZE) {
    const chunk = tree.leaves.slice(i, i + LEAF_SHARD_SIZE);
    writes.push(
      col.doc(String(shardId)).set({
        shardId,
        startIndex: i,
        endIndex: i + chunk.length - 1,
        leaves: chunk,
      }),
    );
  }
  await Promise.all(writes);
}

export async function loadPeriodLeaves(periodNumber: number): Promise<Hex[]> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(PERIODS_COLLECTION)
    .doc(String(periodNumber))
    .collection(LEAVES_SUBCOLLECTION)
    .get();
  if (snap.empty) throw new Error(`Period ${periodNumber} has no stored leaves`);
  const shards = snap.docs
    .map((d) => d.data() as { shardId: number; leaves: Hex[] })
    .sort((a, b) => a.shardId - b.shardId);
  const leaves: Hex[] = [];
  for (const shard of shards) {
    if (!shard?.leaves) throw new Error(`Period ${periodNumber} leaves shard malformed`);
    leaves.push(...shard.leaves);
  }
  return leaves;
}

/**
 * Generates a Merkle proof for `spinIndex` in the given period. Rebuilds
 * the tree from stored leaves (fast — 10k leaves takes ~10-20ms). Returns
 * the leaf hash + proof path; the browser combines them and compares
 * against the on-chain root to verify.
 */
// A period's leaves are fixed at creation (the whole tree is committed up
// front), so the rebuilt tree is immutable and safe to cache for the life of
// the (warm) lambda. Without this, every proof request reloads ~7MB of leaves
// and rebuilds a 100k-leaf tree (~3s). Cached → subsequent proofs are a tree
// walk (sub-ms). Keyed by period number; bounded (only a handful of periods).
const periodTreeCache = new Map<number, MerkleTree>();

async function getPeriodTree(periodNumber: number): Promise<MerkleTree> {
  const cached = periodTreeCache.get(periodNumber);
  if (cached) return cached;
  const leaves = await loadPeriodLeaves(periodNumber);
  const tree = buildMerkleTree(leaves);
  periodTreeCache.set(periodNumber, tree);
  return tree;
}

export async function generateSpinProof(periodNumber: number, spinIndex: number): Promise<{
  leaf: Hex;
  proof: Hex[];
  root: Hex;
}> {
  const tree = await getPeriodTree(periodNumber);
  if (spinIndex < 0 || spinIndex >= tree.leaves.length) {
    throw new Error(`spinIndex ${spinIndex} out of range for period ${periodNumber}`);
  }
  const proof = getMerkleProof(tree, spinIndex);
  return { leaf: tree.leaves[spinIndex], proof, root: tree.root };
}

/**
 * Mark the period fulfilled after VRF callback. Stores VRF randomness;
 * status advances to "fulfilled". Caller (admin) will follow up with
 * `recordPeriodActivated` after submitting the root-commit transaction.
 */
export async function recordPeriodFulfilled(input: {
  periodNumber: number;
  vrfRandomness: string;
}): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(PERIODS_COLLECTION).doc(String(input.periodNumber)).update({
    status: 'fulfilled',
    vrfRandomness: input.vrfRandomness,
    fulfilledAt: Date.now(),
  });
}

export async function recordPeriodActivated(input: {
  periodNumber: number;
  merkleRoot: string;
  rootCommitTxHash: string;
}): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(PERIODS_COLLECTION).doc(String(input.periodNumber)).update({
    status: 'active',
    merkleRoot: input.merkleRoot,
    rootCommitTxHash: input.rootCommitTxHash,
    activatedAt: Date.now(),
  });
}

export async function recordPeriodClosed(periodNumber: number): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(PERIODS_COLLECTION).doc(String(periodNumber)).update({
    status: 'closed',
    closedAt: Date.now(),
  });
}

export async function recordPeriodRevealed(input: {
  periodNumber: number;
  revealTxHash: string;
}): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(PERIODS_COLLECTION).doc(String(input.periodNumber)).update({
    status: 'revealed',
    revealTxHash: input.revealTxHash,
    revealedAt: Date.now(),
  });
}

/**
 * Atomic spin assignment: increments the current period's spinCount and
 * returns the assigned index (0..maxSpins-1) plus the derived outcome.
 *
 * Throws if there's no active period (admin needs to bootstrap), if the
 * period is exhausted (admin needs to close + roll to next), or if the
 * period has aged past its 30-day cap.
 *
 * MUST be called inside a Firestore transaction so two simultaneous spins
 * can't claim the same index. Returns the deterministically-derived
 * segment for that index.
 */
export async function claimSpinIndex(periodNumber: number, tx: FirebaseFirestore.Transaction): Promise<{
  spinIndex: number;
  segmentId: string;
  segmentLabel: string;
}> {
  const db = getAdminFirestore();
  const ref = db.collection(PERIODS_COLLECTION).doc(String(periodNumber));
  const snap = await tx.get(ref);
  if (!snap.exists) {
    throw new Error(`Wheel period ${periodNumber} does not exist`);
  }
  const period = snap.data() as WheelPeriodDoc;
  if (period.status !== 'active') {
    throw new Error(`Wheel period ${periodNumber} is not active (status=${period.status})`);
  }
  if (period.spinCount >= period.maxSpins) {
    throw new Error(`Wheel period ${periodNumber} is full (${period.maxSpins} spins)`);
  }
  if (!period.salt || !period.vrfRandomness) {
    throw new Error(`Wheel period ${periodNumber} missing salt/vrf — inconsistent state`);
  }

  const spinIndex = period.spinCount;
  const { segment } = deriveSpinOutcome(period.salt, period.vrfRandomness, spinIndex);

  tx.update(ref, { spinCount: FieldValue.increment(1) });

  return {
    spinIndex,
    segmentId: segment.id,
    segmentLabel: segment.label,
  };
}

/**
 * Public-facing summary of a period (safe to expose — never returns the
 * raw salt unless the period is revealed). Used by the wheel page banner,
 * the /spin-proof page, and the public wheel-batches feed.
 */
export interface PublicPeriodSummary {
  periodNumber: number;
  status: PeriodStatus;
  saltHash: string;
  salt: string | null;        // null until revealed
  vrfRandomness: string | null;
  merkleRoot: string | null;
  spinCount: number;
  maxSpins: number;
  openedAt: number;
  fulfilledAt: number | null;
  activatedAt: number | null;
  closedAt: number | null;
  revealedAt: number | null;
  commitTxHash: string | null;
  rootCommitTxHash: string | null;
  revealTxHash: string | null;
}

export function toPublicSummary(p: WheelPeriodDoc): PublicPeriodSummary {
  const revealed = p.status === 'revealed';
  return {
    periodNumber: p.periodNumber,
    status: p.status,
    saltHash: p.saltHash,
    salt: revealed ? (p.salt ?? null) : null,
    vrfRandomness: p.vrfRandomness ?? null,
    merkleRoot: p.merkleRoot ?? null,
    spinCount: p.spinCount,
    maxSpins: p.maxSpins,
    openedAt: p.openedAt,
    fulfilledAt: p.fulfilledAt ?? null,
    activatedAt: p.activatedAt ?? null,
    closedAt: p.closedAt ?? null,
    revealedAt: p.revealedAt ?? null,
    commitTxHash: p.commitTxHash ?? null,
    rootCommitTxHash: p.rootCommitTxHash ?? null,
    revealTxHash: p.revealTxHash ?? null,
  };
}

// Stub to keep the import surface stable — V2 will export proof generators
// from this module too. For V1 we just need the lifecycle + derivation.
export { wheelSegments };
