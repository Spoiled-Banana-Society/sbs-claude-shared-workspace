import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { recordPick10 } from '@/lib/db';
import { getPrivyUser } from '@/lib/auth';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    // Best-effort authorization. This promo write fires automatically from the
    // draft room WITHOUT an Authorization header, so a MISSING token must NOT
    // reject the call (requiring one regressed all promo recording). If a token
    // IS present we enforce that it matches the userId, so an authenticated
    // session can't record another wallet's promo. The real protection lives in
    // recordPick10 (resolveDraftPassType blocks free passes + per-draft dedupe).
    // Fully closing the "trust the client" gap — verify the caller actually
    // holds a paid token for this draft — is a separate, tested change.
    let authedWallet: string | null = null;
    try {
      const { walletAddress } = await getPrivyUser(req);
      authedWallet = (walletAddress || '').toLowerCase();
    } catch {
      authedWallet = null; // no/invalid token — fall through to server-side gates
    }
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    if (authedWallet && authedWallet !== userId.toLowerCase()) {
      return jsonError('Forbidden — wallet mismatch', 403);
    }
    const draftId = requireString(body.draftId, 'draftId');
    const draftName = typeof body.draftName === 'string' ? body.draftName : draftId;
    // Free-pass drafts earn no promo credit (server-enforced in recordPick10).
    const passType = typeof body.passType === 'string' ? body.passType : undefined;

    const promo = await recordPick10(userId, draftId, draftName, passType);
    return json({ promo }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
