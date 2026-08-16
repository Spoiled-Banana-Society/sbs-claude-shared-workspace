export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { rateLimit } from '@/lib/rateLimit';
import { requirePartnerKey, resolveMember } from '@/lib/privateLeaguePartner';
import { allowedEntriesFor } from '@/lib/privateLeagueAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/private-league/{id}/partner/resolve?username=…[&wallet=…]
 *   Authorization: Bearer <league api key>
 *
 * "Does this SBS account exist?" — for the commissioner's checkout to
 * validate BEFORE taking payment, so a typo can't strand an entry. Username
 * first, wallet as fallback; both given → they must be the same account.
 * Returns the canonical username + the account's current allowance in this
 * league. Never returns a wallet address the caller didn't already send.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const ctx = await requirePartnerKey(req, params.id);
    const sp = new URL(req.url).searchParams;
    const res = await resolveMember({ username: sp.get('username') ?? undefined, wallet: sp.get('wallet') ?? undefined });
    if (!res.ok) {
      if (res.reason === 'missing') throw new ApiError(400, res.detail);
      return json({ found: false, reason: res.reason, message: res.detail });
    }
    return json({
      found: true,
      username: res.member.username,
      matchedBy: res.member.matchedBy,
      entriesAllowed: allowedEntriesFor(ctx.cfg, res.member.wallet),
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('private_league_partner.resolve.error', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Could not look that up right now', 500);
  }
}
