export const dynamic = 'force-dynamic';
// May mint on-chain passes (sequential txs) before joining — give it room.
export const maxDuration = 300;

import { NextRequest } from 'next/server';
import { requireBotAuth } from '@/lib/botAuth';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { countSpendableTokens } from '@/lib/passLedger';
import { mintBotPass, BOT_COLLECTION } from '@/lib/botMint';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/bots/fill  — admin-gated ops tool (admin login or x-bot-secret).
 *
 * Tops up a SPECIFIC league with N house bots. REBUILT 2026-07-12 after the
 * 7/3 dup-seat freeze (2026-fast-draft-56):
 *
 *  - The Go join now runs the SAME transaction as a real player join
 *    (duplicate-owner rejection + atomic seat+pass claim + special-draft
 *    block + speed derived from the league). A bot can join any number of
 *    DIFFERENT drafts — never the same draft twice — so this route also
 *    filters out bots already seated in the target league instead of
 *    burning attempts on engine rejections.
 *  - `mode` picks WHO joins (Richard, 2026-07-12):
 *      'existing' (default): reuse a pool bot not already in this draft.
 *        Prefers one holding an unused pass; otherwise mints a fresh pass to
 *        a retired pool bot; only creates a new wallet if the whole registry
 *        is already seated in this draft (or empty).
 *      'new': always create a brand-new bot wallet.
 *    No more client-side 409 mint-retry dance — this route mints as needed.
 *  - The Go endpoint requires `x-bot-secret` (no longer an open route).
 *
 * Body: { leagueId, count?, mode? }
 */
const GO_API = (
  process.env.STAGING_DRAFTS_API_URL ||
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
).replace(/\/$/, '');
const MAX_FILL = 10;

export async function POST(req: NextRequest) {
  // Declared outside the try so every failure exit — including a thrown mint —
  // can disclose which on-chain passes this call created. On-chain mints must
  // never be invisible.
  const minted: string[] = [];
  try {
    await requireBotAuth(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
    const goSecret = process.env.BOT_ADMIN_SECRET;
    if (!goSecret) return jsonError('BOT_ADMIN_SECRET is not configured — the Go bot endpoint requires it', 503);

    const body = await parseBody(req);
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : '';
    if (!leagueId) return jsonError('leagueId is required', 400);
    // Shape check BEFORE any mint: a typo'd id (or a non-league doc like
    // draftTracker) must never cost an on-chain pass.
    if (!/^\d{4}-(fast|slow)-draft-\d+$/.test(leagueId)) {
      return jsonError(`"${leagueId}" is not a regular draft id (yyyy-fast/slow-draft-N) — bots only join regular drafts`, 400);
    }
    const mode = body.mode === 'new' ? 'new' : 'existing';
    const count = body.count === undefined ? 1 : typeof body.count === 'number' ? body.count : Number(body.count);
    if (!Number.isInteger(count) || count <= 0) return jsonError('count must be a positive integer', 400);
    if (count > MAX_FILL) return jsonError(`capped at ${MAX_FILL} bots per call`, 400);

    const db = getAdminFirestore();

    // Who is already seated in this draft? (Never send a bot at a league it's
    // in — the engine would reject it anyway; this just avoids wasted mints.)
    const leagueSnap = await db.collection('drafts').doc(leagueId).get();
    if (!leagueSnap.exists) return jsonError(`Draft not found: ${leagueId}`, 404);
    const league = leagueSnap.data() as {
      CurrentUsers?: Array<{ OwnerId?: string; ownerId?: string }>;
      currentUsers?: Array<{ OwnerId?: string; ownerId?: string }>;
      NumPlayers?: number;
      numPlayers?: number;
      Level?: string;
      level?: string;
    };
    // Specials are engine-blocked (errLeagueSpecial) — reject here too so the
    // rejection is free instead of costing a minted pass first.
    const level = league.Level ?? league.level ?? '';
    if (level === 'Jackpot' || level === 'Hall of Fame') {
      return jsonError(`${leagueId} is a special ${level} draft — bots are not allowed in specials`, 403);
    }
    const seated = new Set(
      (league.CurrentUsers ?? league.currentUsers ?? [])
        .map((u) => String(u.OwnerId ?? u.ownerId ?? '').toLowerCase())
        .filter(Boolean),
    );
    const openSeats = 10 - (league.NumPlayers ?? league.numPlayers ?? seated.size);
    if (openSeats <= 0) return jsonError('Draft is already full', 409);

    // Circuit breaker: if ANY bot holds a minted-but-unregistered pass, the Go
    // registration path is (or was) broken. Minting more would create one new
    // orphan pass per click — refuse until it's resolved.
    const registry = await db.collection(BOT_COLLECTION).where('isBot', '==', true).get();
    const orphaned = registry.docs.filter((d) => (d.data().unregisteredTokenIds ?? []).length > 0);
    if (orphaned.length > 0) {
      const detail = orphaned.map((d) => `${d.id.slice(0, 10)}… tokens ${(d.data().unregisteredTokenIds ?? []).join(',')}`).join('; ');
      return jsonError(`Minting is blocked: earlier bot passes minted on-chain but never registered with the engine (${detail}). Fix registration first.`, 503);
    }

    // Assemble the joiners per mode.
    const picks: string[] = [];
    const wanted = Math.min(count, openSeats);

    if (mode === 'existing') {
      const available = registry.docs.map((d) => d.id).filter((addr) => !seated.has(addr));

      // 1) Pool bots already holding an unused free pass.
      for (const addr of available) {
        if (picks.length >= wanted) break;
        try {
          const inv = await countSpendableTokens(addr);
          if (inv.free > 0) picks.push(addr);
        } catch {
          /* skip a bot whose inventory read fails */
        }
      }
      // 2) Retired pool bots — mint them a fresh pass (reusable bots).
      for (const addr of available) {
        if (picks.length >= wanted) break;
        if (picks.includes(addr)) continue;
        const m = await mintBotPass(db, addr);
        minted.push(m.address);
        picks.push(m.address);
      }
    }
    // 3) Brand-new wallets — always in 'new' mode, fallback in 'existing'.
    while (picks.length < wanted) {
      const m = await mintBotPass(db);
      minted.push(m.address);
      picks.push(m.address);
    }

    // The engine-side join — same transaction as a real player's join.
    const res = await fetch(`${GO_API}/staging/add-bots-to-league`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': goSecret },
      body: JSON.stringify({ leagueId, ownerIds: picks }),
    });
    const goBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn('bots.fill.go_failed', { leagueId, status: res.status, minted, body: JSON.stringify(goBody).slice(0, 200) });
      return jsonError(`Go add-bots-to-league ${res.status}`, 502, { minted });
    }

    const results: Array<{ ownerId?: string; joined?: boolean; error?: string }> = Array.isArray(goBody.results)
      ? goBody.results
      : [];
    const joined = results.filter((r) => r.joined).length;
    const errors = results.filter((r) => r.error).map((r) => `${String(r.ownerId ?? '?').slice(0, 8)}…: ${r.error}`);
    logger.info('bots.fill.done', { leagueId, mode, requested: count, joined, minted: minted.length, errors });

    if (joined === 0) {
      return jsonError(`No bot joined — ${errors.join('; ') || 'engine returned no results'}`, 502, { minted });
    }
    return json({ success: true, leagueId, mode, joined, minted, requested: count, results }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('bots.fill.unhandled', { route: '/api/admin/bots/fill', err, minted });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { minted });
  }
}
