/**
 * Thin client wrapper for the BananaWheelAssignmentJournal contract.
 * Pattern mirrors lib/wheelProofContract.ts — same RPC, same signer,
 * same gas params.
 *
 * Deployed contract address lives in Firestore at
 *   system_config/wheelAssignmentJournal.contractAddress
 * so it can be hot-swapped without a code deploy if we ever migrate
 * to a new journal contract.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ApiError } from '@/lib/api/errors';
import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import { BANANA_WHEEL_ASSIGNMENT_JOURNAL_ABI } from '@/lib/contracts/bananaWheelAssignmentJournalArtifact';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const SYSTEM_CONFIG = 'system_config';
const JOURNAL_CONFIG_DOC = 'wheelAssignmentJournal';

const BASE_GAS_PARAMS = {
  maxFeePerGas: parseGwei('0.1'),
  maxPriorityFeePerGas: parseGwei('0.001'),
};

interface JournalConfig {
  contractAddress?: Address;
}

export async function getWheelAssignmentJournalAddress(): Promise<Address | null> {
  if (!isFirestoreConfigured()) return null;
  const db = getAdminFirestore();
  const snap = await db.collection(SYSTEM_CONFIG).doc(JOURNAL_CONFIG_DOC).get();
  if (!snap.exists) return null;
  return (snap.data() as JournalConfig | undefined)?.contractAddress ?? null;
}

export async function setWheelAssignmentJournalAddress(addr: Address): Promise<void> {
  if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');
  const db = getAdminFirestore();
  await db
    .collection(SYSTEM_CONFIG)
    .doc(JOURNAL_CONFIG_DOC)
    .set({ contractAddress: addr }, { merge: true });
}

function loadPrivateKey(): Hex {
  const raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
  if (!raw) throw new ApiError(503, 'BBB4_OWNER_PRIVATE_KEY not configured');
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new ApiError(503, 'BBB4_OWNER_PRIVATE_KEY malformed');
  return hex as Hex;
}

function publicClient() {
  return createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });
}

function walletClient() {
  const account = privateKeyToAccount(loadPrivateKey());
  return createWalletClient({ account, chain: BASE, transport: http(BASE_RPC_URL) });
}

/**
 * Commit a Merkle root for the next batch of spin assignments. The
 * contract enforces strict in-order batching (batchIndex must equal
 * totalBatches[periodNumber]) so the server has to track the next
 * expected index in Firestore and pass it through.
 */
export async function callCommitAssignmentBatch(args: {
  contractAddress: Address;
  periodNumber: number;
  batchIndex: number;
  fromIndex: number;
  toIndex: number;
  root: Hex;
}): Promise<Hex> {
  const wallet = walletClient();
  const pub = publicClient();
  const txHash = await wallet.writeContract({
    address: args.contractAddress,
    abi: BANANA_WHEEL_ASSIGNMENT_JOURNAL_ABI,
    functionName: 'commitAssignmentBatch',
    args: [
      BigInt(args.periodNumber),
      args.batchIndex,
      args.fromIndex,
      args.toIndex,
      args.root,
    ],
    ...BASE_GAS_PARAMS,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new ApiError(500, `commitAssignmentBatch tx reverted: ${txHash}`);
  }
  return txHash;
}

export interface OnchainBatch {
  root: Hex;
  fromIndex: number;
  toIndex: number;
  committedAt: bigint;
  committed: boolean;
}

export async function readBatchOnchain(
  contractAddress: Address,
  periodNumber: number,
  batchIndex: number,
): Promise<OnchainBatch> {
  const pub = publicClient();
  const result = (await pub.readContract({
    address: contractAddress,
    abi: BANANA_WHEEL_ASSIGNMENT_JOURNAL_ABI,
    functionName: 'getBatch',
    args: [BigInt(periodNumber), batchIndex],
  })) as readonly [Hex, number, number, bigint, boolean];
  return {
    root: result[0],
    fromIndex: result[1],
    toIndex: result[2],
    committedAt: result[3],
    committed: result[4],
  };
}

export async function readTotalBatchesOnchain(
  contractAddress: Address,
  periodNumber: number,
): Promise<number> {
  const pub = publicClient();
  const result = (await pub.readContract({
    address: contractAddress,
    abi: BANANA_WHEEL_ASSIGNMENT_JOURNAL_ABI,
    functionName: 'getTotalBatches',
    args: [BigInt(periodNumber)],
  })) as number;
  return result;
}
