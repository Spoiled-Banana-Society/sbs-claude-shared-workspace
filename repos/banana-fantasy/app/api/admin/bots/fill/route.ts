export const dynamic = 'force-dynamic';
export const maxDuration = 120;

import { NextRequest } from 'next/server';
import { requireBotAuth } from '@/lib/botAuth';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { countSpendableTokens } from '@/lib/passLedger';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/bots/fill  — STAGING ONLY, admin-gated.
 *
 * Tops up a SPECIFIC league with N house bots. Picks N pool bots that hold an
 * unused free pass, then calls the Go `/staging/add-bots-to-league` endpoint to
 * join them to that exact league (reuses the tested join + fill-trigger; never
 * creates a new draft, never touches any other league). Bots then sit idle and
 * the existing miss-2 auto-draft completes their rosters.
 *
 * Body: { leagueId, count, speed? }  — count is "add this many" (top-up to 9,
 * to 10, whatever you ask). Bounded by how many pool bots still have a free pass.
 */
const BOT_COLLECTION = 'botWallets';
const GO_API = (
  process.env.STAGING_DRAFTS_API_URL ||
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
).replace(/\/$/, '');
const MAX_FILL = 10;

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Not available in this environment', 403);
  }
  try {
    await requireBotAuth(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const body = await parseBody(req);
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : '';
    if (!leagueId) return jsonError('leagueId is required', 400);
    const speed = body.speed === 'slow' ? 'slow' : 'fast';
    const count = typeof body.count === 'number' ? body.count : Number(body.count);
    if (!Number.isInteger(count) || count <= 0) return jsonError('count must be a positive integer', 400);
    if (count > MAX_FILL) return jsonError(`capped at ${MAX_FILL} bots per call`, 400);

    const db = getAdminFirestore();
    // Pick `count` bots that still hold an available free pass (real spendable
    // inventory, not just a flag — same source the engine consumes at join).
    const snap = await db.collection(BOT_COLLECTION).where('isBot', '==', true).get();
    const eligible: string[] = [];
    for (const doc of snap.docs) {
      if (eligible.length >= count) break;
      const addr = doc.id;
      try {
        const inv = await countSpendableTokens(addr);
        if (inv.free > 0) eligible.push(addr);
      } catch {
        /* skip a bot whose inventory read fails */
      }
    }
    if (eligible.length === 0) {
      return jsonError('No bots with an available free pass — mint more first (POST /api/admin/bots/mint)', 409);
    }

    // Join them to the target league via the Go engine (tested join + fill-trigger).
    const res = await fetch(`${GO_API}/staging/add-bots-to-league`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, speed, ownerIds: eligible }),
    });
    const goBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn('bots.fill.go_failed', { leagueId, status: res.status, body: JSON.stringify(goBody).slice(0, 200) });
      return jsonError(`Go add-bots-to-league ${res.status}`, 502);
    }

    return json({ success: true, leagueId, speed, requested: count, attempted: eligible.length, go: goBody }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.fill.unhandled', { route: '/api/admin/bots/fill', err });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
