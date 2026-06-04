import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, COLLECTION_SLUG } from '@/lib/opensea';
import { SeaportABI } from '@opensea/seaport-js/lib/abi/Seaport';
import { CROSS_CHAIN_SEAPORT_V1_6_ADDRESS } from '@opensea/seaport-js/lib/constants';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

interface OpenSeaOrderRecord {
  order_hash: string;
  protocol_data: {
    parameters: {
      offerer: unknown;
      zone: unknown;
      offer: Record<string, unknown>[];
      consideration: Record<string, unknown>[];
      orderType: unknown;
      startTime: unknown;
      endTime: unknown;
      zoneHash: unknown;
      salt: unknown;
      conduitKey: unknown;
      counter: unknown;
    };
  };
}

/**
 * Find an OpenSea order (listing or offer) by hash, paginating via the `next`
 * cursor. The old single-page (limit=50) lookup 404'd once a collection had
 * more than 50 active orders. Capped at MAX_PAGES to bound work.
 */
async function findOrderByHash(
  kind: 'listings' | 'offers',
  orderHash: string,
): Promise<OpenSeaOrderRecord | null> {
  const listKey = kind === 'offers' ? 'offers' : 'listings';
  const MAX_PAGES = 10;
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${OPENSEA_API_BASE}/api/v2/${kind}/collection/${COLLECTION_SLUG}/all?limit=100${cursor ? `&next=${cursor}` : ''}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const orders: OpenSeaOrderRecord[] = data[listKey] ?? [];
    const match = orders.find((o) => o.order_hash === orderHash);
    if (match) return match;
    if (!data.next) break;
    cursor = data.next;
  }
  return null;
}

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

    let order: OpenSeaOrderRecord | null = null;

    if (orderType === 'offer') {
      order = await findOrderByHash('offers', orderHash);
    }

    if (!order) {
      order = await findOrderByHash('listings', orderHash);
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
