export const dynamic = 'force-dynamic';

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { FieldValue } from 'firebase-admin/firestore';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { BASE, BASE_RPC_URL, BASE_SEPOLIA_USDC_ADDRESS, USDC_ABI } from '@/lib/contracts/bbb4';
import {
  getAdminWalletAddress,
  isAdminMintConfigured,
  submitUsdcPermit,
  pullUsdcFromUser,
  transferUsdcFromAdmin,
  ensureAdminUsdcAllowance,
} from '@/lib/onchain/adminMint';
import {
  fetchRelayableListing,
  fulfillListingAsAdmin,
  OPENSEA_CONDUIT_ADDRESS,
} from '@/lib/onchain/relaySeaport';
import { acquireAdminWalletLock } from '@/lib/onchain/adminWalletLock';
import { parsePermitSignature } from '@/lib/onchain/usdcPermit';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const FAILED_RELAYS_COLLECTION = 'failed_marketplace_relays';
// Sanity ceiling on a single relayed purchase — no legit BBB4 listing should
// exceed this; protects the admin wallet from absurd permit values.
const MAX_RELAY_USDC = 50_000n * 1_000_000n;
// permit + transferFrom + (one-time approve) + fulfill can be four txs.
const ADMIN_WALLET_GAS_FLOOR_WEI = 1_000_000_000_000_000n; // 0.001 ETH

const publicClient = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });

/**
 * POST /api/marketplace/relay-buy
 *
 * Gasless marketplace Buy Now for EXTERNAL wallets (MetaMask, Coinbase
 * Wallet, …) — the same permit-relay pattern card-mint uses. The buyer
 * signs an off-chain EIP-2612 USDC permit (no gas prompt, no ETH needed)
 * and the admin wallet executes everything on-chain:
 *   1. USDC.permit(buyer, adminWallet, price, deadline, v, r, s)
 *   2. USDC.transferFrom(buyer, adminWallet, price)
 *   3. Seaport.fulfillAdvancedOrder(order, …, recipient = buyer)
 * The NFT lands directly in the buyer's wallet; the admin never holds it.
 * If fulfillment fails after the pull, the buyer is refunded automatically.
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Not available in this environment', 403);
  }
  if (!isAdminMintConfigured()) {
    return jsonError('Relay not configured', 503);
  }

  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody(req);
    const buyerAddress = requireString(body.buyerAddress, 'buyerAddress').toLowerCase();
    if (!WALLET_REGEX.test(buyerAddress)) {
      return jsonError('buyerAddress must be a wallet address', 400);
    }
    const orderHash = requireString(body.orderHash, 'orderHash');
    const protocolAddress = requireString(body.protocolAddress, 'protocolAddress');
    if (!WALLET_REGEX.test(protocolAddress)) {
      return jsonError('protocolAddress must be an address', 400);
    }

    const deadlineNum = typeof body.deadline === 'number' ? body.deadline : Number(body.deadline);
    if (!Number.isFinite(deadlineNum)) {
      return jsonError('deadline must be a unix timestamp (seconds)', 400);
    }
    if (deadlineNum < Math.floor(Date.now() / 1000)) {
      return jsonError('deadline has already passed', 400);
    }
    const deadline = BigInt(Math.floor(deadlineNum));

    const signatureStr = requireString(body.signature, 'signature');
    const signature = (signatureStr.startsWith('0x') ? signatureStr : `0x${signatureStr}`) as Hex;
    let parsedSig: { v: number; r: Hex; s: Hex };
    try {
      parsedSig = parsePermitSignature(signature);
    } catch (err) {
      return jsonError(`invalid signature: ${(err as Error).message}`, 400);
    }

    // The value the buyer's permit signature commits to. May sit slightly
    // ABOVE the order total (clients without the exact wei price round up a
    // cent); we permit this value but only ever PULL the exact order total.
    const permitValueStr = requireString(body.permitValue, 'permitValue');
    let permitValue: bigint;
    try {
      permitValue = BigInt(permitValueStr);
    } catch {
      return jsonError('permitValue must be an integer string', 400);
    }

    const adminWallet = getAdminWalletAddress();
    if (!adminWallet) return jsonError('Admin wallet address unavailable', 503);
    const buyer = buyerAddress as Address;

    if (buyer.toLowerCase() === adminWallet.toLowerCase()) {
      return jsonError('Cannot relay-buy from the admin wallet', 400);
    }

    // Fail fast before the buyer's permit nonce is consumed.
    const adminEthBalance = await publicClient.getBalance({ address: adminWallet });
    if (adminEthBalance < ADMIN_WALLET_GAS_FLOOR_WEI) {
      logger.error('relay-buy.admin_wallet_low_balance', {
        adminWallet,
        balanceWei: adminEthBalance.toString(),
      });
      return jsonError(
        'Purchases are temporarily paused for maintenance. Your funds are safe — please try again in a few minutes.',
        503,
      );
    }

    // Load + validate the signed order BEFORE any on-chain action. This also
    // confirms the listing is still fillable — nothing has been charged yet.
    const listing = await fetchRelayableListing({ orderHash, protocolAddress, adminAddress: adminWallet });
    const price = listing.totalPriceUsdc;
    if (price <= 0n || price > MAX_RELAY_USDC) {
      return jsonError('Listing price is out of the relayable range', 400);
    }
    // The signed permit must cover the order total, and may not exceed it by
    // more than $1 (rounding headroom only — never a blank check).
    if (permitValue < price || permitValue > price + 1_000_000n) {
      return jsonError('Price changed — please refresh and try again. You were NOT charged.', 409);
    }
    // The seller can't buy their own listing through the relay.
    if (listing.order.parameters.offerer.toLowerCase() === buyerAddress) {
      return jsonError('You cannot buy your own listing', 400);
    }

    // Serialize on the shared admin wallet (same lock as card-mint) so
    // concurrent purchases can't race on the tx nonce or USDC allowance.
    const releaseAdminLock = await acquireAdminWalletLock('relay-buy');
    let fulfillTxHash: Hex | undefined;
    let pulled = false;
    let transferTxHash: Hex | undefined;
    let permitTxHash: Hex | 'skipped' = 'skipped';
    try {
      const readAllowance = () =>
        publicClient.readContract({
          address: BASE_SEPOLIA_USDC_ADDRESS,
          abi: USDC_ABI,
          functionName: 'allowance',
          args: [buyer, adminWallet],
        }) as Promise<bigint>;

      // 1. Permit — submitted with the exact value the buyer signed. A stale
      //    client price simply reverts here, before any money moves.
      if ((await readAllowance()) < price) {
        try {
          permitTxHash = await submitUsdcPermit({
            owner: buyer,
            spender: adminWallet,
            value: permitValue,
            deadline,
            v: parsedSig.v,
            r: parsedSig.r,
            s: parsedSig.s,
          });
        } catch (err) {
          logger.warn('relay-buy.permit_failed', { buyerAddress, orderHash, err: (err as Error).message });
          if (err instanceof ApiError) return jsonError(err.message, err.status);
          return jsonError(`Permit failed: ${(err as Error).message}`, 400);
        }
      }
      if ((await readAllowance()) < price) {
        return jsonError('Approval didn’t go through — please tap Buy again. You were NOT charged.', 409);
      }

      // 2. Pull the purchase USDC into the admin wallet (it pays Seaport).
      try {
        transferTxHash = await pullUsdcFromUser({ owner: buyer, to: adminWallet, amount: price });
        pulled = true;
      } catch (err) {
        logger.error('relay-buy.transferFrom_failed', { buyerAddress, orderHash, err: (err as Error).message });
        if (err instanceof ApiError) return jsonError(err.message, err.status);
        return jsonError(`USDC transfer failed: ${(err as Error).message}`, 402);
      }

      // 3. One-time: the conduit must be able to pull USDC from the admin.
      await ensureAdminUsdcAllowance({ spender: OPENSEA_CONDUIT_ADDRESS, min: price });

      // 4. Fulfill with recipient = buyer. NFT goes straight to their wallet.
      fulfillTxHash = await fulfillListingAsAdmin({
        order: listing.order,
        protocolAddress,
        recipient: buyer,
      });
    } catch (err) {
      if (!pulled) throw err;
      // Money was pulled but the purchase didn't complete (e.g. sniped by a
      // concurrent buyer). Refund immediately; if even the refund fails,
      // record it for ops — the user must never silently lose funds.
      logger.error('relay-buy.fulfill_failed_after_pull', {
        buyerAddress, orderHash, price: price.toString(), transferTxHash, err: (err as Error).message,
      });
      try {
        const refundTxHash = await transferUsdcFromAdmin({ to: buyer, amount: price });
        logger.info('relay-buy.refunded', { buyerAddress, orderHash, refundTxHash });
        return jsonError(
          'The purchase couldn’t complete (the listing may have just sold). Your USDC has been refunded in full.',
          409,
          { refunded: true },
        );
      } catch (refundErr) {
        logger.error(LOG_SOURCES.payment.RELAY_REFUND_FAILED, {
          buyerAddress, orderHash, price: price.toString(), err: (refundErr as Error).message,
        });
        if (isFirestoreConfigured()) {
          try {
            await getAdminFirestore().collection(FAILED_RELAYS_COLLECTION).add({
              source: 'relay-buy',
              buyerAddress,
              orderHash,
              priceUsdc: price.toString(),
              transferTxHash: transferTxHash ?? null,
              error: (err as Error).message,
              refundError: (refundErr as Error).message,
              createdAt: FieldValue.serverTimestamp(),
              resolved: false,
            });
          } catch (recErr) {
            logger.error('relay-buy.failed_record_error', { buyerAddress, err: (recErr as Error).message });
          }
        }
        return jsonError(
          'The purchase couldn’t complete and the automatic refund is queued. Your funds are safe and will be returned shortly — contact support if you don’t see them soon.',
          500,
          { refundPending: true },
        );
      }
    } finally {
      await releaseAdminLock();
    }

    logger.info(LOG_SOURCES.payment.RELAY_BUY_COMPLETED, {
      buyerAddress,
      orderHash,
      tokenId: listing.tokenId,
      priceUsdc: Number(price) / 1_000_000,
      txHash: fulfillTxHash,
    });

    return json({
      success: true,
      txHash: fulfillTxHash,
      tokenId: listing.tokenId,
      priceUsdc: Number(price) / 1_000_000,
      txHashes: { permit: permitTxHash, transferFrom: transferTxHash, fulfill: fulfillTxHash },
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('relay-buy.unhandled', { err: (err as Error).message, stack: (err as Error).stack });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
