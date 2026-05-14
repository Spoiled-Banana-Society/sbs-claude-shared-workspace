// Thin wrapper around the deployed BananaWheelProof contract. Mirrors the
// pattern used in lib/batchProof.ts for the existing BBB4BatchProofVRFCommit
// contract — same gas params, same private-key loader, same Base RPC config.

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
import { BANANA_WHEEL_PROOF_ABI } from '@/lib/contracts/bananaWheelProofArtifact';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const SYSTEM_CONFIG = 'system_config';
const WHEEL_PROOF_DOC = 'wheelProof';

const BASE_GAS_PARAMS = {
  maxFeePerGas: parseGwei('0.1'),
  maxPriorityFeePerGas: parseGwei('0.001'),
};

interface WheelProofConfig {
  contractAddress?: Address;
}

export async function getWheelProofContractAddress(): Promise<Address | null> {
  if (!isFirestoreConfigured()) return null;
  const db = getAdminFirestore();
  const snap = await db.collection(SYSTEM_CONFIG).doc(WHEEL_PROOF_DOC).get();
  if (!snap.exists) return null;
  return (snap.data() as WheelProofConfig | undefined)?.contractAddress ?? null;
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

export async function callRequestRandomnessAndCommit(
  contractAddress: Address,
  periodNumber: number,
  saltHash: Hex,
): Promise<{ txHash: Hex; requestId: string }> {
  const wallet = walletClient();
  const pub = publicClient();
  const txHash = await wallet.writeContract({
    address: contractAddress,
    abi: BANANA_WHEEL_PROOF_ABI,
    functionName: 'requestRandomnessAndCommit',
    args: [BigInt(periodNumber), saltHash],
    ...BASE_GAS_PARAMS,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new ApiError(500, `requestRandomnessAndCommit tx reverted: ${txHash}`);
  }

  // Pull the VRF requestId from the contract state for the period we just
  // committed. Simpler than parsing events out of the receipt and works
  // identically regardless of whether the coordinator emits in-line.
  const period = await readPeriodOnchain(contractAddress, periodNumber);
  return { txHash, requestId: period.vrfRequestId.toString() };
}

export async function callCommitMerkleRoot(
  contractAddress: Address,
  periodNumber: number,
  root: Hex,
): Promise<Hex> {
  const wallet = walletClient();
  const pub = publicClient();
  const txHash = await wallet.writeContract({
    address: contractAddress,
    abi: BANANA_WHEEL_PROOF_ABI,
    functionName: 'commitMerkleRoot',
    args: [BigInt(periodNumber), root],
    ...BASE_GAS_PARAMS,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new ApiError(500, `commitMerkleRoot tx reverted: ${txHash}`);
  }
  return txHash;
}

export async function callRevealSalt(
  contractAddress: Address,
  periodNumber: number,
  salt: Hex,
): Promise<Hex> {
  const wallet = walletClient();
  const pub = publicClient();
  const txHash = await wallet.writeContract({
    address: contractAddress,
    abi: BANANA_WHEEL_PROOF_ABI,
    functionName: 'revealSalt',
    args: [BigInt(periodNumber), salt],
    ...BASE_GAS_PARAMS,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new ApiError(500, `revealSalt tx reverted: ${txHash}`);
  }
  return txHash;
}

export interface OnchainPeriod {
  vrfRequestId: bigint;
  randomness: bigint;
  saltHash: Hex;
  salt: Hex;
  merkleRoot: Hex;
  requestedAt: bigint;
  fulfilledAt: bigint;
  rootCommittedAt: bigint;
  revealedAt: bigint;
  fulfilled: boolean;
  rootCommitted: boolean;
  revealed: boolean;
}

export async function readPeriodOnchain(
  contractAddress: Address,
  periodNumber: number,
): Promise<OnchainPeriod> {
  const pub = publicClient();
  const result = (await pub.readContract({
    address: contractAddress,
    abi: BANANA_WHEEL_PROOF_ABI,
    functionName: 'getPeriod',
    args: [BigInt(periodNumber)],
  })) as readonly [bigint, bigint, Hex, Hex, Hex, bigint, bigint, bigint, bigint, boolean, boolean, boolean];

  return {
    vrfRequestId: result[0],
    randomness: result[1],
    saltHash: result[2],
    salt: result[3],
    merkleRoot: result[4],
    requestedAt: result[5],
    fulfilledAt: result[6],
    rootCommittedAt: result[7],
    revealedAt: result[8],
    fulfilled: result[9],
    rootCommitted: result[10],
    revealed: result[11],
  };
}
