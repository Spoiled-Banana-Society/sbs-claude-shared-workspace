import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { verifyPurchase } from '@/lib/db';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.purchases);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody(req);
    const purchaseId = requireString(body.purchaseId, 'purchaseId');
    const txHash = requireString(body.txHash, 'txHash');

    const result = await verifyPurchase(purchaseId, txHash);
    return json(result, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
