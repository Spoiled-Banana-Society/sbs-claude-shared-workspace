export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { addActivityEventToTx, buildActivityEventDoc } from '@/lib/activityEvents';
import { countSpendableTokens } from '@/lib/passLedger';
import { createNotification } from '@/lib/queueNotifications';
import { sendAdminAlertEmail } from '@/lib/adminAlerts';
import { getAdminBellWallets } from '@/lib/adminAllowlist';
import { LAUNCH_ISO } from '@/lib/sbsDay';
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

    if (!isFirestoreConfigured()) {
      return json({ success: true, note: 'Firestore not configured' });
    }

    const field = passType === 'paid' ? 'draftPasses' : 'freeDrafts';
    const db = getAdminFirestore();
    const userRef = db.collection(USERS_COLLECTION).doc(userId);

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

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const mirror = (snap.exists ? (snap.data()?.[field] as number | undefined) : undefined) ?? 0;
      // `available` (the wallet's REAL spendable inventory in validDraftTokens,
      // confirmed > 0 by the hard gate above) is the source of truth. The scalar
      // counter is only a fast-read MIRROR and can legitimately lag BELOW the real
      // inventory: a mint/grant that writes the token but dies before
      // recountFromInventory (slow on-chain grant + serverless timeout — the exact
      // failure Boris hit) leaves the mirror stale-low while the token really
      // exists. The OLD `if (current <= 0) return decremented:false` here then
      // falsely blocked a pass the wallet genuinely owns, and the client showed a
      // ghost "deducted then refunded" with no draft. Trust the real inventory:
      // decrement from the true count and write the reconciled value so the mirror
      // self-heals toward reality. Gate 1 guarantees available >= 1, so this always
      // decrements — a stale mirror can never block a real pass again.
      const trueCount = Math.max(mirror, available);
      tx.set(userRef, { [field]: trueCount - 1 }, { merge: true });
      addActivityEventToTx(tx, activityDoc);
      return { decremented: true, before: mirror, after: trueCount - 1 };
    });

    // Admin-only heads-up when a NEW user (first-season account, not a
    // returning player) enters a filling draft (Boris 2026-07-03: "give me a
    // bell if a new user is ever in a draft thats filling"). One bell per
    // user+draft (dedupeKey), so several new users in one lobby ping several
    // times, but a re-entry never double-pings. Fire-and-forget: a bell
    // failure must never affect the join.
    if (result.decremented) {
      void (async () => {
        try {
          const u = (await userRef.get()).data() as
            | { createdAt?: string; isReturningPlayer?: boolean; username?: string }
            | undefined;
          // SAME returning rule as the admin NEW/OLD chips: the doc flag OR
          // the past-season wallet snapshot. Checking only the flag let
          // sdotdfs (OLD via snapshot, flag unset) email as a "new user".
          const { isReturningWalletSync } = await import('@/lib/returningUsers');
          const isReturning = u?.isReturningPlayer === true || isReturningWalletSync(userId);
          const isNew = !!u && typeof u.createdAt === 'string'
            && u.createdAt >= LAUNCH_ISO && !isReturning;
          if (!isNew) return;
          // Comped accounts don't count (Boris 2026-07-03: "if we grant them
          // the free draft pass, don't count that"): if ANY pass was ever
          // admin-granted to this wallet, they're someone we invited — skip
          // both the bell and the email. Organic new users only.
          const granted = await db.collection('pass_origin')
            .where('ownerAtMint', '==', userId)
            .where('origin', '==', 'admin_grant')
            .limit(1).get();
          if (!granted.empty) return;
          const admins = getAdminBellWallets();
          if (admins.length === 0) return;
          const name = u?.username && !/^user-0x/i.test(u.username)
            ? u.username
            : `${userId.slice(0, 6)}…${userId.slice(-4)}`;
          const speedLabel = leagueId?.includes('-slow-') ? 'SLOW draft'
            : leagueId?.includes('-fast-') ? 'FAST draft'
            : 'draft';
          // Per-admin createNotification (NOT the bulk broadcast helper): the
          // single-wallet path pushes the bell content over the live stream so
          // every admin device renders it INSTANTLY — the bulk path skips that
          // ping and waits for the next poll. Admin list is tiny, so the
          // per-wallet fan-out is cheap.
          await Promise.allSettled([
            ...admins.map((w) => createNotification(w, {
              type: 'system',
              title: `New user entered a ${speedLabel}`,
              message: `${name} — a NEW account — just took a seat in a ${speedLabel}${leagueId ? ` (${leagueId})` : ''}.`,
              link: '/admin?tab=drafts',
              icon: '🆕',
              dedupeKey: `admin-new-user-in-draft-${userId}-${leagueId ?? 'unknown'}`,
            })),
            // Pocket channel — instant email to the team (no SMS provider in
            // the stack; Resend is the wired always-on channel). Same event,
            // different surface, so it does NOT violate one-event-one-bell.
            // Guarded by a create()-once doc so a retried request can't
            // double-email (bells dedupe themselves; email has no such rail).
            (async () => {
              try {
                await db.collection('admin_alert_sent')
                  .doc(`new-user-in-draft-${userId}-${leagueId ?? 'unknown'}`.replace(/[/\\\s]+/g, '_'))
                  .create({ at: new Date().toISOString() });
              } catch { return; } // already sent for this user+draft
              await sendAdminAlertEmail(
                `🆕 New user in a ${speedLabel}: ${name}`,
                `${name} — a NEW account — just took a seat in a ${speedLabel}${leagueId ? ` (${leagueId})` : ''}.`,
              );
            })(),
          ]);
        } catch (err) {
          logger.warn('use-pass.admin_new_user_bell_failed', { userId, leagueId, err });
        }
      })();
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
