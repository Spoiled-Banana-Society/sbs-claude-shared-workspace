import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireWalletAuth } from '@/lib/walletAuth';
import { recordDraftCompletion } from '@/lib/db';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const { walletAddress: userId } = await requireWalletAuth(req);
    const body = await parseBody(req);
    const draftId = requireString(body.draftId, 'draftId');

    const promo = await recordDraftCompletion(userId, draftId);
    return json({ promo }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
