export const dynamic = 'force-dynamic';

import { FieldPath } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { rateLimit } from '@/lib/rateLimit';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requirePartnerKey, resolveMember } from '@/lib/privateLeaguePartner';
import { allowedEntriesFor, type PrivateLeagueConfigDoc } from '@/lib/privateLeagueAdmin';
import { logAdminAction } from '@/lib/adminAudit';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

/**
 * POST /api/private-league/{id}/partner/entries
 *   Authorization: Bearer <league api key>
 *   { username?: string, wallet?: string, entries: 1..5, orderRef: string }
 *
 * Grants `entries` more seats in this league to the SBS account named by
 * username (or wallet as fallback) — the commissioner's checkout calls this
 * after a paid order. Idempotent on `orderRef` (a retry or a double webhook
 * returns the original result with duplicate:true instead of granting twice).
 * Every grant is audited like an admin bump, and the commissioner's admin
 * page shows the new allowance immediately (same Entries map).
 */
const MAX_PER_CALL = 5;
const ORDER_RE = /^[A-Za-z0-9_.:-]{3,80}$/;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const requestId = getRequestId(req);
  try {
    const ctx = await requirePartnerKey(req, params.id);
    const body = await parseBody<{ username?: string; wallet?: string; entries?: number; orderRef?: string }>(req);

    const entries = Number(body.entries);
    if (!Number.isInteger(entries) || entries < 1 || entries > MAX_PER_CALL) {
      throw new ApiError(400, `entries must be a whole number from 1 to ${MAX_PER_CALL}`);
    }
    const orderRef = String(body.orderRef ?? '').trim();
    if (!ORDER_RE.test(orderRef)) throw new ApiError(400, 'orderRef is required (3–80 chars: letters, numbers, - _ . :)');

    const res = await resolveMember({ username: body.username, wallet: body.wallet });
    if (!res.ok) throw new ApiError(res.reason === 'not_found' ? 404 : res.reason === 'mismatch' ? 409 : 400, res.detail);
    const member = res.member;

    const db = getAdminFirestore();
    const grantRef = ctx.cfgRef.collection('api_grants').doc(orderRef);
    let before = 0;
    let after = 0;
    let duplicate = false;
    await db.runTransaction(async (tx) => {
      const [cfgSnap, grantSnap] = await Promise.all([tx.get(ctx.cfgRef), tx.get(grantRef)]);
      if (!cfgSnap.exists) throw new ApiError(404, 'League not found');
      if (grantSnap.exists) {
        const g = grantSnap.data() as { before?: number; after?: number };
        before = g.before ?? 0;
        after = g.after ?? 0;
        duplicate = true;
        return;
      }
      const cfg = (cfgSnap.data() ?? {}) as PrivateLeagueConfigDoc;
      before = allowedEntriesFor(cfg, member.wallet);
      after = before + entries;
      tx.update(ctx.cfgRef, new FieldPath('Entries', member.wallet), after);
      tx.set(grantRef, {
        orderRef,
        username: member.username,
        wallet: member.wallet,
        matchedBy: member.matchedBy,
        entries,
        before,
        after,
        requestId,
        createdAt: new Date().toISOString(),
      });
    });

    if (!duplicate) {
      await logAdminAction({
        actor: `partner:${ctx.leagueId}`,
        action: 'private-league-api-grant',
        target: member.wallet,
        before: { leagueId: ctx.leagueId, allowed: before, orderRef },
        after: { leagueId: ctx.leagueId, allowed: after, entries, username: member.username, matchedBy: member.matchedBy },
        requestId,
      });
    }
    logger.info('private_league_partner.grant', {
      leagueId: ctx.leagueId, username: member.username, matchedBy: member.matchedBy, entries, before, after, duplicate, orderRef,
    });

    return json({
      ok: true,
      duplicate,
      username: member.username,
      matchedBy: member.matchedBy,
      entriesAdded: duplicate ? 0 : entries,
      entriesAllowed: after,
      orderRef,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('private_league_partner.grant.error', { err: err instanceof Error ? err.message : String(err) });
    return jsonError('Could not grant entries right now', 500);
  }
}
