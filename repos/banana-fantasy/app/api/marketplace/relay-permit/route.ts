export const dynamic = 'force-dynamic';

import { createPublicClient, http, type Address, type Hex } from 'viem';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { paymentsEnabled } from '@/lib/envGates';
import { BASE, BASE_RPC_URL, BASE_SEPOLIA_USDC_ADDRESS, USDC_ABI } from '@/lib/contracts/bbb4';
import { getAdminWalletAddress, isAdminMintConfigured, submitUsdcPermit } from '@/lib/onchain/adminMint';
import { OPENSEA_CONDUIT_ADDRESS } from '@/lib/onchain/relaySeaport';
import { acquireAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { parsePermitSignature } from '@/lib/onchain/usdcPermit';
import { logger } from '@/lib/logger';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_UINT256 = 2n ** 256n - 1n;
const ADMIN_WALLET_GAS_FLOOR_WEI = 200_000_000_000_000n; // 0.0002 ETH — single tx

const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

/**
 * POST /api/marketplace/relay-permit
 *
 * Submits a user-signed EIP-2612 USDC permit on-chain with the ADMIN wallet
 * paying gas. The spender is FORCED server-side to the OpenSea conduit —
 * this exists solely so external-wallet users can grant the marketplace
 * USDC allowance (needed for offers) without paying gas or holding ETH.
 * The signature itself is the user's consent; we only relay it.
 */
export async function POST(req: Request) {
  if (!paymentsEnabled()) {
    return jsonError('Not available in this environment', 403);
  }
  if (!isAdminMintConfigured()) {
    return jsonError('Relay not configured', 503);
  }

  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody(req);
    const owner = requireString(body.owner, 'owner').toLowerCase();
    if (!WALLET_REGEX.test(owner)) {
      return jsonError('owner must be a wallet address', 400);
    }

    // The permit signature commits to the value — we just need the same
    // number to pass to permit(). Offers use max allowance (mirrors the
    // max approve the embedded flow does today).
    const valueStr = requireString(body.value, 'value');
    let value: bigint;
    try {
      value = BigInt(valueStr);
    } catch {
      return jsonError('value must be an integer string', 400);
    }
    if (value <= 0n || value > MAX_UINT256) {
      return jsonError('value out of range', 400);
    }

    const deadlineNum = typeof body.deadline === 'number' ? body.deadline : Number(body.deadline);
    if (!Number.isFinite(deadlineNum)) {
      return jsonError('deadline must be a unix timestamp (seconds)', 400);
    }
    if (deadlineNum < Math.floor(Date.now() / 1000)) {
      return jsonError('deadline has already passed', 400);
    }

    const signatureStr = requireString(body.signature, 'signature');
    const signature = (signatureStr.startsWith('0x') ? signatureStr : `0x${signatureStr}`) as Hex;
    let parsedSig: { v: number; r: Hex; s: Hex };
    try {
      parsedSig = parsePermitSignature(signature);
    } catch (err) {
      return jsonError(`invalid signature: ${(err as Error).message}`, 400);
    }

    const adminWallet = getAdminWalletAddress();
    if (!adminWallet) return jsonError('Admin wallet address unavailable', 503);

    const adminEthBalance = await publicClient.getBalance({ address: adminWallet });
    if (adminEthBalance < ADMIN_WALLET_GAS_FLOOR_WEI) {
      logger.error('relay-permit.admin_wallet_low_balance', { adminWallet, balanceWei: adminEthBalance.toString() });
      return jsonError('Temporarily unavailable — please try again in a few minutes.', 503);
    }

    // Already approved? No-op success (idempotent retries, stale clients).
    const currentAllowance = (await publicClient.readContract({
      address: BASE_SEPOLIA_USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'allowance',
      args: [owner as Address, OPENSEA_CONDUIT_ADDRESS],
    })) as bigint;
    if (currentAllowance >= value) {
      return json({ success: true, txHash: null, alreadyApproved: true });
    }

    const releaseAdminLock = await acquireAdminWalletLock('relay-permit');
    let txHash: Hex;
    try {
      txHash = await submitUsdcPermit({
        owner: owner as Address,
        spender: OPENSEA_CONDUIT_ADDRESS,
        value,
        deadline: BigInt(Math.floor(deadlineNum)),
        v: parsedSig.v,
        r: parsedSig.r,
        s: parsedSig.s,
      });
    } finally {
      await releaseAdminLock();
    }

    logger.info('relay-permit.ok', { owner, txHash });
    return json({ success: true, txHash });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('relay-permit.unhandled', { err: (err as Error).message });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
