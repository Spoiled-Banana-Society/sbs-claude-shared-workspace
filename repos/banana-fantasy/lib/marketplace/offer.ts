/**
 * Create and accept offers on BBB4 NFTs using USDC on Base.
 *
 * An offer is the inverse of a listing:
 * - Listing: offer=[NFT], consideration=[USDC to seller + USDC fee]
 * - Offer:   offer=[USDC], consideration=[NFT to buyer + USDC fee]
 *
 * Flow: seaport-js createOrder → sign → POST to OpenSea API
 */
import { Seaport } from '@opensea/seaport-js';
import { ItemType } from '@opensea/seaport-js/lib/constants';
import { CROSS_CHAIN_SEAPORT_V1_6_ADDRESS } from '@opensea/seaport-js/lib/constants';
import { ethers } from 'ethers';
import { BBB4_CONTRACT, USDC_BASE } from '@/lib/opensea';

const OPENSEA_CONDUIT_KEY = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000';
const OPENSEA_CONDUIT_ADDRESS = '0x1e0049783f008a0085193e00003d00cd54003c71';
const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1f0df003000390027140000faa719';
const OPENSEA_FEE_BPS = 100; // 1%

export interface OfferResult {
  orderHash: string;
}

/**
 * Create a new USDC offer on an NFT via Seaport.
 *
 * The offerer puts up USDC and requests an NFT in return.
 * seaport-js handles USDC approval (via conduit) + EIP-712 signing.
 */
export async function createOffer(
  tokenId: string,
  offerAmountUsd: number,
  offererAddress: string,
  provider: ethers.BrowserProvider,
  expirationDays: number = 7,
): Promise<OfferResult> {
  const signer = await provider.getSigner();

  // Cast: ethers ships dual ESM/CommonJS builds and Seaport-js resolves the
  // CJS Signer type while the browser provider gives us the ESM one. The two
  // are runtime-compatible but TypeScript sees them as distinct nominal types.
  const seaport = new Seaport(signer as unknown as ConstructorParameters<typeof Seaport>[0], {
    overrides: {
      defaultConduitKey: OPENSEA_CONDUIT_KEY,
      contractAddress: CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
    },
    conduitKeyToConduit: {
      [OPENSEA_CONDUIT_KEY]: OPENSEA_CONDUIT_ADDRESS,
    },
  });

  // Convert USD to USDC wei (6 decimals)
  const totalWei = ethers.parseUnits(offerAmountUsd.toString(), 6);
  const feeAmount = (totalWei * BigInt(OPENSEA_FEE_BPS)) / BigInt(10000);

  const endTime = Math.floor(Date.now() / 1000) + expirationDays * 24 * 60 * 60;

  const { executeAllActions } = await seaport.createOrder(
    {
      offer: [
        {
          amount: totalWei.toString(),
          token: USDC_BASE,
        },
      ],
      consideration: [
        {
          itemType: ItemType.ERC721,
          token: BBB4_CONTRACT,
          identifier: tokenId,
          recipient: offererAddress,
        },
        ...(feeAmount > 0n
          ? [
              {
                amount: feeAmount.toString(),
                token: USDC_BASE,
                recipient: OPENSEA_FEE_RECIPIENT,
              },
            ]
          : []),
      ],
      endTime: endTime.toString(),
      conduitKey: OPENSEA_CONDUIT_KEY,
    },
    offererAddress,
  );

  // This handles USDC approval (if needed) + EIP-712 signing
  const order = await executeAllActions();

  // Post signed offer through our server route (keeps OPENSEA_API_KEY server-side).
  const postRes = await fetch('/api/marketplace/offers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...order,
      protocol_address: CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
    }),
  });

  if (!postRes.ok) {
    const text = await postRes.text();
    console.error('[offer] postOrder failed:', postRes.status, text);
    let detail = '';
    try {
      const errJson = JSON.parse(text);
      detail = errJson.error || errJson.message || text;
    } catch { detail = text; }
    throw new Error(detail || 'Failed to publish offer');
  }

  const result = await postRes.json();
  return { orderHash: result.orderHash || '' };
}

export interface OfferFulfillmentTx {
  to: string;
  value: string;
  data: string;
}

/**
 * Get the encoded Seaport transaction for accepting (fulfilling) an offer.
 * Returns { to, value, data } ready for Privy's sendTransaction.
 */
export async function getOfferFulfillmentTx(
  orderHash: string,
  sellerAddress: string,
  protocolAddress: string,
  tokenId: string,
): Promise<OfferFulfillmentTx> {
  const res = await fetch('/api/marketplace/offers/fulfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderHash,
      sellerAddress,
      protocolAddress,
      tokenId,
      contractAddress: BBB4_CONTRACT,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Offer fulfillment failed: ${res.status}`);
  }

  return res.json();
}
