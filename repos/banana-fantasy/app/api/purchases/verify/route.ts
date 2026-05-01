import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireWalletAuth } from '@/lib/walletAuth';
import { verifyPurchase } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.purchases);
  if (rateLimited) return rateLimited;
  try {
    // Require auth — verifying someone else's purchaseId could nudge their
    // accounting state forward and credit their account. The DB layer
    // already keys by purchaseId, but auth here narrows the surface.
    await requireWalletAuth(req);
    const body = await parseBody(req);
    const purchaseId = requireString(body.purchaseId, 'purchaseId');
    const txHash = requireString(body.txHash, 'txHash');

    const result = await verifyPurchase(purchaseId, txHash);
    return json(result, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('purchases.verify.unhandled', { route: '/api/purchases/verify', err });
    return jsonError('Internal Server Error', 500);
  }
}
