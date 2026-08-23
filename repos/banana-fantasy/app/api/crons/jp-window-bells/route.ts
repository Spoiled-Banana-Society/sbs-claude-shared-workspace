import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import {
  isRollingActive,
  replayJpLane,
  JP_TEN_SPIN_THROUGH,
  JP_FIVE_SPIN_THROUGH,
} from '@/lib/rollingLanes';
import { createNotificationForWallets } from '@/lib/queueNotifications';
import { isReturningWalletSync } from '@/lib/returningUsers';
import { sendBroadcastPushToAll } from '@/lib/notifications/broadcast';
import { BOT_COLLECTION } from '@/lib/botMint';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Jackpot-window promo bells (Richard 2026-08-06).
 *
 * Watches the JP lane and broadcasts two bells per window, each exactly once:
 *
 *   1. RESET — the moment a Jackpot hit resets the window: "if the Jackpot
 *      hits in the next 25 drafts, one drafter in that draft wins 10 Free
 *      Spins". Fires on EVERY reset, including hits at position 51-100 where
 *      awardJackpotDraw skips the spin draw entirely (the window still resets,
 *      so a fresh 10-spin band opens) — which is why this is a watcher cron
 *      and not a hook inside the award path.
 *   2. 5-SPIN — when the window's 26th draft is filling with no hit yet:
 *      "if it hits in the next 25, one drafter wins 5 Free Spins".
 *
 * Both link to the Jackpot Hit promo (/promos?promo=4) whose tiers these
 * numbers come from (lib/rollingLanes: 1-25 → 10, 26-50 → 5).
 *
 * Reveal safety: JackpotLeagueIds moves at FILL but the draft's slot machine
 * reveals its type ~21s later — announcing in between would spoil the reveal
 * to the whole userbase. Any unrevealed potential-JP fill (same RecentFills
 * math as batchProgress/stream) skips the run; the next tick announces.
 *
 * Idempotency: per-window create-once guards in promo_announcements plus the
 * same window-scoped dedupeKey on every bell doc. First run ever seeds
 * quietly (guards the in-flight window without belling, unless the reset is
 * ≤2 drafts old and the copy is still accurate) so deploying mid-window
 * never blasts a stale "just reset" message.
 */

const REVEAL_OFFSET_SEC = 39; // slot lands at DraftStartTime-39s (see batchProgress/stream)
const PROMO_LINK = '/promos?promo=4';
const MAX_FANOUT = 20000;
const SEED_FRESH_THROUGH = 2; // seed run may still announce a reset ≤2 drafts old

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

/**
 * Same audience as the retired pick10-expansion broadcast (Boris 2026-07-03):
 * returning players + anyone who has entered a draft — brand-new users who
 * haven't drafted discover the promo via the promo card, not recurring bells.
 * House bots are excluded (they'd just be dead notification docs).
 */
async function bellAudience(db: FirebaseFirestore.Firestore): Promise<string[]> {
  const [draftedSnap, usersSnap, botsSnap] = await Promise.all([
    db.collection('v2_activity_events').where('type', '==', 'draft_entered').select('userId').limit(MAX_FANOUT).get(),
    db.collection('v2_users').select('isReturningPlayer').limit(MAX_FANOUT).get(),
    db.collection(BOT_COLLECTION).select('address').get(),
  ]);
  const hasDrafted = new Set(
    draftedSnap.docs.map((d) => String((d.data() as { userId?: string }).userId ?? '').toLowerCase()),
  );
  const bots = new Set<string>();
  for (const d of botsSnap.docs) {
    bots.add(d.id.toLowerCase());
    const a = String((d.data() as { address?: string }).address ?? '').toLowerCase();
    if (a) bots.add(a);
  }
  return usersSnap.docs
    .filter((doc) => {
      const w = doc.id.toLowerCase();
      if (bots.has(w)) return false;
      const returning =
        (doc.data() as { isReturningPlayer?: boolean }).isReturningPlayer === true || isReturningWalletSync(w);
      return returning || hasDrafted.has(w);
    })
    .map((doc) => doc.id);
}

/** Create-once guard. Returns true when THIS run won the create (→ announce). */
async function claimGuard(
  db: FirebaseFirestore.Firestore,
  guardId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    await db.collection('promo_announcements').doc(guardId).create({
      ...data,
      announcedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch {
    return false; // ALREADY_EXISTS → someone (or a prior run) already handled it
  }
}

async function broadcast(
  db: FirebaseFirestore.Firestore,
  guardId: string,
  n: { title: string; message: string; dedupeKey: string },
): Promise<{ bells: number; push: string }> {
  const wallets = await bellAudience(db);
  const bells = await createNotificationForWallets(wallets, {
    type: 'jackpot',
    title: n.title,
    message: n.message,
    link: PROMO_LINK,
    dedupeKey: n.dedupeKey,
    icon: 'sparkles',
  });
  // Best-effort push to off-site devices; a dead OneSignal key just reports
  // 'failed' here and the bells still land.
  const push = await sendBroadcastPushToAll({ title: n.title, body: n.message, url: PROMO_LINK }).catch(
    () => ({ status: 'failed' as const }),
  );
  await db
    .collection('promo_announcements')
    .doc(guardId)
    .set({ candidates: wallets.length, bells, push: push.status }, { merge: true });
  return { bells, push: push.status };
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  // RETIRED (Boris 2026-08-22): the Jackpot Hit 10/5-spin promo is replaced by
  // Banana Zone (lib/bonusZone.ts). This route is off every schedule; the guard
  // stays so a stray manual call can never broadcast the dead promo again.
  return json({ ok: true, retired: 'jackpot-hit-spin-bells — replaced by Banana Zone' });

  const db = getAdminFirestore();
  const summary: Record<string, unknown> = {};

  try {
    const snap = await db.collection('drafts').doc('draftTracker').get();
    const d = (snap.exists ? snap.data() : {}) ?? {};
    const filled = Number(d.FilledLeaguesCount ?? 0) || 0;
    const rollingStart = Number(d.RollingStartDraft ?? 0) || 0;
    const jpIds: number[] = Array.isArray(d.JackpotLeagueIds) ? (d.JackpotLeagueIds as number[]) : [];

    if (!isRollingActive(rollingStart, filled)) {
      summary.skipped = 'rolling-not-active';
      await recordCronHeartbeat('jp-window-bells', summary);
      return json({ ok: true, ...summary });
    }

    // Reveal gating — mirror of batchProgress/stream: a filled draft whose
    // slot hasn't landed (or whose RecentFills entry is still the provisional
    // StartTime:0 sentinel) is unrevealed; if it could be a JP hit, wait.
    const nowMs = Date.now();
    const recentRaw = Array.isArray(d.RecentFills)
      ? (d.RecentFills as Array<{ Id?: number; StartTime?: number }>)
      : [];
    const stById = new Map<number, number>();
    for (const rf of recentRaw) {
      const id = Number(rf?.Id ?? 0) || 0;
      const st = Number(rf?.StartTime ?? 0) || 0;
      if (!id) continue;
      if (!stById.has(id) || st > (stById.get(id) as number)) stById.set(id, st);
    }
    for (const [id, st] of stById) {
      if (id > filled || id < rollingStart) continue;
      const atMs = st > 0 ? (st - REVEAL_OFFSET_SEC) * 1000 : nowMs + 3_600_000;
      if (atMs > nowMs && jpIds.includes(id)) {
        summary.skipped = 'jp-reveal-pending';
        summary.pendingId = id;
        await recordCronHeartbeat('jp-window-bells', summary);
        return json({ ok: true, ...summary });
      }
    }

    const { windowStart } = replayJpLane(jpIds, rollingStart, filled);
    // Position of the draft currently FILLING (filled+1), 1-indexed in-window.
    const fillingPos = filled + 1 - windowStart + 1;
    const tenLeft = Math.max(0, JP_TEN_SPIN_THROUGH - fillingPos + 1);
    const fiveLeft = Math.max(0, JP_FIVE_SPIN_THROUGH - fillingPos + 1);
    Object.assign(summary, { windowStart, fillingPos });

    // First run ever: baseline quietly so a mid-window deploy can't blast a
    // stale "just reset" bell. A fresh reset (≤2 drafts old) still announces.
    const seededThisRun = await claimGuard(db, 'jp-window-bells-seed', {
      kind: 'jp-window-bells-seed',
      windowStart,
      fillingPos,
    });
    if (seededThisRun && fillingPos > SEED_FRESH_THROUGH && fillingPos <= JP_TEN_SPIN_THROUGH) {
      await claimGuard(db, `jp-window-reset-${windowStart}`, {
        kind: 'jp-window-reset',
        windowStart,
        fillingPos,
        suppressed: 'seeded-mid-window',
      });
      summary.seeded = 'suppressed-reset';
    }

    // 1) RESET bell — window is in its 10-spin band and not yet announced.
    if (fillingPos >= 1 && fillingPos <= JP_TEN_SPIN_THROUGH) {
      const guardId = `jp-window-reset-${windowStart}`;
      if (await claimGuard(db, guardId, { kind: 'jp-window-reset', windowStart, fillingPos })) {
        const sent = await broadcast(db, guardId, {
          title: 'Jackpot Hit — Cycle Reset, 10 Free Spins Live',
          message:
            `The Jackpot just hit, so the cycle reset. If the Jackpot hits in the next ${tenLeft} drafts, ` +
            `1 of the 10 drafters in that Jackpot draft wins 10 Free Spins. ` +
            `Part of the Jackpot Hit promo — tap for details. Paid drafts only.`,
          dedupeKey: guardId,
        });
        Object.assign(summary, { resetBell: sent });
        logger.info('promo.jp_window_bells.reset_announced', { windowStart, fillingPos, ...sent });
      }
    }

    // 2) 5-SPIN bell — no hit in the first 25; the 26th draft is filling.
    if (fillingPos > JP_TEN_SPIN_THROUGH && fillingPos <= JP_FIVE_SPIN_THROUGH) {
      const guardId = `jp-window-5spin-${windowStart}`;
      if (await claimGuard(db, guardId, { kind: 'jp-window-5spin', windowStart, fillingPos })) {
        const sent = await broadcast(db, guardId, {
          title: 'Jackpot Cycle — 5-Spin Window Open',
          message:
            `No Jackpot in the first 25 drafts of this cycle. If the Jackpot hits in the next ${fiveLeft} drafts, ` +
            `1 of the 10 drafters in that Jackpot draft wins 5 Free Spins. ` +
            `Part of the Jackpot Hit promo — tap for details. Paid drafts only.`,
          dedupeKey: guardId,
        });
        Object.assign(summary, { fiveBell: sent });
        logger.info('promo.jp_window_bells.five_announced', { windowStart, fillingPos, ...sent });
      }
    }

    await recordCronHeartbeat('jp-window-bells', summary);
    return json({ ok: true, ...summary });
  } catch (err) {
    logger.error('promo.jp_window_bells.failed', { err: err instanceof Error ? err : String(err) });
    return jsonError('jp-window-bells failed', 500, { detail: String(err) });
  }
}
