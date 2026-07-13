/**
 * GET /api/marketplace/resolve-users?wallets=0x..,0x..
 *
 * Batch wallet → username map for the activity feed (turns the from/to hex
 * addresses into usernames). Read-only, no auth. Only wallets that have set a
 * real username appear in the result; callers fall back to a short address.
 *
 *   { names: { "0xabc…": "Boris", … } }
 */

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json } from '@/lib/api/routeUtils';
import { getUserDisplayBatch } from '@/lib/db';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX = 60;

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const raw = (new URL(req.url).searchParams.get('wallets') || '').split(',');
  const wallets = Array.from(new Set(
    raw.map((w) => w.trim().toLowerCase()).filter((w) => WALLET_RE.test(w)),
  )).slice(0, MAX);

  if (wallets.length === 0) return json({ names: {} });

  const names: Record<string, string> = {};
  try {
    const display = await getUserDisplayBatch(wallets);
    for (const [wallet, info] of Object.entries(display)) {
      if (info?.username) names[wallet] = info.username;
    }
  } catch {
    // Best-effort — an empty map just means the feed shows short addresses.
  }
  return json({ names });
}
