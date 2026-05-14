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
  BANANA_WHEEL_PROOF_BYTECODE,
  BANANA_WHEEL_PROOF_ABI,
} from '@/lib/contracts/bananaWheelProofArtifact';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

const SYSTEM_CONFIG = 'system_config';
const WHEEL_PROOF_DOC = 'wheelProof';

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

interface WheelProofConfig {
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
 * POST /api/admin/deploy-banana-wheel-proof
 *   { vrfCoordinator: '0x...', subscriptionId: '12345...', keyHash: '0x...', initialOwner: '0x...' }
 *
 * Deploys BananaWheelProof.sol — the wheel-spin verifiability contract.
 * Mirrors the draft VRF+commit pattern with one addition: `commitMerkleRoot`
 * so every individual spin gets an instantly-verifiable Merkle proof.
 *
 * After deploy: add the contract address as a Consumer on the same Chainlink
 * VRF subscription used for draft batches (or a separate funded sub).
 *
 * Idempotent: refuses to redeploy if system_config/wheelProof already points
 * to a live contract on Base. Delete the doc to force a fresh deploy.
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
    const initialOwnerRaw = typeof body.initialOwner === 'string' ? body.initialOwner.trim() : '';

    if (!isAddress(vrfCoordinatorRaw)) {
      throw new ApiError(400, `Invalid vrfCoordinator: ${vrfCoordinatorRaw}`);
    }
    if (!isAddress(initialOwnerRaw)) {
      throw new ApiError(400, `Invalid initialOwner: ${initialOwnerRaw}`);
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
    const initialOwner = initialOwnerRaw as Address;
    const keyHash = keyHashRaw as Hex;

    const key = loadPrivateKey();
    if (!key) return jsonError('BBB4_OWNER_PRIVATE_KEY not configured', 503);

    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

    if (isFirestoreConfigured()) {
      const db = getAdminFirestore();
      const snap = await db.collection(SYSTEM_CONFIG).doc(WHEEL_PROOF_DOC).get();
      if (snap.exists) {
        const existing = snap.data() as WheelProofConfig | undefined;
        if (existing?.contractAddress) {
          const code = await publicClient.getCode({ address: existing.contractAddress });
          if (code && code !== '0x') {
            return json({
              success: true,
              alreadyDeployed: true,
              contractAddress: existing.contractAddress,
              note: 'A wheel proof contract is already deployed. Delete system_config/wheelProof in Firestore to force a fresh deploy.',
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

    logger.info('admin.deploy_wheel_proof.submitting', {
      requestId,
      actor: actorWallet,
      from: account.address,
      vrfCoordinator,
      subscriptionId: subscriptionId.toString(),
      keyHash,
      initialOwner,
    });

    const txHash = await walletClient.deployContract({
      abi: BANANA_WHEEL_PROOF_ABI,
      bytecode: BANANA_WHEEL_PROOF_BYTECODE,
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
      const config: WheelProofConfig = {
        contractAddress,
        vrfCoordinator,
        vrfSubscriptionId: subscriptionId.toString(),
        vrfKeyHash: keyHash,
        deployerAddress: account.address,
        deployTxHash: txHash,
        deployedAt: Date.now(),
        ownerAddress: initialOwner,
      };
      await db.collection(SYSTEM_CONFIG).doc(WHEEL_PROOF_DOC).set(config);
    }

    await logAdminAction({
      actor: actorWallet,
      action: 'deploy-wheel-proof',
      target: contractAddress,
      after: {
        contractAddress,
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
        'Then call POST /api/admin/wheel-period/open to bootstrap period 1',
      ],
      requestId,
    });
  } catch (err) {
    logger.error('admin.deploy_wheel_proof.failed', { requestId, actor: actorWallet, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { requestId });
  }
}
