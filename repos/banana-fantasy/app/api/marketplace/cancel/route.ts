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
 * Find SEVERAL orders by hash in ONE pagination sweep (vs one sweep per hash).
 * Returns whatever subset it finds; stops early once all are matched.
 */
async function findOrdersByHashes(
  kind: 'listings' | 'offers',
  orderHashes: string[],
): Promise<OpenSeaOrderRecord[]> {
  const wanted = new Set(orderHashes);
  const found: OpenSeaOrderRecord[] = [];
  const listKey = kind === 'offers' ? 'offers' : 'listings';
  const MAX_PAGES = 10;
  let cursor = '';
  for (let page = 0; page < MAX_PAGES && wanted.size > 0; page++) {
    const url = `${OPENSEA_API_BASE}/api/v2/${kind}/collection/${COLLECTION_SLUG}/all?limit=100${cursor ? `&next=${cursor}` : ''}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
      cache: 'no-store',
    });
    if (!res.ok) break;
    const data = await res.json();
    for (const o of (data[listKey] ?? []) as OpenSeaOrderRecord[]) {
      if (wanted.has(o.order_hash)) {
        found.push(o);
        wanted.delete(o.order_hash);
      }
    }
    if (!data.next) break;
    cursor = data.next;
  }
  return found;
}

/**
 * POST /api/marketplace/cancel
 *
 * Fetches order data from OpenSea, ABI-encodes the Seaport `cancel` call,
 * and returns { to, data } ready for Privy's gas-sponsored sendTransaction.
 * Accepts a single `orderHash` or an `orderHashes` array — Seaport's cancel
 * takes an array of orders, so cancelling N offers is still ONE transaction.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const body = await parseBody(req);
    const orderHashes: string[] = Array.isArray(body.orderHashes) && body.orderHashes.length > 0
      ? body.orderHashes.map(String)
      : [requireString(body.orderHash, 'orderHash')];
    const orderType = body.type || 'listing'; // 'listing' or 'offer'

    let orders: OpenSeaOrderRecord[] = [];

    if (orderType === 'offer') {
      orders = await findOrdersByHashes('offers', orderHashes);
    }

    if (orders.length < orderHashes.length) {
      const missing = orderHashes.filter(h => !orders.some(o => o.order_hash === h));
      orders = orders.concat(await findOrdersByHashes('listings', missing));
    }

    if (orders.length === 0) {
      return jsonError('Order not found — it may have already been cancelled', 404);
    }

    const allComponents = orders.map(order => {
      const params = order.protocol_data.parameters;
      return {
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
    });

    // ABI-encode the Seaport cancel call — one tx cancels every found order.
    const seaportInterface = new ethers.Interface(SeaportABI);
    const encodedData = seaportInterface.encodeFunctionData('cancel', [allComponents]);

    return json({
      to: CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      data: encodedData,
      cancelledHashes: orders.map(o => o.order_hash),
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/cancel] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
