/**
 * POST /api/admin/deploy-wheel-assignment-journal
 *   { forceRedeploy?: boolean }
 *
 * Deploys BananaWheelAssignmentJournal.sol — the contract that locks
 * per-100 spin wallet→spinIndex assignments on-chain. Companion to the
 * existing BananaWheelProof; closes the only remaining trust gap in
 * the provably-fair wheel.
 *
 * Owner is the deployer wallet (same key the cron uses to call
 * `commitAssignmentBatch`). After deploy, `system_config/wheelAssignmentJournal`
 * is set so the cron picks up the contract address on its next tick.
 *
 * Idempotent: refuses to redeploy if a contract is already configured
 * unless `forceRedeploy=true`.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

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
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import {
  BANANA_WHEEL_ASSIGNMENT_JOURNAL_BYTECODE,
  BANANA_WHEEL_ASSIGNMENT_JOURNAL_ABI,
} from '@/lib/contracts/bananaWheelAssignmentJournalArtifact';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

const SYSTEM_CONFIG = 'system_config';
const JOURNAL_DOC = 'wheelAssignmentJournal';

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

interface JournalConfig {
  contractAddress?: Address;
  deployerAddress?: Address;
  deployTxHash?: Hex;
  deployedAt?: number;
  ownerAddress?: Address;
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = admin.walletAddress ?? admin.userId;

    const body = await parseBody(req).catch(() => ({}) as Record<string, unknown>);
    const forceRedeploy = body.forceRedeploy === true;

    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();
    const cfgRef = db.collection(SYSTEM_CONFIG).doc(JOURNAL_DOC);
    const existing = await cfgRef.get();
    if (existing.exists && !forceRedeploy) {
      const existingCfg = existing.data() as JournalConfig;
      if (existingCfg.contractAddress) {
        return jsonError(
          `Already deployed at ${existingCfg.contractAddress}. Pass forceRedeploy=true to override.`,
          409,
          { requestId, existing: existingCfg },
        );
      }
    }

    const key = loadPrivateKey();
    if (!key) return jsonError('BBB4_OWNER_PRIVATE_KEY not configured', 503);

    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });
    const walletClient = createWalletClient({ account, chain: BASE, transport: http(BASE_RPC_URL) });

    // Deploy. Constructor takes one arg: initialOwner. We use the deployer
    // wallet so the cron can immediately call commitAssignmentBatch.
    const txHash = await walletClient.deployContract({
      abi: BANANA_WHEEL_ASSIGNMENT_JOURNAL_ABI,
      bytecode: BANANA_WHEEL_ASSIGNMENT_JOURNAL_BYTECODE,
      args: [account.address],
      ...BASE_GAS_PARAMS,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new ApiError(500, `Deploy reverted: tx ${txHash}`);
    }

    const contractAddress = receipt.contractAddress as Address;
    const cfg: JournalConfig = {
      contractAddress,
      deployerAddress: account.address,
      deployTxHash: txHash,
      deployedAt: Date.now(),
      ownerAddress: account.address,
    };
    await cfgRef.set(cfg, { merge: true });

    await logAdminAction({
      actor: actorWallet,
      action: 'deploy-wheel-assignment-journal',
      target: contractAddress,
      after: {
        contractAddress,
        deployer: account.address,
        deployTxHash: txHash,
      },
      requestId,
    });

    logger.info('admin.deploy_wheel_assignment_journal.ok', {
      route: 'admin/deploy-wheel-assignment-journal',
      actor: actorWallet,
      context: { contractAddress, txHash },
    });

    return json({
      ok: true,
      contractAddress,
      deployTxHash: txHash,
      deployerAddress: account.address,
      requestId,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.deploy_wheel_assignment_journal.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/deploy-wheel-assignment-journal',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}

/**
 * GET /api/admin/deploy-wheel-assignment-journal
 * Returns the current journal config so the admin panel can render
 * its "deployed at 0x… / not deployed" status without needing a
 * separate route for the simple Firestore read.
 */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) {
      return json({ ok: true, config: null, requestId });
    }
    const db = getAdminFirestore();
    const snap = await db.collection(SYSTEM_CONFIG).doc(JOURNAL_DOC).get();
    if (!snap.exists) return json({ ok: true, config: null, requestId });
    return json({ ok: true, config: snap.data() as JournalConfig, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
