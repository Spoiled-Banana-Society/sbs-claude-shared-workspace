import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { awardJackpotDraw, recordPick10, allBatchSpecialsHit, unlockBadge } from '@/lib/db';
import { getDraftInfo } from '@/lib/draftApi';
import { logger } from '@/lib/logger';

/**
 * POST /api/drafts/[draftId]/reveal-complete
 *
 * Called by the draft room the moment the slot-machine type reveal (with its
 * VRF proof) finishes animating. If the draft revealed Jackpot or HOF, this
 * unlocks the matching CLUB badge for all 10 drafters and credits the
 * Jackpot Hit promo — at the exact reveal moment (Boris 2026-06-10: never at
 * raw fill, which would spoil the reveal; never only-at-close, which is
 * minutes-to-days late).
 *
 * Trust model: the caller carries NO information — the draft type and roster
 * are read from the server's own draft record, so a malicious caller can at
 * worst make the unlock happen at the correct time. Idempotent: a create-once
 * marker per draft means the first of the 10 watching clients wins and the
 * rest no-op; badge unlocks + jackpot credit are themselves idempotent, and
 * the close pipeline remains the backstop when nobody watched the reveal.
 */
export async function POST(req: Request, { params }: { params: { draftId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const { draftId } = params;
  if (!draftId) return jsonError('Missing draftId', 400);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  try {
    const db = getAdminFirestore();
    const draftSnap = await db.collection('drafts').doc(draftId).get();
    if (!draftSnap.exists) return jsonError('Draft not found', 404);

    const level = String(draftSnap.get('Level') ?? '').toLowerCase();
    const isJackpot = level.includes('jackpot');
    const isHof = level.includes('hof') || level.includes('hall of fame');

    // Pick 10 — credited here (not at fill: the draft ORDER doesn't exist
    // until after randomization, caught live on draft 1382). Any watcher's
    // reveal report triggers it; recordPick10 is idempotent per draft and
    // paid-gated internally. Best-effort — the Go state may not be
    // initialized yet on slower countdowns; the close backstop
    // (refresh-draft) guarantees it regardless.
    try {
      const info = await getDraftInfo(draftId);
      const order = info?.draftOrder ?? [];
      const draftName = String(draftSnap.get('DisplayName') ?? draftId);
      // Normally only slot 10 earns a spin. BUT once the current 100-batch has
      // had all its specials hit (1 Jackpot + 5 HOF), Pick 10 expands to also
      // reward slots 6 and 9 — reverting to slot-10-only when the next batch
      // starts. recordPick10 is idempotent per (user, draft) and paid-gated.
      const slots = (await allBatchSpecialsHit()) ? [6, 9, 10] : [10];
      for (const slot of slots) {
        const owner = order[slot - 1]?.ownerId?.toLowerCase();
        if (owner && !owner.startsWith('bot-')) {
          await recordPick10(owner, draftId, draftName, undefined, slot);
        }
      }
    } catch { /* state not initialized yet — close backstop covers it */ }

    if (!isJackpot && !isHof) {
      return json({ ok: true, level: 'pro', unlocked: false });
    }

    // Once per draft — the other 9 watching clients (and replays) no-op.
    try {
      await db.collection('draft_reveal_unlocks').doc(draftId).create({
        draftId,
        level: isJackpot ? 'jackpot' : 'hof',
        revealedAt: new Date().toISOString(),
      });
    } catch {
      return json({ ok: true, level: isJackpot ? 'jackpot' : 'hof', unlocked: false, deduped: true });
    }

    const users = (draftSnap.get('CurrentUsers') ?? []) as Array<{ OwnerId?: string }>;
    const wallets = users
      .map((u) => String(u?.OwnerId ?? '').toLowerCase())
      .filter((w) => /^0x[0-9a-f]{40}$/.test(w) && !w.startsWith('bot-'));

    if (isJackpot) {
      // ONE call handles everything: paid-only VRF-style winner draw, winner
      // promo credit, draw record (for the modal replay + provably-fair
      // display), Jackpot Club badges (silent) and the combined/draw notis —
      // idempotent per draft via jackpot_draws create().
      await awardJackpotDraw(draftId, String(draftSnap.get('DisplayName') ?? draftId)).catch(() => {});
    } else {
      await Promise.allSettled(wallets.map((w) =>
        unlockBadge(w, 'hof-club', { source: 'draft-reveal', draftId }),
      ));
    }

    logger.info('draft.reveal_complete.unlocked', { draftId, level: isJackpot ? 'jackpot' : 'hof', wallets: wallets.length });
    return json({ ok: true, level: isJackpot ? 'jackpot' : 'hof', unlocked: true, wallets: wallets.length });
  } catch (err) {
    logger.error('draft.reveal_complete.failed', { draftId, err });
    return jsonError('Internal Server Error', 500);
  }
}
