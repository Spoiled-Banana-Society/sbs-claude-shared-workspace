export const dynamic = 'force-dynamic';

import { createPublicClient, http, type Address } from 'viem';
import { FieldValue } from 'firebase-admin/firestore';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { paymentsEnabled } from '@/lib/envGates';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import { getAdminWalletAddress, isAdminMintConfigured, sendEthFromAdmin } from '@/lib/onchain/adminMint';
import { getPrivyUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

const TOPUPS_COLLECTION = 'marketplace_gas_topups';
const MAX_TOPUPS_PER_DAY = 10;

// Target balances per action — what the wallet needs so its own fee estimate
// clears. Base fees are ~0.005 gwei, so these carry large headroom while
// still being fractions of a cent each. The route only funds the SHORTFALL.
const ACTION_TARGET_WEI: Record<string, bigint> = {
  // setApprovalForAll (~46k gas) / Seaport cancel (~55k gas)
  'approve-nft': 15_000_000_000_000n, // 0.000015 ETH
  cancel: 15_000_000_000_000n,
  // Seaport fulfillment when accepting an offer (~300k gas)
  'accept-offer': 50_000_000_000_000n, // 0.00005 ETH
  // ERC20.transfer for a cash-out send (~65k gas) — external wallets only;
  // embedded wallets use Privy gas sponsorship instead.
  withdraw: 20_000_000_000_000n, // 0.00002 ETH
};
const MAX_SINGLE_TOPUP_WEI = 50_000_000_000_000n; // hard cap per send
const ADMIN_WALLET_GAS_FLOOR_WEI = 200_000_000_000_000n;

const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * POST /api/marketplace/gas-topup
 *
 * "We pay the gas" for the marketplace actions an external wallet must send
 * itself (NFT approval, accept-offer fulfillment, cancel listing — none of
 * which can be signature-relayed). Sends the per-action gas amount to the
 * AUTHENTICATED user's wallet — ALWAYS, even if the wallet already has ETH, so
 * SBS covers gas for everyone incl. web3 users. Guard rails: Privy JWT
 * required, wallet comes from the token (not the body), fixed per-action
 * targets, hard per-send cap, daily per-wallet cap.
 */
export async function POST(req: Request) {
  if (!paymentsEnabled()) {
    return jsonError('Not available in this environment', 403);
  }
  if (!isAdminMintConfigured()) {
    return jsonError('Top-up not configured', 503);
  }

  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    // Wallet identity comes from the verified Privy token — the body only
    // says WHAT the user is about to do, never WHO gets funded.
    const { walletAddress } = await getPrivyUser(req);
    if (!walletAddress) {
      return jsonError('No wallet linked to this account', 400);
    }
    const wallet = walletAddress.toLowerCase() as Address;

    const body = await parseBody(req);
    const action = requireString(body.action, 'action');
    const target = ACTION_TARGET_WEI[action];
    if (!target) {
      return jsonError(`Unknown action: ${action}`, 400);
    }

    // Always fund the action's gas — even if the wallet already has ETH. SBS
    // covers gas for EVERYONE incl. web3 users with their own ETH (Richard's
    // call 2026-06-18). We send the full per-action amount rather than just the
    // shortfall; the per-wallet daily cap below bounds any abuse (a few cents).
    const amount = target;
    if (amount > MAX_SINGLE_TOPUP_WEI) {
      // Unreachable with the current targets; guards future target edits.
      return jsonError('Top-up amount out of range', 400);
    }

    const adminWallet = getAdminWalletAddress();
    if (!adminWallet) return jsonError('Admin wallet address unavailable', 503);
    const adminEthBalance = await publicClient.getBalance({ address: adminWallet });
    if (adminEthBalance < ADMIN_WALLET_GAS_FLOOR_WEI) {
      logger.error('gas-topup.admin_wallet_low_balance', { adminWallet, balanceWei: adminEthBalance.toString() });
      return jsonError('Temporarily unavailable — please try again in a few minutes.', 503);
    }

    // Daily cap per wallet, transactional so parallel requests can't bypass it.
    if (isFirestoreConfigured()) {
      const db = getAdminFirestore();
      const ref = db.collection(TOPUPS_COLLECTION).doc(wallet);
      const allowed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() ?? {};
        const day = dayKey();
        const count = data.dayKey === day ? ((data.dayCount as number) ?? 0) : 0;
        if (count >= MAX_TOPUPS_PER_DAY) return false;
        tx.set(ref, {
          dayKey: day,
          dayCount: count + 1,
          totalCount: FieldValue.increment(1),
          totalWei: FieldValue.increment(Number(amount)),
          lastAction: action,
          lastAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
      });
      if (!allowed) {
        logger.warn('gas-topup.daily_cap_hit', { wallet, action });
        return jsonError('Daily gas top-up limit reached — please try again tomorrow.', 429);
      }
    }

    const txHash = await sendEthFromAdmin({ to: wallet, amountWei: amount });
    logger.info(LOG_SOURCES.payment.GAS_TOPUP_SENT, {
      wallet,
      action,
      amountWei: amount.toString(),
      txHash,
    });

    return json({ success: true, funded: true, txHash });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('gas-topup.unhandled', { err: (err as Error).message });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
