import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN } from '@/lib/opensea';
import { SeaportABI } from '@opensea/seaport-js/lib/abi/Seaport';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const FULFILL_BASIC_ORDER_ALIAS = 'fulfillBasicOrder_efficient_6GL6yc';

/** Canonical decimal token id (strips leading zeros) for queue comparisons. */
function canonId(id: string): string {
  try { return BigInt(id).toString(); } catch { return id; }
}

/** Pull the offered NFT's token id out of Seaport fulfillment input data,
 *  whatever the order shape. Returns null when it can't be determined. */
function extractOfferIdentifier(inputData: Record<string, unknown>): string | null {
  try {
    const basic = inputData.basicOrderParameters as { offerIdentifier?: unknown } | undefined;
    if (basic?.offerIdentifier !== undefined) return canonId(String(basic.offerIdentifier));
    const adv = inputData.advancedOrder as { parameters?: { offer?: Array<{ identifierOrCriteria?: unknown }> } } | undefined;
    const advId = adv?.parameters?.offer?.[0]?.identifierOrCriteria;
    if (advId !== undefined) return canonId(String(advId));
    const ord = inputData.order as { parameters?: { offer?: Array<{ identifierOrCriteria?: unknown }> } } | undefined;
    const ordId = ord?.parameters?.offer?.[0]?.identifierOrCriteria;
    if (ordId !== undefined) return canonId(String(ordId));
  } catch { /* fall through */ }
  return null;
}

/**
 * POST /api/marketplace/fulfill
 *
 * Calls OpenSea's fulfillment API to get Seaport calldata,
 * ABI-encodes it, and returns { to, value, data } ready for
 * Privy's gas-sponsored sendTransaction.
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
    const buyerAddress = requireString(body.buyerAddress, 'buyerAddress');
    const protocolAddress = requireString(body.protocolAddress, 'protocolAddress');

    // Call OpenSea fulfillment API (same as opensea-js SDK internals)
    const payload = {
      listing: {
        hash: orderHash,
        chain: OPENSEA_CHAIN,
        protocol_address: protocolAddress,
      },
      fulfiller: {
        address: buyerAddress,
      },
      units_to_fill: '1',
      include_optional_creator_fees: false,
    };

    const fulfillRes = await fetch(
      `${OPENSEA_API_BASE}/v2/listings/fulfillment_data`,
      {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        body: JSON.stringify(payload),
      },
    );

    if (!fulfillRes.ok) {
      const text = await fulfillRes.text();
      console.error('[marketplace/fulfill] OpenSea error:', fulfillRes.status, text);
      return jsonError(
        `OpenSea fulfillment failed: ${fulfillRes.status}`,
        fulfillRes.status >= 500 ? 502 : fulfillRes.status,
      );
    }

    const fulfillData = await fulfillRes.json();
    const transaction = fulfillData.fulfillment_data.transaction;
    const inputData = transaction.input_data;

    // ABI-encode the Seaport call (same logic as opensea-js fulfillment.ts)
    const seaportInterface = new ethers.Interface(SeaportABI);
    const rawFunctionName = transaction.function.split('(')[0];
    const functionName =
      rawFunctionName === FULFILL_BASIC_ORDER_ALIAS
        ? 'fulfillBasicOrder'
        : rawFunctionName;

    let params: unknown[];
    if (functionName === 'fulfillAdvancedOrder' && 'advancedOrder' in inputData) {
      params = [
        inputData.advancedOrder,
        inputData.criteriaResolvers || [],
        inputData.fulfillerConduitKey ||
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        inputData.recipient,
      ];
    } else if (
      (functionName === 'fulfillBasicOrder' || rawFunctionName === FULFILL_BASIC_ORDER_ALIAS) &&
      'basicOrderParameters' in inputData
    ) {
      params = [inputData.basicOrderParameters];
    } else if (functionName === 'fulfillOrder' && 'order' in inputData) {
      params = [
        inputData.order,
        inputData.fulfillerConduitKey ||
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        inputData.recipient,
      ];
    } else {
      params = Object.values(inputData);
    }

    const encodedData = seaportInterface.encodeFunctionData(functionName, params);

    // LOCK-AT-FILL GUARD: a wheel-won JP/HOF pass is only sellable while its
    // special draft is still FILLING. The token id comes from the Seaport order
    // itself (not the client), and the queue round is the source of truth — the
    // round is either still 'filling' with an open seat (sale ok) or it isn't
    // (draft started; the pass is locked to whoever owned it at fill). State-
    // based, no clocks involved, so there is no timing edge to get wrong.
    const tokenIdent = extractOfferIdentifier(inputData);
    if (tokenIdent) {
      const { getQueueStatus } = await import('@/lib/db');
      const queues = await getQueueStatus().catch(() => null);
      if (queues) {
        for (const type of ['jackpot', 'hof'] as const) {
          for (const round of queues[type]?.rounds || []) {
            const member = (round.members || []).find(
              (m: { tokenId?: string }) => m.tokenId && canonId(String(m.tokenId)) === tokenIdent,
            );
            if (!member) continue;
            const locked = round.status !== 'filling' || (round.members || []).length >= 10;
            if (locked) {
              // Hide the dead listing from our marketplace going forward.
              try {
                const { recordCancelled } = await import('@/lib/marketplace/listingCache');
                await recordCancelled(String(member.tokenId), member.wallet);
              } catch { /* best-effort */ }
              return jsonError(
                'This draft already filled — the pass is locked and can no longer be bought.',
                409,
              );
            }
          }
        }
      }
    }

    return json({
      to: transaction.to,
      value: transaction.value,
      data: encodedData,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/fulfill] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
