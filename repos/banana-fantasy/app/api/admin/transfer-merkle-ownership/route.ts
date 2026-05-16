import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  encodeFunctionData,
  parseGwei,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

const BASE_GAS_PARAMS = {
  maxFeePerGas: parseGwei('0.1'),
  maxPriorityFeePerGas: parseGwei('0.001'),
};

const TRANSFER_OWNERSHIP_ABI = [{
  inputs: [{ name: 'newOwner', type: 'address' }],
  name: 'transferOwnership',
  outputs: [],
  stateMutability: 'nonpayable',
  type: 'function',
}, {
  inputs: [],
  name: 'owner',
  outputs: [{ type: 'address' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

function loadPrivateKey(): Hex | null {
  const raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return hex as Hex;
}

/**
 * POST /api/admin/transfer-merkle-ownership
 *   { newOwner: '0x...' }
 *
 * Transfers ownership of the deployed BBB4BatchProofMerkle contract
 * (looked up from system_config/batchProofMerkle.contractAddress) to
 * newOwner. The new owner becomes the only address that can call
 * requestRandomnessAndCommit / commitMerkleRoot / revealSalt on the
 * merkle contract.
 *
 * Use case: the Next.js deploy endpoint set the contract owner to the
 * Next.js signer, but the Go API signs with a DIFFERENT wallet. Without
 * a transfer, the Go API gets onlyOwner reverts when it tries to drive
 * the round lifecycle. Transferring ownership to the Go API's signer
 * fixes this — same bug-class the wheel contract hit.
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = admin.walletAddress ?? admin.userId;

    const body = await parseBody(req);
    const newOwnerRaw = typeof body.newOwner === 'string' ? body.newOwner.trim() : '';
    if (!isAddress(newOwnerRaw)) {
      throw new ApiError(400, `Invalid newOwner address: ${newOwnerRaw}`);
    }
    const newOwner = newOwnerRaw as Address;

    const key = loadPrivateKey();
    if (!key) return jsonError('BBB4_OWNER_PRIVATE_KEY not configured', 503);

    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');
    const db = getAdminFirestore();
    const snap = await db.collection('system_config').doc('batchProofMerkle').get();
    if (!snap.exists) {
      throw new ApiError(404, 'system_config/batchProofMerkle not found — deploy the merkle contract first');
    }
    const data = snap.data() as { contractAddress?: string } | undefined;
    const contractAddress = data?.contractAddress;
    if (!contractAddress || !isAddress(contractAddress)) {
      throw new ApiError(503, 'No valid contractAddress in system_config/batchProofMerkle');
    }

    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });
    const walletClient = createWalletClient({ account, chain: BASE, transport: http(BASE_RPC_URL) });

    const currentOwner = (await publicClient.readContract({
      address: contractAddress as Address,
      abi: TRANSFER_OWNERSHIP_ABI,
      functionName: 'owner',
    })) as Address;

    if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
      return json({
        success: true,
        alreadyTransferred: true,
        contractAddress,
        currentOwner,
        note: 'Already owned by the target address — no transaction needed.',
        requestId,
      });
    }
    if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
      return jsonError(
        `Current owner ${currentOwner} doesn't match the signer (${account.address}); signer can't transfer.`,
        400,
      );
    }

    const txData = encodeFunctionData({
      abi: TRANSFER_OWNERSHIP_ABI,
      functionName: 'transferOwnership',
      args: [newOwner],
    });

    const txHash = await walletClient.sendTransaction({
      to: contractAddress as Address,
      data: txData,
      value: 0n,
      ...BASE_GAS_PARAMS,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new ApiError(500, `Transfer transaction reverted: ${txHash}`);
    }

    const confirmedOwner = (await publicClient.readContract({
      address: contractAddress as Address,
      abi: TRANSFER_OWNERSHIP_ABI,
      functionName: 'owner',
    })) as Address;

    await logAdminAction({
      actor: actorWallet,
      action: 'transfer-batchproof-ownership',
      target: contractAddress,
      before: { owner: currentOwner },
      after: { owner: confirmedOwner, txHash },
      requestId,
    });

    return json({
      success: true,
      contractAddress,
      previousOwner: currentOwner,
      newOwner: confirmedOwner,
      txHash,
      basescanTx: `https://basescan.org/tx/${txHash}`,
      requestId,
    });
  } catch (err) {
    logger.error('admin.transfer_merkle_ownership.failed', { requestId, actor: actorWallet, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { requestId });
  }
}
