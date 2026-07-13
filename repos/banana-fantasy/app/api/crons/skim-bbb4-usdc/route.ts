import { jsonError } from '@/lib/api/routeUtils';
import { skimBbb4Usdc, SkimConfigError } from '@/lib/onchain/skimBbb4Usdc';

export const dynamic = 'force-dynamic';

/**
 * Vercel cron entry-point that sweeps accumulated USDC out of the BBB4 contract
 * and forwards it to the cold treasury. The actual logic lives in
 * `lib/onchain/skimBbb4Usdc` so the admin-panel "Withdraw to treasury" button
 * shares ONE code path with this cron.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; we reject
 * anything else so the endpoint can't be hit by random internet callers.
 */

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed if secret not configured
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);

  try {
    const result = await skimBbb4Usdc({ source: 'cron' });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof SkimConfigError) return jsonError(err.message, err.status);
    throw err;
  }
}
