import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN } from '@/lib/opensea';
import { SeaportABI } from '@opensea/seaport-js/lib/abi/Seaport';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';
const FULFILL_BASIC_ORDER_ALIAS = 'fulfillBasicOrder_efficient_6GL6yc';

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
