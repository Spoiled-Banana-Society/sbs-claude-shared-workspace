import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { awardJackpotDraw, recordPick10, recordPickChase, getPick10ActiveSlots, announcePick10ExpansionIfActivated, unlockBadge } from '@/lib/db';
import { recordAroundTheBanana } from '@/lib/aroundTheBanana';
import { recordBananaVault } from '@/lib/bananaVault';
import { waitUntil } from '@vercel/functions';
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
    // 'jackhof' (dual-type, rolling era) carries BOTH perks. Note the string
    // 'jackhof' does NOT contain 'jackpot', so it needs its own check —
    // without it a JackHOF draft would silently lose its jackpot draw.
    const isJackHof = level.includes('jackhof') || level.includes('jack-hof') || level.includes('jackpot+hof');
    const isJackpot = level.includes('jackpot') || isJackHof;
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
      // Pick-slot LADDER: slot 10 always; batch's Jackpot hit → 6 & 10; all
      // specials hit → 6, 9 & 10 — reverting to slot-10-only when the next
      // batch starts. recordPick10 is idempotent per (user, draft) and paid-gated.
      const { slots, tier } = await getPick10ActiveSlots();
      for (const slot of slots) {
        const owner = order[slot - 1]?.ownerId?.toLowerCase();
        if (owner && !owner.startsWith('bot-')) {
          await recordPick10(owner, draftId, draftName, undefined, slot);
        }
      }

      // Chase Your Pick (limited-time, thru Sun 12pm PT): every HUMAN seat's own
      // slot (1–10) advances their personal chase — set target on the first
      // draft, then match it to win the escalating spins. Free + paid both
      // count. Bots excluded (their wallets have no promo docs, but skip them
      // explicitly too). No-ops entirely once the window closes.
      const botSet = new Set(
        (await db.collection('botWallets').where('isBot', '==', true).get())
          .docs.map((d) => d.id.toLowerCase()),
      );
      for (let pos = 0; pos < order.length; pos++) {
        const owner = order[pos]?.ownerId?.toLowerCase();
        if (owner && !owner.startsWith('bot-') && !botSet.has(owner)) {
          await recordPickChase(owner, draftId, draftName, pos + 1);
          // Around The Banana: the same seat's slot also advances that user's
          // all-10-slots lap. No-ops entirely until launch (ATB_START_MS +
          // visibility gate inside); idempotent per (user, draft); paid-gated.
          await recordAroundTheBanana(owner, draftId, draftName, pos + 1);
          // Banana Vault: same seat/slot can click one of the user's secret
          // tumblers. No-ops when no vault is open; idempotent per (user, draft).
          await recordBananaVault(owner, draftId, draftName, pos + 1);
        }
      }
      // Tier live this batch — tell everyone (bell + push), once per TIER per
      // batch. Backgrounded so the broadcast fan-out never delays the reveal
      // response; idempotent guard inside makes a re-fire a no-op.
      if (tier !== 'base') waitUntil(announcePick10ExpansionIfActivated());
    } catch { /* state not initialized yet — close backstop covers it */ }

    if (!isJackpot && !isHof) {
      return json({ ok: true, level: 'pro', unlocked: false });
    }

    const levelKey = isJackHof ? 'jackhof' : isJackpot ? 'jackpot' : 'hof';
    // Once per draft — the other 9 watching clients (and replays) no-op.
    try {
      await db.collection('draft_reveal_unlocks').doc(draftId).create({
        draftId,
        level: levelKey,
        revealedAt: new Date().toISOString(),
      });
    } catch {
      return json({ ok: true, level: levelKey, unlocked: false, deduped: true });
    }

    const users = (draftSnap.get('CurrentUsers') ?? []) as Array<{ OwnerId?: string }>;
    const wallets = users
      .map((u) => String(u?.OwnerId ?? '').toLowerCase())
      .filter((w) => /^0x[0-9a-f]{40}$/.test(w) && !w.startsWith('bot-'));

    if (isJackpot) {
      // Paid-only VRF winner draw + spins + winner promo + draw record. This
      // ALSO unlocks Jackpot Club for the PAID entrants (silent — folded into
      // the draw bell). Idempotent per draft via jackpot_draws create().
      await awardJackpotDraw(draftId, String(draftSnap.get('DisplayName') ?? draftId)).catch(() => {});
      // Jackpot Club badge for ALL participants — free AND paid (Boris
      // 2026-07-01). The club badge is a PARTICIPATION achievement, not a promo:
      // everyone in the jackpot draft earns it (the spins/draw stay paid-only).
      // Mirrors the HOF branch below. unlockBadge is idempotent, so the paid
      // entrants already unlocked (silently) above are a no-op here (no double
      // bell); the free entrants unlock now and get the "Badge unlocked" bell.
      // Uses the authoritative Firestore Level + participant list — NOT the Go
      // token level, which comes back empty for regular batch jackpot drafts.
      await Promise.allSettled(wallets.map((w) =>
        unlockBadge(w, 'jackpot-club', { source: 'draft-reveal', draftId }),
      ));
    }
    // Independent (NOT else): a JackHOF draft earns BOTH club badges — the
    // jackpot draw/club above AND the HOF club here. Pure-jackpot levels never
    // enter (their level string doesn't contain 'hof'), so legacy behavior is
    // byte-identical for single-type drafts.
    if (isHof) {
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
