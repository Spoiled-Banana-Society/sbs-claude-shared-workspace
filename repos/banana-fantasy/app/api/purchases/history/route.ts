import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireWalletAuth } from '@/lib/walletAuth';
import { getPurchaseHistory } from '@/lib/db';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.purchases);
  if (rateLimited) return rateLimited;
  try {
    // Server-derived wallet — purchase history is per-user PII.
    const { walletAddress: userId } = await requireWalletAuth(req);

    const history = await getPurchaseHistory(userId);
    return json(history, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
