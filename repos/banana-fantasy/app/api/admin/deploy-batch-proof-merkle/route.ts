import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import {
  BBB4_BATCH_PROOF_MERKLE_BYTECODE,
  BBB4_BATCH_PROOF_MERKLE_ABI,
} from '@/lib/contracts/bbb4BatchProofMerkleArtifact';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

const SYSTEM_CONFIG = 'system_config';
const MERKLE_PROOF_DOC = 'batchProofMerkle';

const BASE_GAS_PARAMS = {
  maxFeePerGas: parseGwei('0.1'),
  maxPriorityFeePerGas: parseGwei('0.001'),
};

function loadPrivateKey(): Hex | null {
  const raw = process.env.BBB4_OWNER_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return hex as Hex;
}

interface MerkleProofConfig {
  contractAddress?: Address;
  vrfCoordinator?: Address;
  vrfSubscriptionId?: string;
  vrfKeyHash?: Hex;
  deployerAddress?: Address;
  deployTxHash?: Hex;
  deployedAt?: number;
  ownerAddress?: Address;
}

/**
 * POST /api/admin/deploy-batch-proof-merkle
 *   { vrfCoordinator, subscriptionId, keyHash, forceRedeploy? }
 *
 * Deploys BBB4BatchProofMerkle.sol — the next-gen draft batch proof
 * contract that adds Merkle root commits on top of the existing VRF +
 * salt-commit primitives. Each batch's 100 pre-derived (position,
 * draftType) leaves get Merkle-fingerprinted on-chain, so individual
 * drafts can be verified the moment their slot machine stops.
 *
 * Server forces the deployer wallet as the contract owner so all
 * subsequent ops (requestRandomnessAndCommit, commitMerkleRoot,
 * revealSalt) can be signed by the Go API's batchproof manager using
 * BBB4_OWNER_PRIVATE_KEY.
 *
 * Cutover after deploy:
 *   1. Add the new contract address as a VRF consumer on the same sub
 *   2. Flip system_config/batchProof.contractVariant to 'vrf-commit-merkle'
 *   3. Next batch will use the new system; existing batches stay legacy
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
    const vrfCoordinatorRaw = typeof body.vrfCoordinator === 'string' ? body.vrfCoordinator.trim() : '';
    const subscriptionIdRaw = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    const keyHashRaw = typeof body.keyHash === 'string' ? body.keyHash.trim() : '';
    const forceRedeploy = body.forceRedeploy === true;

    if (!isAddress(vrfCoordinatorRaw)) {
      throw new ApiError(400, `Invalid vrfCoordinator: ${vrfCoordinatorRaw}`);
    }
    if (!isHex(keyHashRaw) || keyHashRaw.length !== 66) {
      throw new ApiError(400, `Invalid keyHash (need 0x + 64 hex chars): ${keyHashRaw}`);
    }
    let subscriptionId: bigint;
    try {
      subscriptionId = BigInt(subscriptionIdRaw);
    } catch {
      throw new ApiError(400, `Invalid subscriptionId: ${subscriptionIdRaw}`);
    }
    if (subscriptionId <= 0n) throw new ApiError(400, 'subscriptionId must be > 0');

    const vrfCoordinator = vrfCoordinatorRaw as Address;
    const keyHash = keyHashRaw as Hex;

    const key = loadPrivateKey();
    if (!key) return jsonError('BBB4_OWNER_PRIVATE_KEY not configured', 503);

    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

    // Always the deployer — matches the wheel pattern, prevents the
    // onlyOwner mismatch bug that hit the wheel rollout.
    const initialOwner = account.address;

    if (isFirestoreConfigured() && !forceRedeploy) {
      const db = getAdminFirestore();
      const snap = await db.collection(SYSTEM_CONFIG).doc(MERKLE_PROOF_DOC).get();
      if (snap.exists) {
        const existing = snap.data() as MerkleProofConfig | undefined;
        if (existing?.contractAddress) {
          const code = await publicClient.getCode({ address: existing.contractAddress });
          if (code && code !== '0x') {
            return json({
              success: true,
              alreadyDeployed: true,
              contractAddress: existing.contractAddress,
              note: 'A Merkle batch proof contract is already deployed. Pass forceRedeploy:true to deploy a fresh one.',
              requestId,
            });
          }
        }
      }
    }

    const balance = await publicClient.getBalance({ address: account.address });
    const minWei = 500_000_000_000_000n;
    if (balance < minWei) {
      return jsonError(
        `Signer ${account.address} has ${balance} wei; need at least 0.0005 ETH for deploy gas.`,
        400,
      );
    }

    const walletClient = createWalletClient({
      account,
      chain: BASE,
      transport: http(BASE_RPC_URL),
    });

    logger.info('admin.deploy_batch_proof_merkle.submitting', {
      requestId,
      actor: actorWallet,
      from: account.address,
      vrfCoordinator,
      subscriptionId: subscriptionId.toString(),
      keyHash,
      initialOwner,
    });

    const txHash = await walletClient.deployContract({
      abi: BBB4_BATCH_PROOF_MERKLE_ABI,
      bytecode: BBB4_BATCH_PROOF_MERKLE_BYTECODE,
      args: [vrfCoordinator, subscriptionId, keyHash, initialOwner],
      ...BASE_GAS_PARAMS,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new ApiError(500, `Deploy transaction reverted: ${txHash}`);
    }
    const contractAddress = receipt.contractAddress;

    if (isFirestoreConfigured()) {
      const db = getAdminFirestore();
      const config: MerkleProofConfig = {
        contractAddress,
        vrfCoordinator,
        vrfSubscriptionId: subscriptionId.toString(),
        vrfKeyHash: keyHash,
        deployerAddress: account.address,
        deployTxHash: txHash,
        deployedAt: Date.now(),
        ownerAddress: initialOwner,
      };
      await db.collection(SYSTEM_CONFIG).doc(MERKLE_PROOF_DOC).set(config);
    }

    await logAdminAction({
      actor: actorWallet,
      action: 'deploy-batch-proof',
      target: contractAddress,
      after: {
        contractAddress,
        contractVariant: 'vrf-commit-merkle',
        vrfCoordinator,
        subscriptionId: subscriptionId.toString(),
        keyHash,
        initialOwner,
        deployTxHash: txHash,
        deployerAddress: account.address,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: Number(receipt.blockNumber),
      },
      requestId,
    });

    return json({
      success: true,
      contractAddress,
      contractVariant: 'vrf-commit-merkle',
      deployTxHash: txHash,
      deployerAddress: account.address,
      vrfCoordinator,
      subscriptionId: subscriptionId.toString(),
      keyHash,
      initialOwner,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      basescanContract: `https://basescan.org/address/${contractAddress}`,
      basescanTx: `https://basescan.org/tx/${txHash}`,
      nextSteps: [
        `Open https://vrf.chain.link → Subscriptions → ${subscriptionId.toString()} → Add consumer → paste ${contractAddress}`,
        'Make sure the subscription has at least 1 LINK funded',
        'Deploy Go API with vrf-commit-merkle variant support (Phase 2)',
        'Flip system_config/batchProof.contractVariant to "vrf-commit-merkle" to start using on next batch',
      ],
      requestId,
    });
  } catch (err) {
    logger.error('admin.deploy_batch_proof_merkle.failed', { requestId, actor: actorWallet, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { requestId });
  }
}
