export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { requireBotAuth } from '@/lib/botAuth';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/bots/remove — pull ONE house bot back out of a FILLING draft.
 *
 * Mirror of the "+ Bot" action. Finds the most-recently-joined member of the
 * league that is a registered house bot (`botWallets`), then puts it through
 * the Go engine's normal user-facing leave flow — seat freed, player count
 * decremented, RTDB updated, and the bot's free pass restored to its wallet
 * (so that same bot is first in line for the next "+ Bot" click).
 *
 * The Go leave endpoint refuses to remove anyone from a FULL league (409), so
 * this can never yank a bot out of a draft that has started — only lobbies.
 *
 * Body: { leagueId }
 */
const BOT_COLLECTION = 'botWallets';
const GO_API = (
  process.env.STAGING_DRAFTS_API_URL ||
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
).replace(/\/$/, '');

export async function POST(req: NextRequest) {
  try {
    await requireBotAuth(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const body = await parseBody(req);
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : '';
    if (!leagueId) return jsonError('leagueId is required', 400);

    const db = getAdminFirestore();
    const leagueSnap = await db.collection('drafts').doc(leagueId).get();
    if (!leagueSnap.exists) return jsonError(`Draft not found: ${leagueId}`, 404);
    const league = leagueSnap.data() as {
      CurrentUsers?: Array<{ OwnerId?: string; ownerId?: string; TokenId?: string; tokenId?: string }>;
      currentUsers?: Array<{ OwnerId?: string; ownerId?: string; TokenId?: string; tokenId?: string }>;
    };
    const members = league.CurrentUsers ?? league.currentUsers ?? [];

    // Which members are house bots? Check the registry per member (few reads).
    // Walk newest-first so we undo the most recent "+ Bot" click.
    let target: { ownerId: string; tokenId: string } | null = null;
    for (let i = members.length - 1; i >= 0; i--) {
      const ownerId = String(members[i].OwnerId ?? members[i].ownerId ?? '').toLowerCase();
      const tokenId = String(members[i].TokenId ?? members[i].tokenId ?? '');
      if (!ownerId) continue;
      const botDoc = await db.collection(BOT_COLLECTION).doc(ownerId).get();
      if (botDoc.exists && botDoc.data()?.isBot === true) {
        target = { ownerId, tokenId };
        break;
      }
    }
    if (!target) return jsonError('No house bots in this draft', 404);

    // Normal user-facing leave — 409s if the league is already full/started.
    const res = await fetch(`${GO_API}/league/${leagueId}/actions/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: target.ownerId, tokenId: target.tokenId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('bots.remove.go_failed', { leagueId, status: res.status, body: text.slice(0, 200) });
      return jsonError(
        res.status === 409 || /full/i.test(text)
          ? 'Draft already filled/started — bots can only be removed from lobbies'
          : `Go leave failed (${res.status})`,
        502,
      );
    }

    logger.info('bots.remove.done', { leagueId, ...target });
    return json({ success: true, leagueId, removed: target });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.remove.unhandled', { route: '/api/admin/bots/remove', err });
    return jsonError('Internal Server Error', 500);
  }
}
