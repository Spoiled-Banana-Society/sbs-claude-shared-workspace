export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { FieldValue } from 'firebase-admin/firestore';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';
import { closeCycleAndDraw, ensureCycle } from '@/lib/bananaDraw';
import { cycleFor } from '@/lib/bananaDrawMath';
import { unlockBadge } from '@/lib/db';
import { ADMIN_PREVIEW_PROMO_TYPES } from '@/lib/promoFilter';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';

/**
 * GET /api/crons/banana-draw — the noon-PT Banana Draw.
 *
 * Runs every 5 minutes rather than exactly at 12:00 so a missed or delayed
 * Vercel cron tick can still close the cycle a few minutes late instead of
 * skipping a whole day's draw. `closeCycleAndDraw` is idempotent (the cycle
 * doc flips to 'drawn' inside a transaction), so the extra ticks are no-ops.
 *
 * Each run:
 *   1. Close + draw any cycle whose clock has passed and is still open.
 *   2. Award the winner +1 jackhofEntries. From there the EXISTING wheel
 *      machinery takes over untouched: joinQueue seats them, skips a round
 *      they're already in (so a repeat winner lands in the NEXT JackHOF
 *      league, exactly as intended), token-bound seats stay sellable, and Go
 *      starts the draft at 10/10.
 *   3. Bell the winner, bell the other entrants with the result.
 *   4. Open the next cycle so the countdown restarts immediately.
 */
function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  const header = req.headers.get('authorization') ?? '';
  // Vercel's own scheduler sends the project's CRON_SECRET as a bearer token.
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  // ⚠️ PRE-LAUNCH HOLD. Bananas accrue quietly (harmless — nobody sees them),
  // but DRAWING would bell the winner "You won a JackHOF seat" and bell every
  // entrant with the result, for a promo they have never been shown. Worse, it
  // would seat someone in the first-ever JackHOF league before launch.
  //
  // Gated on the same launch switch as the UI: the draw stays parked until
  // 'banana-draw' moves out of ADMIN_PREVIEW_PROMO_TYPES. Cycles stay OPEN, so
  // nothing is lost — the first post-launch tick draws them in order.
  if (ADMIN_PREVIEW_PROMO_TYPES.includes('banana-draw')) {
    return json({ ok: true, held: 'pre-launch', drawn: 0 });
  }

  const now = Date.now();
  const db = getAdminFirestore();

  try {
    // Cycle ids ARE dates, so "which cycles are due?" is computable — fetch the
    // last few by id instead of querying status + closesAt.
    //
    // That query (equality + range + orderBy) needs a COMPOSITE INDEX, which
    // can only be created by a separate `firebase deploy --only
    // firestore:indexes` — it cannot ship with a code deploy. The cron would
    // have thrown on its very first run until someone ran that by hand. A
    // getAll by id needs no index at all and is a cheaper read.
    //
    // Walking back 7 days also self-heals a week the cron was down for.
    const today = cycleFor(now);
    const candidateIds = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.closesAt);
      d.setUTCDate(d.getUTCDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const snaps = await db.getAll(
      ...candidateIds.map((id) => db.collection('banana_cycles').doc(id)),
    );
    const due = snaps
      .filter((s) => s.exists)
      .filter((s) => {
        const c = s.data() as { status?: string; closesAt?: number };
        return c.status === 'open' && typeof c.closesAt === 'number' && c.closesAt <= now;
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1)); // oldest first

    if (due.length === 0) {
      await ensureCycle(now); // keep a cycle open so Bananas always land somewhere
      return json({ ok: true, drawn: 0, cycle: today.cycleId });
    }

    const results: Array<Record<string, unknown>> = [];

    for (const doc of due) {
      const cycleId = doc.id;
      const outcome = await closeCycleAndDraw(cycleId);

      if (!outcome.ok) {
        // no-sealed-seed is the one worth shouting about: it means no wheel
        // period is active, and rather than fall back to a weak predictable
        // hash we refuse to draw. The cycle stays OPEN and the next tick
        // retries, so nobody loses their Bananas.
        logger.error('banana.draw.failed', { cycleId, reason: outcome.reason });
        results.push({ cycleId, ok: false, reason: outcome.reason });
        continue;
      }

      const winnerId = outcome.winnerId ?? null;
      if (!winnerId) {
        results.push({ cycleId, ok: true, winnerId: null, reason: outcome.reason ?? 'no-entries' });
        continue;
      }

      // ── Award the seat ────────────────────────────────────────────────
      // Mirrors app/api/wheel/spin/route.ts exactly (the legacy wallet-keyed
      // queue branch): credit the entry, then joinQueue CONSUMES it and
      // ensureSpecialDraftSeat creates-or-joins the Go league.
      //
      // ⚠️ Both steps are required. Crediting jackhofEntries alone leaves the
      // winner with a number on their user doc and NO seat — nothing else in
      // the app calls joinQueue for them (the only other callers are the wheel
      // spin route and a client POST to /api/queues, neither of which fires
      // here). Caught before launch on 2026-07-26.
      //
      // joinQueue skips any round the wallet is already in, so a repeat winner
      // lands in the NEXT JackHOF league automatically — Boris's rule, already
      // in the existing code (lib/db-firestore.ts joinQueue, the
      // `!r.members.some(m => m.wallet === userId)` clause).
      // PREFERRED PATH — mint a REAL JackHOF pass NFT and bind the seat to it.
      //
      // The wheel already does exactly this (app/api/wheel/spin/route.ts, the
      // mintJpHof branch) and it is what makes a won seat behave like a pass:
      // it shows up under the winner's passes carrying the JackHOF level (and
      // therefore the red-and-gold treatment), and it stays SELLABLE on the
      // marketplace until the league fills, with the swap endpoint handing the
      // seat to the buyer.
      //
      // This cron previously only ran the legacy wallet-keyed joinQueue below.
      // That seats the winner and nothing more: no token, so no pass in the
      // wallet, nothing on the marketplace, and no way to sell the seat — even
      // though the comment here claimed otherwise (caught 2026-07-27, before
      // the first draw). Boris's spec is explicit that the seat is sellable, so
      // the token path is the one that has to run.
      let seated = false;
      if (isAdminMintConfigured()) {
        try {
          const res = await reserveTokensToWallet({ to: winnerId, count: 1 });
          // Free-origin: a won seat cost nothing, and pass_origin is what keeps
          // it out of the PAID revenue count (lib/onchain/reconcilePasses).
          await recordPassOrigins({
            tokenIds: res.tokenIds,
            origin: 'admin_grant',
            ownerAtMint: winnerId,
            txHash: res.txHash,
            reason: `banana_draw:${cycleId}`,
            level: 'jackhof',
          });
          await registerMintedTokens(winnerId, res.tokenIds, 'free')
            .catch((e) => logger.warn('banana.draw.register_go_failed', { cycleId, err: (e as Error).message }));

          // Stamp the special level so the Go engine's selectTokensByType and
          // countSpendableTokens both SKIP it — without this the pass could be
          // spent to enter an ordinary fast draft, burning the JackHOF seat.
          await Promise.all(res.tokenIds.map((tid) => db
            .collection('owners').doc(winnerId.toLowerCase())
            .collection('validDraftTokens').doc(String(tid))
            .set({ Level: 'JackHOF' }, { merge: true })));

          const tokenId = res.tokenIds[0];
          if (tokenId) {
            const { joinQueueWithToken } = await import('@/lib/db');
            // 'promo' keeps draw winners in their OWN round: a wheel winner who
            // hit the 0.1% wedge must never be seated into the giveaway draft
            // (Richard, 2026-07-30 — roarstone landed in it and had to be moved
            // out by hand). Wheel wins fill wheel rounds, draws fill draw rounds.
            const { joinedRoundId } = await joinQueueWithToken(winnerId, 'jackhof', String(tokenId), 'promo');
            if (joinedRoundId !== null) {
              const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
              await ensureSpecialDraftSeat('jackhof', joinedRoundId, winnerId);
            }
            seated = true;
            logger.info('banana.draw.seated_with_token', { cycleId, winnerId, tokenId, round: joinedRoundId });
          }
        } catch (mintErr) {
          logger.error('banana.draw.mint_failed', { cycleId, winnerId, err: (mintErr as Error).message });
        }
      }

      // FALLBACK — mint unavailable or failed. A seat that can't be sold still
      // beats no seat at all, so we never let a winner walk away empty.
      // jackhofEntries is credited HERE only: joinQueue consumes the counter,
      // while the token path above doesn't use it, and crediting in both cases
      // would leave a stale entry that could seat them a second time.
      if (!seated) {
        try {
          await db.collection('v2_users').doc(winnerId)
            .set({ jackhofEntries: FieldValue.increment(1) }, { merge: true });
          const { joinQueue } = await import('@/lib/db');
          const { joinedRoundIds } = await joinQueue(winnerId, 'jackhof', 'promo');
          const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
          for (const rid of joinedRoundIds) {
            await ensureSpecialDraftSeat('jackhof', rid, winnerId);
          }
          logger.warn('banana.draw.seated_legacy_no_token', { cycleId, winnerId, rounds: joinedRoundIds });
        } catch (qErr) {
          // Loud: a winner without a seat is the single worst failure this
          // promo can have. The entry credit survives for manual recovery.
          logger.error('banana.draw.seat_failed', { cycleId, winnerId, err: (qErr as Error).message });
        }
      }

      // The badge unlocks the moment they win the seat (Boris) — and again
      // idempotently when the draft fills, via the draft-filled webhook.
      await unlockBadge(winnerId, 'jackhof-club', { source: 'banana-draw', cycleId })
        .catch((err) => logger.warn('banana.draw.badge_failed', { cycleId, winnerId, err: String(err) }));

      // ── Bells ─────────────────────────────────────────────────────────
      await createNotification(winnerId, {
        type: 'promo',
        title: 'You won a JackHOF seat',
        message: 'Your Banana came up. Tap to take your seat in the first-ever JackHOF draft.',
        link: '/promos?promo=banana-draw',
        dedupeKey: `banana-draw-win-${cycleId}`,
        icon: 'award',
      }).catch(() => { /* best-effort */ });
      // No manual stream push here — createNotification already fires its own
      // 'notification' event carrying the bell content, so adding one would
      // double-ping the winner's devices.

      // Everyone else who entered gets ONE result ping — server-side
      // dedupeKey per cycle so nobody can be double-belled.
      const entries = await db.collection('banana_cycles').doc(cycleId).collection('entries').get();
      const others = entries.docs.map((d) => d.id).filter((id) => id !== winnerId);
      await Promise.allSettled(others.map((uid) => createNotification(uid, {
        type: 'promo',
        title: "Today's JackHOF seat went out",
        message: 'A new 24 hours just started — every draft you fill is another Banana in the draw.',
        link: '/promos?promo=banana-draw',
        dedupeKey: `banana-draw-result-${cycleId}`,
        icon: 'ticket',
      })));

      results.push({ cycleId, ok: true, winnerId, totalBananas: outcome.totalBananas, entrants: entries.size });
      logger.info('banana.draw.complete', { cycleId, winnerId, totalBananas: outcome.totalBananas });
    }

    // Roll the clock immediately so the countdown never shows a dead zero.
    const next = await ensureCycle(Date.now());
    return json({ ok: true, drawn: results.length, results, nextCycle: next.cycleId });
  } catch (err) {
    logger.error('banana.draw.cron_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
