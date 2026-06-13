import type { Address, Hex } from 'viem';

import { BASE_RPC_URL, BASE_SEPOLIA_USDC_ADDRESS } from '@/lib/contracts/bbb4';
import { BBB4_CONTRACT, OPENSEA_API_BASE, OPENSEA_CHAIN } from '@/lib/opensea';
import { getAdminPrivateKeyHex } from '@/lib/onchain/adminMint';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

// Same conduit constants the client-side listing/offer flows use
// (lib/marketplace/sell.ts). The admin wallet's USDC allowance must target
// the conduit because fulfillment pulls payment through it.
export const OPENSEA_CONDUIT_KEY = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000';
export const OPENSEA_CONDUIT_ADDRESS = '0x1e0049783f008a0085193e00003d00cd54003c71' as Address;

/** A signed Seaport order as returned by OpenSea's fulfillment_data API. */
export interface SignedSeaportOrder {
  parameters: {
    offerer: string;
    offer: Array<{ itemType: number; token: string; identifierOrCriteria: string; startAmount: string; endAmount: string }>;
    consideration: Array<{ itemType: number; token: string; identifierOrCriteria: string; startAmount: string; endAmount: string; recipient: string }>;
    [key: string]: unknown;
  };
  signature: string;
}

export interface RelayableListing {
  order: SignedSeaportOrder;
  /** Total USDC (6-decimals wei) the fulfiller pays: sum of all consideration items. */
  totalPriceUsdc: bigint;
  tokenId: string;
}

/**
 * Fetch a listing's signed order from OpenSea's fulfillment API with the
 * ADMIN wallet as fulfiller, and validate it is a relayable BBB4-for-USDC
 * order. Throws ApiError(409) when the listing is no longer fillable and
 * ApiError(400) when the order shape isn't one we relay. Performs NO
 * on-chain writes — safe to call before any money moves.
 */
export async function fetchRelayableListing(opts: {
  orderHash: string;
  protocolAddress: string;
  adminAddress: Address;
}): Promise<RelayableListing> {
  const apiKey = process.env.OPENSEA_API_KEY || '';
  if (!apiKey) throw new ApiError(503, 'OpenSea API key not configured');

  const res = await fetch(`${OPENSEA_API_BASE}/v2/listings/fulfillment_data`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      listing: {
        hash: opts.orderHash,
        chain: OPENSEA_CHAIN,
        protocol_address: opts.protocolAddress,
      },
      fulfiller: { address: opts.adminAddress },
      units_to_fill: '1',
      include_optional_creator_fees: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn('relaySeaport.fulfillment_data_failed', { orderHash: opts.orderHash, status: res.status, body: text.slice(0, 300) });
    // OpenSea 400s when the order was filled/cancelled/expired.
    throw new ApiError(409, 'This listing is no longer available. You were NOT charged.');
  }

  const data = (await res.json()) as {
    fulfillment_data?: { orders?: SignedSeaportOrder[] };
  };
  const order = data.fulfillment_data?.orders?.[0];
  if (!order?.parameters || !order.signature) {
    logger.error('relaySeaport.missing_signed_order', { orderHash: opts.orderHash });
    throw new ApiError(502, 'Could not load the listing order. You were NOT charged.');
  }

  const offer = order.parameters.offer;
  if (!Array.isArray(offer) || offer.length !== 1) {
    throw new ApiError(400, 'Unsupported listing shape (multi-item offer)');
  }
  // itemType 2 = ERC721; the relay only buys our own collection.
  if (offer[0].itemType !== 2 || offer[0].token.toLowerCase() !== BBB4_CONTRACT.toLowerCase()) {
    throw new ApiError(400, 'Listing is not an SBS draft pass');
  }

  const consideration = order.parameters.consideration;
  if (!Array.isArray(consideration) || consideration.length === 0) {
    throw new ApiError(400, 'Unsupported listing shape (no consideration)');
  }
  let total = 0n;
  for (const item of consideration) {
    // itemType 1 = ERC20. Every payment leg must be USDC on Base — anything
    // else (ETH-priced or mixed orders) is not relayable by this path.
    if (item.itemType !== 1 || item.token.toLowerCase() !== BASE_SEPOLIA_USDC_ADDRESS.toLowerCase()) {
      throw new ApiError(400, 'Listing is not priced in USDC');
    }
    if (item.startAmount !== item.endAmount) {
      throw new ApiError(400, 'Unsupported listing shape (declining price)');
    }
    total += BigInt(item.startAmount);
  }

  return {
    order,
    totalPriceUsdc: total,
    tokenId: String(offer[0].identifierOrCriteria),
  };
}

/**
 * Fulfill a signed Seaport listing FROM the admin wallet with the NFT
 * delivered straight to `recipient` (the real buyer). Admin pays the USDC
 * (already pulled from the buyer via permit) and all gas. Caller must hold
 * the admin-wallet lock and have ensured the conduit USDC allowance.
 */
export async function fulfillListingAsAdmin(opts: {
  order: SignedSeaportOrder;
  protocolAddress: string;
  recipient: Address;
}): Promise<Hex> {
  const key = getAdminPrivateKeyHex();
  if (!key) throw new ApiError(503, 'Admin wallet not configured');

  const { ethers } = await import('ethers');
  const { Seaport } = await import('@opensea/seaport-js');

  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  const signer = new ethers.Wallet(key, provider);

  const seaport = new Seaport(signer as unknown as ConstructorParameters<typeof Seaport>[0], {
    overrides: {
      contractAddress: opts.protocolAddress,
      defaultConduitKey: OPENSEA_CONDUIT_KEY,
    },
    conduitKeyToConduit: {
      [OPENSEA_CONDUIT_KEY]: OPENSEA_CONDUIT_ADDRESS,
    },
  });

  const { executeAllActions } = await seaport.fulfillOrder({
    order: opts.order as Parameters<typeof seaport.fulfillOrder>[0]['order'],
    accountAddress: signer.address,
    recipientAddress: opts.recipient,
  });

  // The conduit allowance is pre-approved by the route, so this sends the
  // single fulfillAdvancedOrder tx (recipient = buyer).
  // Cast: seaport-js's bundled ethers types clash with ours (see the note in
  // lib/marketplace/sell.ts) — at runtime this is an ethers v6
  // ContractTransactionResponse with .wait().
  const tx = (await executeAllActions()) as unknown as {
    hash: string;
    wait: () => Promise<{ status: number | null } | null>;
  };
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new ApiError(502, `Seaport fulfillment reverted (tx ${tx.hash})`);
  }
  logger.info('relaySeaport.fulfill.ok', { txHash: tx.hash, recipient: opts.recipient });
  return tx.hash as Hex;
}
