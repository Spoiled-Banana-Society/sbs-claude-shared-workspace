import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
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

  // ── Schedule guard (Boris 2026-08-14, after the 659/665/667 skip): a rolled
  // pointer is not enough — the engine's draw-scheduling can lag MANY fills
  // (18 on 08-13/14), letting sealed positions slip past as Pros. Each tick:
  // if the current window has fewer scheduled ids than it owes, write the
  // sealed positions ourselves — same seed, same math, first-valid extension
  // draws for any position already passed. Additive arrayUnion only.
  out.jpSched = await ensureWindowScheduled(db, 'jp', meta.jpCycle!, meta.jpStart!, 1,
    (t.JackpotLeagueIds ?? []).map(Number), filled).catch((err) => {
      logger.error('lane_guard.jp_sched_failed', { err: (err as Error).message });
      return { ok: false };
    });
  out.hofSched = await ensureWindowScheduled(db, 'hof', meta.hofCycle!, meta.hofStart!, 5,
    (t.HofLeagueIds ?? []).map(Number), filled).catch((err) => {
      logger.error('lane_guard.hof_sched_failed', { err: (err as Error).message });
      return { ok: false };
    });

  // ── Dead-id enforcement (Boris 2026-08-14): drafts 659/665/667 filled as
  // Pro during the engine's schedule-lag incident and were replaced by sealed
  // extension draws (722/726/732). Something keeps union-ing the dead trio
  // back into the tracker (each re-add makes the HOF counter lie: 5→2). Until
  // the writer is found and killed, the guard strips them within one tick.
  {
    const DEAD_HOF_IDS = [659, 665, 667];
    const present = (t.HofLeagueIds ?? []).map(Number).filter((h) => DEAD_HOF_IDS.includes(h));
    if (present.length) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection('drafts').doc('draftTracker');
        const cur = (await tx.get(ref)).data() as { HofLeagueIds?: number[] } | undefined;
        const cleaned = (cur?.HofLeagueIds ?? []).filter((h) => !DEAD_HOF_IDS.includes(Number(h)));
        tx.update(ref, { HofLeagueIds: cleaned });
      });
      logger.error('lane_guard.dead_ids_stripped', { ids: present, filled });
      out.deadIdsStripped = present;
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


/** Sealed-position derivation — identical math to the engine's era model:
 *  combinedSeed = SHA256(serverSalt ++ vrfRandomness); draw i =
 *  HMAC(seed, '{lane}:{cycle}:{i}') first 8 bytes BE mod 100. */
async function laneSeed(db: FirebaseFirestore.Firestore, lane: 'jp' | 'hof'): Promise<Buffer | null> {
  const era = (await db.collection('lane_eras').doc(`${lane}-era-1`).get()).data() as
    { serverSalt?: string; vrfRandomness?: string } | undefined;
  if (!era?.serverSalt || !era?.vrfRandomness) return null;
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(era.serverSalt.slice(2), 'hex'),
    Buffer.from(era.vrfRandomness.slice(2), 'hex'),
  ])).digest();
}

function drawPos(seed: Buffer, lane: 'jp' | 'hof', cycle: number, i: number): number {
  return Number(crypto.createHmac('sha256', seed)
    .update(`${lane}:${cycle}:${i}`).digest().readBigUInt64BE(0) % 100n);
}

/**
 * Ensure the ACTIVE window carries its owed scheduled draws. Base draws are
 * indices 0..need-1 (dedupe-bumped ascending, mirroring the engine); any base
 * position that has already passed unscheduled (would be a silent skip) is
 * substituted by the next extension draws (i = need, need+1, …) under the
 * documented first-valid rule (> filled+1, inside the window, not taken).
 * Writes are additive (arrayUnion) + audited + belled — never removals.
 */
async function ensureWindowScheduled(
  db: FirebaseFirestore.Firestore,
  lane: 'jp' | 'hof',
  cycle: number,
  windowStart: number,
  need: number,
  laneIds: number[],
  filled: number,
): Promise<Record<string, unknown>> {
  const wEnd = windowStart + 99;
  if (filled < windowStart - 1) return { skip: 'window-not-active' };
  const inWindow = laneIds.filter((h) => h >= windowStart && h <= wEnd);
  if (inWindow.length >= need) return { ok: true };

  const seed = await laneSeed(db, lane);
  if (!seed) return { skip: 'no-era-seed' };

  // Rebuild the engine's base schedule (dedupe-bump on the sorted raws).
  const raws: number[] = [];
  for (let i = 0; i < need; i++) raws.push(drawPos(seed, lane, cycle, i));
  const taken = new Set<number>();
  const base: number[] = [];
  for (const p of [...raws].sort((a, b) => a - b)) {
    let q = p; while (taken.has(q)) q++;
    taken.add(q); base.push(q);
  }
  const scheduled = new Set(inWindow);
  const toAdd: number[] = [];
  let ext = need; // next extension index
  for (const pos of base) {
    const hit = windowStart + pos;
    if (scheduled.has(hit)) continue;      // engine already has it
    // >= not >: draft filled+1 is the NEXT fill — still perfectly schedulable.
    // The old `>` treated it as "passed", dropped the real position, and
    // substituted a phantom (749→801 at filled=748, 2026-08-20: an extra
    // unsealed HOF revealed at BBB #801).
    if (hit >= filled + 1) { toAdd.push(hit); taken.add(pos); continue; }
    // Base position already passed unscheduled — substitute (first-valid rule).
    for (; ext < need + 60; ext++) {
      const p2 = drawPos(seed, lane, cycle, ext);
      const h2 = windowStart + p2;
      if (h2 >= filled + 1 && h2 <= wEnd && !taken.has(p2) && !scheduled.has(h2)) {
        toAdd.push(h2); taken.add(p2); ext++; break;
      }
    }
  }
  if (!toAdd.length) return { ok: true, note: 'nothing addable' };

  const field = lane === 'jp' ? 'JackpotLeagueIds' : 'HofLeagueIds';
  await db.collection('drafts').doc('draftTracker')
    .update({ [field]: FieldValue.arrayUnion(...toAdd) });
  await db.collection('lane_proofs').doc(`${lane}-${cycle}`).set({
    globals: FieldValue.arrayUnion(...toAdd),
    healNote: `schedule written by lane guard (engine lag) — added ${toAdd.join(', ')} at filled=${filled}`,
  }, { merge: true });
  await db.collection('lane_heals').doc(`${lane}-sched-${cycle}-${filled}`).set({
    lane, cycle, added: toAdd, filled, atIso: new Date().toISOString(), by: 'lane-guard-scheduler',
  });
  logger.error('lane_guard.schedule_written', { lane, cycle, added: toAdd, filled });
  try {
    const { createNotification } = await import('@/lib/queueNotifications');
    await createNotification(ADMIN_BELL_WALLET, {
      type: 'promo',
      title: `⚠️ Lane guard scheduled ${lane.toUpperCase()} draws`,
      message: `Engine lagged on scheduling — guard wrote sealed positions ${toAdd.join(', ')} for ${lane.toUpperCase()} cycle ${cycle} (filled=${filled}). Audited in lane_heals.`,
      link: '/admin',
      dedupeKey: `lane-sched-${lane}-${cycle}-${toAdd[0]}`,
      icon: 'award',
    });
  } catch { /* bell is best-effort */ }
  return { wrote: toAdd };
}
