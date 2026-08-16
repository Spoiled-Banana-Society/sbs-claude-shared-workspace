import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { revealVaultClicks } from '@/lib/bananaVault';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    const revealed = await revealVaultClicks(userId);
    return json({ revealed }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
