/**
 * Sell/list a BBB4 NFT on OpenSea with USDC pricing on Base.
 *
 * Uses seaport-js directly (instead of opensea-js) to create orders
 * with USDC as the consideration token.
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
const OPENSEA_FEE_BPS = 100; // OpenSea takes 1% (since Sept 2025)

export interface ListingResult {
  orderHash: string;
}

/**
 * Create a new USDC listing on OpenSea via Seaport.
 */
export async function createListing(
  tokenId: string,
  priceUsd: number,
  sellerAddress: string,
  provider: ethers.BrowserProvider,
  expirationDays: number = 30,
): Promise<ListingResult> {
  const signer = await provider.getSigner();

  // See note in offer.ts — ethers ESM/CJS dual-package type mismatch with
  // Seaport-js. Runtime behavior is identical; this cast silences the
  // nominal-type clash that trips on cache-skipped npm installs.
  const seaport = new Seaport(signer as unknown as ConstructorParameters<typeof Seaport>[0], {
    overrides: {
      defaultConduitKey: OPENSEA_CONDUIT_KEY,
      contractAddress: CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
    },
    conduitKeyToConduit: {
      [OPENSEA_CONDUIT_KEY]: OPENSEA_CONDUIT_ADDRESS,
    },
  });

  // Convert USD price to USDC wei (6 decimals)
  const normalizedPriceUsd = priceUsd.toFixed(2);
  const priceWei = ethers.parseUnits(normalizedPriceUsd, 6);
  const feeAmount = (priceWei * BigInt(OPENSEA_FEE_BPS)) / BigInt(10000);
  const sellerAmount = priceWei - feeAmount;

  const endTime = Math.floor(Date.now() / 1000) + expirationDays * 24 * 60 * 60;

  const { executeAllActions } = await seaport.createOrder(
    {
      offer: [
        {
          itemType: ItemType.ERC721,
          token: BBB4_CONTRACT,
          identifier: tokenId,
        },
      ],
      consideration: [
        {
          amount: sellerAmount.toString(),
          token: USDC_BASE,
          recipient: sellerAddress,
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
    sellerAddress,
  );

  // This handles NFT approval (if needed) + EIP-712 signing
  const order = await executeAllActions();

  // Post signed order through our server route (keeps OPENSEA_API_KEY server-side).
  const postRes = await fetch('/api/marketplace/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...order,
      protocol_address: CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
    }),
  });

  if (!postRes.ok) {
    const text = await postRes.text();
    console.error('[sell] postOrder failed:', postRes.status, text);
    let detail = '';
    try {
      const errJson = JSON.parse(text);
      detail = errJson.error || errJson.message || text;
    } catch { detail = text; }
    throw new Error(detail || 'Failed to publish listing');
  }

  const result = await postRes.json();
  return { orderHash: result.orderHash || '' };
}
