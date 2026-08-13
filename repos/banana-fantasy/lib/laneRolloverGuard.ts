import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/** Boris's admin wallet — the ONLY recipient of heal bells. Never users. */
const ADMIN_BELL_WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';

/**
 * Lane rollover guard (Boris 2026-08-13) — the permanent watchdog for the Go
 * engine's recurring window-rollover failure (JP #434 on 08-03, JP #633 on
 * 08-12, HOF #649 on 08-13: a window's final hit lands but the `_meta`
 * pointer never advances, so no further specials get scheduled and the
 * guaranteed per-100 odds silently break).
 *
 * Every cron tick it READS two docs (draftTracker + lane_proofs/_meta) and
 * compares: has the current window's final hit landed ≥2 fills ago while the
 * pointer still points at it? That exact stuck signature — nothing looser —
 * triggers the same two-document heal applied by hand three times: stamp the
 * completed cycle, advance the pointer to hit+1. The sealed positions are
 * NEVER derived or written here; the engine schedules draws from the pointer
 * exactly as it did after each manual heal (verified: it independently
 * scheduled #688 post-heal).
 *
 * Safety properties:
 *  • Touches ONLY lane_proofs docs + one admin bell. Never drafts, users,
 *    tokens, or money.
 *  • Transactional re-check: the pointer is re-read inside the heal
 *    transaction, so an engine that rolls at the same moment wins and the
 *    guard becomes a no-op.
 *  • Post-heal the stuck signature no longer matches — inherently idempotent.
 *  • Every heal is recorded in lane_heals/{lane}-{hit} for Richard's audit.
 *  • 2-fill grace so a normal (slightly slow) engine roll is never raced.
 */
export async function runLaneRolloverGuard(): Promise<Record<string, unknown>> {
  const db = getAdminFirestore();
  const [trackerSnap, metaSnap] = await Promise.all([
    db.collection('drafts').doc('draftTracker').get(),
    db.collection('lane_proofs').doc('_meta').get(),
  ]);
  const t = trackerSnap.data() as {
    FilledLeaguesCount?: number;
    JackpotLeagueIds?: number[];
    HofLeagueIds?: number[];
  } | undefined;
  const meta = metaSnap.data() as {
    jpCycle?: number; jpStart?: number; hofCycle?: number; hofStart?: number;
  } | undefined;
  const filled = Number(t?.FilledLeaguesCount ?? 0);
  if (!t || !meta || !meta.jpStart || !meta.hofStart || filled <= 0) {
    return { ok: true, skip: 'not-rolling' };
  }

  const out: Record<string, unknown> = { ok: true };

  // ── JP lane: current window is complete once ITS hit has filled.
  {
    const hits = (t.JackpotLeagueIds ?? []).map(Number)
      .filter((h) => h >= meta.jpStart! && h <= filled).sort((a, b) => a - b);
    const hit = hits[0];
    if (hit && filled >= hit + 2) {
      out.jp = await heal(db, 'jp', meta.jpCycle!, hit, filled);
    }
  }
  // ── HOF lane: complete at the 5th hit inside the window.
  {
    const wEnd = meta.hofStart! + 99;
    const hits = (t.HofLeagueIds ?? []).map(Number)
      .filter((h) => h >= meta.hofStart! && h <= Math.min(filled, wEnd)).sort((a, b) => a - b);
    if (hits.length >= 5 && filled >= hits[4] + 2) {
      out.hof = await heal(db, 'hof', meta.hofCycle!, hits[4], filled);
    }
  }
  return out;
}

async function heal(
  db: FirebaseFirestore.Firestore,
  lane: 'jp' | 'hof',
  cycle: number,
  hit: number,
  filled: number,
): Promise<Record<string, unknown>> {
  const cycleKey = lane === 'jp' ? 'jpCycle' : 'hofCycle';
  const startKey = lane === 'jp' ? 'jpStart' : 'hofStart';
  const metaRef = db.collection('lane_proofs').doc('_meta');

  const applied = await db.runTransaction(async (tx) => {
    const m = (await tx.get(metaRef)).data() as Record<string, number> | undefined;
    // Engine (or a concurrent tick) already rolled — stand down.
    if (!m || m[startKey] > hit || m[cycleKey] !== cycle) return false;
    tx.set(db.collection('lane_proofs').doc(`${lane}-${cycle}`), {
      completedAtDraft: hit,
      healNote: `auto-heal by lane rollover guard — engine failed to roll after ${lane.toUpperCase()} hit #${hit} (filled=${filled})`,
    }, { merge: true });
    tx.set(metaRef, { [cycleKey]: cycle + 1, [startKey]: hit + 1 }, { merge: true });
    tx.set(db.collection('lane_heals').doc(`${lane}-${hit}`), {
      lane, cycle, hit, filled, atIso: new Date().toISOString(), by: 'lane-rollover-guard',
    });
    return true;
  });
  if (!applied) return { skip: 'engine-rolled-itself' };

  logger.error('lane_guard.auto_healed', { lane, cycle, hit, filled });
  try {
    const { createNotification } = await import('@/lib/queueNotifications');
    await createNotification(ADMIN_BELL_WALLET, {
      type: 'promo',
      title: `⚠️ Lane auto-heal: ${lane.toUpperCase()} #${hit}`,
      message: `The engine failed to roll the ${lane.toUpperCase()} lane after the hit at #${hit} `
        + `(caught at ${filled} fills). Auto-healed to cycle ${cycle + 1}, window starts #${hit + 1}. `
        + `Sealed positions untouched. Recorded in lane_heals for Richard.`,
      link: '/admin',
      dedupeKey: `lane-heal-${lane}-${hit}`,
      icon: 'award',
    });
  } catch (err) {
    logger.warn('lane_guard.bell_failed', { err: (err as Error).message });
  }
  return { healed: true, hit, newStart: hit + 1 };
}
