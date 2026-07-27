export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { buildActivityEventDoc } from '@/lib/activityEvents';
import { countSpendableTokens, recountFromInventory } from '@/lib/passLedger';
import { alertAdminsNewUserDraftEvent } from '@/lib/adminAlerts';
import { runInBackground } from '@/lib/serverBackground';
import { logger } from '@/lib/logger';

const USERS_COLLECTION = 'v2_users';

/**
 * POST /api/owner/use-pass
 *
 * Decrements `draftPasses` or `freeDrafts` in Firestore when a user enters
 * a draft. The Go API handles the actual token consumption (marking a card
 * active in a league); this endpoint keeps the Firestore counter — the
 * user-facing source of truth — in sync, and writes a `draft_entered`
 * activity event in the SAME transaction so the audit log and the header
 * counter can never disagree.
 *
 * Floor of 0: if the counter is already 0 (or missing), the transaction
 * no-ops and returns `decremented: false`. The activity event is also
 * skipped in that case (no actual consumption happened).
 *
 * POST-JOIN MODE (`joined: true`, 2026-07-06): the live enter flow is now
 * join-first — the Go engine has ALREADY consumed the real token by the time
 * this is called, so the pre-spend gate + manual decrement above make no
 * sense (for a 1-pass user the gate would see 0 spendable tokens post-join,
 * return decremented:false, and silently drop the feed row AND the admin
 * new-user bell). Instead this mode recounts the mirror straight from the
 * real inventory (already minus the consumed token) and writes the
 * draft_entered row — now WITH the real leagueId — in the same transaction.
 * The legacy pre-spend mode below is kept for local (non-staging) mode.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    // Lowercase to the canonical doc — the spend must hit the same doc the
    // balance read / SSE / recount use (all lowercase). Otherwise a legacy
    // checksummed-cased wallet would decrement a different doc than it reads.
    const userId = requireString(body.userId, 'userId').toLowerCase();
    const passType = body.passType === 'free' ? 'free' : 'paid';
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null;
    // Draft speed for the admin new-user alert. The client sends it explicitly
    // (the specific leagueId isn't assigned until the filling draft closes), so
    // this is the authoritative FAST/SLOW source; leagueId parsing is a fallback.
    const speed = body.speed === 'slow' ? 'slow' : body.speed === 'fast' ? 'fast' : null;

    if (!isFirestoreConfigured()) {
      return json({ success: true, note: 'Firestore not configured' });
    }

    const field = passType === 'paid' ? 'draftPasses' : 'freeDrafts';

    if (body.joined === true) {
      const activityDoc = await buildActivityEventDoc({
        type: 'draft_entered',
        userId,
        walletAddress: userId,
        paymentMethod: passType === 'paid' ? null : 'free',
        quantity: 1,
        metadata: {
          passType,
          ...(leagueId ? { leagueId } : {}),
        },
      });
      // One transaction: mirror ← real inventory (Go already consumed the
      // token) + the draft_entered feed row. Self-correcting by construction.
      const counts = await recountFromInventory(userId, activityDoc);
      runInBackground('admin.new_user_draft_event', alertAdminsNewUserDraftEvent({ userId, action: 'joined', speed, leagueId }));
      return json({
        success: true,
        joined: true,
        field,
        decremented: true,
        draftPasses: counts.draftPasses,
        freeDrafts: counts.freeDrafts,
      });
    }

    const db = getAdminFirestore();

    // Hard gate: never let a user spend a pass they don't really have. We check
    // the engine's REAL spendable inventory (owners/{wallet}/validDraftTokens —
    // the exact collection JoinLeagues consumes), not just the counter. So even
    // if a counter ever drifts above reality, the user is stopped cleanly here
    // instead of being waved into a draft the engine then rejects.
    const inventory = await countSpendableTokens(userId);
    const available = passType === 'paid' ? inventory.paid : inventory.free;
    if (available <= 0) {
      logger.warn('use-pass.no_real_token', { userId, passType, counterField: field });
      return json({ success: true, field, decremented: false, before: 0, after: 0, reason: 'no_spendable_token' });
    }

    // Pre-build the activity event doc OUTSIDE the transaction (Firestore
    // transactions disallow new reads after writes). The transaction will
    // either commit both the counter decrement AND this activity event, or
    // commit neither.
    const activityDoc = await buildActivityEventDoc({
      type: 'draft_entered',
      userId,
      walletAddress: userId,
      paymentMethod: passType === 'paid' ? null : 'free',
      quantity: 1,
      metadata: {
        passType,
        ...(leagueId ? { leagueId } : {}),
      },
    });

    // NO BLIND DECREMENT (2026-07-27, the AceJohn incident). This legacy
    // branch decremented whichever field the CLIENT claimed ('paid'/'free').
    // When the claim disagreed with the token the engine actually consumed —
    // stale app bundles still call this pre-join — the split flipped (paid
    // showed 0 while a paid pass sat in the wallet). The counter is a MIRROR
    // of owners/{w}/validDraftTokens and may only ever be SET from it:
    //   • gate passed (available > 0) → the client may proceed;
    //   • the counter itself is recounted from inventory, not arithmetic'd.
    // For a pre-join caller inventory hasn't shrunk yet, so this write is a
    // no-op-at-worst; the Go join consumes the real token and the next
    // recount (use-pass joined:true, balance GET, or the stream's drift
    // guard) lands the decrement. The counter can no longer lie about the
    // split, because nothing arithmetic ever touches it.
    const before = await db.collection(USERS_COLLECTION).doc(userId).get()
      .then((s) => Math.max(0, (s.data()?.[field] as number | undefined) ?? 0))
      .catch(() => 0);
    const counts = await recountFromInventory(userId, activityDoc);
    const result = {
      decremented: true,
      before,
      after: field === 'draftPasses' ? counts.draftPasses : counts.freeDrafts,
    };

    // Admin heads-up when a genuinely new organic user takes a seat in a
    // filling draft (Boris 2026-07-03). Same gate + fan-out as the "left the
    // lobby" ping (refund-pass), via the shared helper so they never drift.
    // Fire-and-forget: a bell/email failure must never affect the join.
    if (result.decremented) {
      runInBackground('admin.new_user_draft_event', alertAdminsNewUserDraftEvent({ userId, action: 'joined', speed, leagueId }));
    }

    return json({
      success: true,
      field,
      decremented: result.decremented,
      before: result.before,
      after: result.after,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('use-pass.unhandled', { route: '/api/owner/use-pass', err });
    return jsonError('Internal Server Error', 500);
  }
}
