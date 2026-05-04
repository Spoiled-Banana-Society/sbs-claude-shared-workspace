import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, COLLECTION_SLUG } from '@/lib/opensea';
import { SeaportABI } from '@opensea/seaport-js/lib/abi/Seaport';
import { CROSS_CHAIN_SEAPORT_V1_6_ADDRESS } from '@opensea/seaport-js/lib/constants';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * POST /api/marketplace/cancel
 *
 * Fetches order data from OpenSea, ABI-encodes the Seaport `cancel` call,
 * and returns { to, data } ready for Privy's gas-sponsored sendTransaction.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const body = await parseBody(req);
    const orderHash = requireString(body.orderHash, 'orderHash');
    const orderType = body.type || 'listing'; // 'listing' or 'offer'

    let order = null;

    if (orderType === 'offer') {
      // Search offers for this collection
      const offersRes = await fetch(
        `${OPENSEA_API_BASE}/api/v2/offers/collection/${COLLECTION_SLUG}/all?limit=50`,
        {
          headers: {
            accept: 'application/json',
            'x-api-key': OPENSEA_API_KEY,
          },
          cache: 'no-store',
        },
      );

      if (offersRes.ok) {
        const offersData = await offersRes.json();
        const offers = offersData.offers ?? [];
        order = offers.find((o: { order_hash: string }) => o.order_hash === orderHash);
      }
    }

    if (!order) {
      // Search listings
      const listingsRes = await fetch(
        `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=50`,
        {
          headers: {
            accept: 'application/json',
            'x-api-key': OPENSEA_API_KEY,
          },
          cache: 'no-store',
        },
      );

      if (listingsRes.ok) {
        const listingsData = await listingsRes.json();
        const listings = listingsData.listings ?? [];
        order = listings.find((l: { order_hash: string }) => l.order_hash === orderHash);
      }
    }

    if (!order) {
      return jsonError('Order not found — it may have already been cancelled', 404);
    }

    const params = order.protocol_data.parameters;

    // Build OrderComponents struct for Seaport cancel
    const orderComponents = {
      offerer: params.offerer,
      zone: params.zone,
      offer: params.offer.map((o: Record<string, unknown>) => ({
        itemType: o.itemType,
        token: o.token,
        identifierOrCriteria: o.identifierOrCriteria,
        startAmount: o.startAmount,
        endAmount: o.endAmount,
      })),
      consideration: params.consideration.map((c: Record<string, unknown>) => ({
        itemType: c.itemType,
        token: c.token,
        identifierOrCriteria: c.identifierOrCriteria,
        startAmount: c.startAmount,
        endAmount: c.endAmount,
        recipient: c.recipient,
      })),
      orderType: params.orderType,
      startTime: params.startTime,
      endTime: params.endTime,
      zoneHash: params.zoneHash,
      salt: params.salt,
      conduitKey: params.conduitKey,
      counter: params.counter,
    };

    // ABI-encode the Seaport cancel call
    const seaportInterface = new ethers.Interface(SeaportABI);
    const encodedData = seaportInterface.encodeFunctionData('cancel', [[orderComponents]]);

    return json({
      to: CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      data: encodedData,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/cancel] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
