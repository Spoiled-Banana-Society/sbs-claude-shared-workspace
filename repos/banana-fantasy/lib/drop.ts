/**
 * THE DROP — Firestore layer. Pure schedule/pool/assignment math lives in
 * lib/dropMath.ts; this does the reads and writes.
 *
 * Collections
 *   drop_nights/{nightId}                  the night, its sealed commitment + lock state
 *   drop_nights/{nightId}/packs/{packId}   one doc per pack — owner, source, prize, opened
 *   v2_users/{uid}/dropLedger/{dedupeId}   PERMANENT earn log — never resets
 *
 * Packs reset every night by construction: they live UNDER the night, so a new
 * night starts empty with no sweep to run. Same shape as lib/eliminator.ts.
 */

import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getSealedDrawSeed, type SealedDrawSeed } from '@/lib/jackpotDrawProof';
import {
  assignPrizes, nightFor, nightFromId, nightIdFor, revealNightIdFor,
  packsForFill, seatOddsPerPack,
  NIGHTLY_POOL, TOTAL_SPINS_PER_NIGHT,
  poolForNight, totalSpinsForNight,
  type Prize, type PackRef,
} from '@/lib/dropMath';
import { prizeSummaryLine } from '@/lib/dropRates';

const NIGHTS = 'drop_nights';
const PACKS = 'packs';
const USERS = 'v2_users';
const LEDGER = 'dropLedger';

export interface PackDoc {
  packId: string;
  userId: string;
  nightId: string;
  /** What earned it — the draftId, for audit. */
  source: string;
  passType: 'free' | 'paid';
  earnedAt: string;
  /** Assigned at lock time, null until then. */
  prize?: Prize | null;
  opened: boolean;
  openedAt?: string;
  /** Historical: true on packs the retired midnight sweep opened (through
   *  2026-08-03). Nothing sets it anymore — packs wait for their owner. */
  autoOpened?: boolean;
}

export interface NightDoc {
  nightId: string;
  locksAt: number;
  autoOpensAt: number;
  status: 'earning' | 'locked' | 'settled';
  /** Public commitment stamped when the night OPENS — before any pack exists. */
  saltHash?: string;
  periodNumber?: number;
  /** Digest the assignment derives from. Set at lock. */
  seedDigest?: string;
  packCount?: number;
  lockedAt?: string;
  /** Who got the seat. Set at lock — the whole night is decided then. */
  jackhofPackId?: string | null;
  jackhofUserId?: string | null;
  /** Set only on nights whose override pool includes a plain Jackpot seat. */
  jackpotPackId?: string | null;
  jackpotUserId?: string | null;
}

const strip0x = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);

export function nightSeedDigest(seed: SealedDrawSeed, nightId: string): string {
  return crypto
    .createHash('sha256')
    .update(strip0x(seed.salt) + strip0x(seed.vrfRandomness) + `drop:${nightId}`)
    .digest('hex');
}

/** Open tonight's doc if it doesn't exist, stamping the public commitment.
 *  Idempotent — safe to call on every earn. */
export async function ensureNight(nowMs = Date.now()) {
  const night = nightFor(nowMs);
  if (!isFirestoreConfigured()) return night;
  const ref = getAdminFirestore().collection(NIGHTS).doc(night.nightId);
  if ((await ref.get()).exists) return night;

  // Commitment stamped at OPEN, before a single pack exists — so the seat was
  // provably decided by randomness that predates every pack in the pool.
  const seed = await getSealedDrawSeed();
  const doc: NightDoc = {
    nightId: night.nightId,
    locksAt: night.locksAt,
    autoOpensAt: night.autoOpensAt,
    status: 'earning',
    ...(seed ? { saltHash: seed.saltHash, periodNumber: seed.periodNumber } : {}),
  };
  await ref.set(doc, { merge: true });
  return night;
}

/**
 * Award packs for a FILLED draft.
 *
 * IDEMPOTENT on (night, user, draftId) — the ledger doc is written with the
 * transaction refusing a second write, so the fill webhook and its backstop can
 * both fire and only the first counts.
 *
 * ⚠️ Only ever called from the draft-FILLED path. Entering a draft must not
 * award packs: leaving a filling lobby refunds the pass, so entry-crediting is
 * farmable (enter, earn, leave, repeat, free).
 */
export async function awardPacksForFill(opts: {
  userId: string;
  draftId: string;
  passType: 'free' | 'paid';
  nowMs?: number;
  /** Fire the "you earned N packs" bell. LIVE fills only — backfills must not. */
  notify?: boolean;
}): Promise<{ awarded: number; nightId: string }> {
  const userId = opts.userId.toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  const night = await ensureNight(nowMs);
  const count = packsForFill(opts.passType);
  if (!isFirestoreConfigured() || count <= 0) return { awarded: 0, nightId: night.nightId };

  const db = getAdminFirestore();

  // House bots earn packs exactly like users (Richard, 2026-08-04): a filled
  // draft whose bot seats visibly earn nothing fingerprints those wallets as
  // ours. Accepted trade-off: bots never open packs, so any prize dealt to a
  // bot pack — including a guaranteed JackHOF/Jackpot seat — stays unclaimed.
  const dedupeId = `${night.nightId}__${userId}__${opts.draftId}`
    .replace(/[/\\\s]+/g, '_').slice(0, 1400);
  const ledgerRef = db.collection(USERS).doc(userId).collection(LEDGER).doc(dedupeId);
  const nightRef = db.collection(NIGHTS).doc(night.nightId);

  // Pack ids embed the night + user + draft + index so they're globally unique
  // AND deterministic — the same fill can never mint two different pack sets.
  const packIds = Array.from({ length: count }, (_, i) => `${dedupeId}__${i}`);

  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ledgerRef)).exists) throw new Error('ALREADY_AWARDED');
      // Packs cannot join a night that has already locked — its prizes are
      // assigned. nightFor() already rolls past 8pm, so this is a backstop for
      // a fill webhook that arrives late.
      const nightSnap = await tx.get(nightRef);
      if ((nightSnap.data() as NightDoc | undefined)?.status !== 'earning') {
        throw new Error('NIGHT_LOCKED');
      }
      tx.set(ledgerRef, {
        userId, nightId: night.nightId, draftId: opts.draftId,
        passType: opts.passType, packs: count, at: new Date(nowMs).toISOString(),
      });
      for (const packId of packIds) {
        tx.set(nightRef.collection(PACKS).doc(packId), {
          packId, userId, nightId: night.nightId,
          source: opts.draftId, passType: opts.passType,
          earnedAt: new Date(nowMs).toISOString(),
          prize: null, opened: false,
        } satisfies PackDoc);
      }
      tx.set(nightRef, { packCount: FieldValue.increment(count) }, { merge: true });
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'ALREADY_AWARDED' || msg === 'NIGHT_LOCKED') {
      return { awarded: 0, nightId: night.nightId };
    }
    logger.error('drop.award.failed', { userId, draftId: opts.draftId, err: msg });
    return { awarded: 0, nightId: night.nightId };
  }

  // Ping the bell the moment the pack is earned (Richard, 2026-08-02). Only on
  // the LIVE fill path — the backfill passes notify:false, because replaying a
  // day of fills would fire one bell per historical draft.
  //
  // Deliberately OUTSIDE the transaction: a notification failure must never
  // roll back an award. Never awaited by the caller's critical path either.
  if (opts.notify) {
    void writePackEarnedNoti(userId, night.nightId, count).catch((err) => {
      logger.error('drop.noti.failed', { userId, err: (err as Error).message });
    });
  }

  return { awarded: count, nightId: night.nightId };
}

/**
 * "You earned N packs" bell, written per fill.
 *
 * Doc id includes the draft count so each fill lights the bell again rather
 * than silently editing one rolling row — the ping IS the point. The message
 * carries the running total so a player never has to add them up.
 */
async function writePackEarnedNoti(userId: string, nightId: string, earned: number): Promise<void> {
  const db = getAdminFirestore();
  const total = (await db.collection(NIGHTS).doc(nightId).collection(PACKS)
    .where('userId', '==', userId).count().get()).data().count;

  const docId = `${userId}__drop-earned-${nightId}-${total}`
    .replace(/[/\\\s]+/g, '_').slice(0, 1400);
  await db.collection('marketplace_notifications').doc(docId).create({
    wallet: userId,
    type: 'promo',
    icon: '🌙',
    title: `🌙 +${earned} pack${earned === 1 ? '' : 's'} — draft filled`,
    message: `Your draft filled and earned ${earned} sealed pack${earned === 1 ? '' : 's'}. You now hold ${total} for tonight's Drop. They open at 9:00 PM PT — ${prizeSummaryLine(nightId)}, all guaranteed. Tap to see your stack.`,
    link: '/drop',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  }).catch((err: { code?: number }) => {
    if (err?.code === 6) return; // already exists — a retried webhook, not an error
    throw err;
  });
}

/**
 * Lock the night and assign every prize. Runs once, at 8pm.
 *
 * Everything is decided here — including who gets the seat — and only then can
 * anything be opened. Opening is pure reveal afterward, which is what makes the
 * night verifiable: publish the seed and anyone can recompute the whole
 * assignment and confirm nothing moved after packs started opening.
 */
export async function lockNight(nightId: string, nowMs = Date.now()): Promise<{
  ok: boolean; reason?: string; packCount?: number; jackhofUserId?: string | null;
}> {
  if (!isFirestoreConfigured()) return { ok: false, reason: 'no-firestore' };
  const db = getAdminFirestore();
  const nightRef = db.collection(NIGHTS).doc(nightId);
  const snap = await nightRef.get();
  if (!snap.exists) return { ok: false, reason: 'no-night' };
  const doc = snap.data() as NightDoc;
  if (doc.status !== 'earning') return { ok: true, reason: 'already-locked', jackhofUserId: doc.jackhofUserId };
  if (nowMs < doc.locksAt) return { ok: false, reason: 'too-early' };

  // Refuse to assign without sealed randomness rather than fall back to a
  // predictable hash. The night stays open and the next tick retries.
  const seed = await getSealedDrawSeed();
  if (!seed) return { ok: false, reason: 'no-sealed-seed' };
  const seedHex = nightSeedDigest(seed, nightId);

  const packSnap = await nightRef.collection(PACKS).get();
  const refs: PackRef[] = packSnap.docs.map((d) => {
    const p = d.data() as PackDoc;
    return { packId: p.packId, userId: p.userId };
  });
  if (refs.length === 0) {
    await nightRef.set({ status: 'settled', lockedAt: new Date(nowMs).toISOString(), seedDigest: seedHex, packCount: 0 }, { merge: true });
    return { ok: true, reason: 'no-packs', packCount: 0 };
  }

  const assignments = assignPrizes(refs, seedHex, nightId);
  const jackhof = assignments.find((a) => a.prize.kind === 'jackhof') ?? null;
  const jackpot = assignments.find((a) => a.prize.kind === 'jackpot') ?? null;

  // Claim the lock first, so two simultaneous callers can't both assign.
  try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(nightRef);
      if ((fresh.data() as NightDoc | undefined)?.status !== 'earning') throw new Error('ALREADY_LOCKED');
      tx.set(nightRef, {
        status: 'locked',
        lockedAt: new Date(nowMs).toISOString(),
        seedDigest: seedHex,
        packCount: refs.length,
        jackhofPackId: jackhof?.packId ?? null,
        jackhofUserId: jackhof?.userId ?? null,
        jackpotPackId: jackpot?.packId ?? null,
        jackpotUserId: jackpot?.userId ?? null,
      }, { merge: true });
    });
  } catch (err) {
    if ((err as Error).message === 'ALREADY_LOCKED') {
      const again = (await nightRef.get()).data() as NightDoc;
      return { ok: true, reason: 'already-locked', jackhofUserId: again.jackhofUserId };
    }
    throw err;
  }

  // Write each pack's prize. Batched — a night is hundreds of packs, not tens
  // of thousands, so this stays well inside Firestore's 500-op batch limit per
  // chunk.
  const CHUNK = 400;
  for (let i = 0; i < assignments.length; i += CHUNK) {
    const batch = db.batch();
    for (const a of assignments.slice(i, i + CHUNK)) {
      batch.set(nightRef.collection(PACKS).doc(a.packId), { prize: a.prize }, { merge: true });
    }
    await batch.commit();
  }

  logger.info('drop.night.locked', {
    nightId, packCount: refs.length,
    jackhofUserId: jackhof?.userId ?? null,
    jackpotUserId: jackpot?.userId ?? null,
    spins: totalSpinsForNight(nightId),
  });
  return { ok: true, packCount: refs.length, jackhofUserId: jackhof?.userId ?? null };
}

export interface OpenedPack {
  packId: string;
  prize: Prize;
}

/**
 * Open one or more of a user's packs and hand over the contents.
 *
 * Idempotent per pack: `opened` flips inside a transaction, so a double-tap or
 * a retried request can never pay a prize twice. Callers pass `packIds` to open
 * specific packs (one at a time) or omit it to open everything (open-all).
 */
export async function openPacks(opts: {
  userId: string;
  nightId: string;
  packIds?: string[];
  auto?: boolean;
  nowMs?: number;
}): Promise<{ ok: boolean; reason?: string; opened: OpenedPack[] }> {
  const userId = opts.userId.toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  if (!isFirestoreConfigured()) return { ok: false, reason: 'no-firestore', opened: [] };

  const db = getAdminFirestore();
  const nightRef = db.collection(NIGHTS).doc(opts.nightId);
  const nightDoc = (await nightRef.get()).data() as NightDoc | undefined;
  if (!nightDoc) return { ok: false, reason: 'no-night', opened: [] };
  // Nothing opens before the night is locked — the prizes don't exist yet.
  if (nightDoc.status === 'earning') return { ok: false, reason: 'not-yet', opened: [] };

  const mine = await nightRef.collection(PACKS).where('userId', '==', userId).get();
  const targets = mine.docs
    .map((d) => d.data() as PackDoc)
    .filter((p) => !p.opened)
    .filter((p) => (opts.packIds ? opts.packIds.includes(p.packId) : true));
  if (targets.length === 0) return { ok: true, reason: 'nothing-to-open', opened: [] };

  const opened: OpenedPack[] = [];
  for (const p of targets) {
    const ref = nightRef.collection(PACKS).doc(p.packId);
    try {
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(ref)).data() as PackDoc | undefined;
        if (!fresh || fresh.opened) throw new Error('ALREADY_OPEN');
        tx.set(ref, {
          opened: true,
          openedAt: new Date(nowMs).toISOString(),
          ...(opts.auto ? { autoOpened: true } : {}),
        }, { merge: true });
      });
      opened.push({ packId: p.packId, prize: p.prize ?? { kind: 'none' } });
    } catch {
      // Already open — skip it. Never surfaces as an error to the user.
    }
  }
  return { ok: true, opened };
}

/** Everything the promo card and the opening page need, in one read. */
export async function getDropState(userId?: string, nowMs = Date.now()): Promise<{
  nightId: string;
  locksAt: number;
  autoOpensAt: number;
  status: 'earning' | 'locked' | 'settled';
  packCount: number;
  /** Chance any ONE pack holds the seat tonight — the number that makes
   *  drafting one more draft worth it. */
  seatOdds: number;
  totalSpins: number;
  poolSize: number;
  saltHash?: string;
  periodNumber?: number;
  seedDigest?: string;
  you: { sealed: number; opened: number; packIds: string[] } | null;
  /** Set only between 8pm and midnight: the night you're now EARNING into,
   *  while the night above is the one you're still opening. */
  next: { nightId: string; locksAt: number; sealed: number } | null;
  /** Sealed packs from BEFORE tonight — there's no auto-open, so anything a
   *  player didn't rip is still waiting. Newest first. */
  previous: Array<{ nightId: string; sealed: number }>;
}> {
  // The night being REVEALED, not the one being earned into. After 8pm those
  // diverge, and using the earning night here would hide tonight's packs.
  const night = nightFromId(revealNightIdFor(nowMs));
  const base = {
    nightId: night.nightId,
    locksAt: night.locksAt,
    autoOpensAt: night.autoOpensAt,
    status: 'earning' as const,
    packCount: 0,
    seatOdds: 0,
    totalSpins: totalSpinsForNight(night.nightId),
    poolSize: poolForNight(night.nightId).length,
    you: null,
    next: null,
    previous: [] as Array<{ nightId: string; sealed: number }>,
  };
  if (!isFirestoreConfigured()) return base;

  const db = getAdminFirestore();
  const nightRef = db.collection(NIGHTS).doc(night.nightId);
  const [snap, mine] = await Promise.all([
    nightRef.get(),
    userId
      ? nightRef.collection(PACKS).where('userId', '==', userId.toLowerCase()).get()
      : Promise.resolve(null),
  ]);
  const doc = snap.data() as NightDoc | undefined;
  const packCount = doc?.packCount ?? 0;

  let you: { sealed: number; opened: number; packIds: string[] } | null = null;
  if (mine) {
    const packs = mine.docs.map((d) => d.data() as PackDoc);
    you = {
      sealed: packs.filter((p) => !p.opened).length,
      opened: packs.filter((p) => p.opened).length,
      packIds: packs.filter((p) => !p.opened).map((p) => p.packId).sort(),
    };
  }

  // Between 8pm and midnight the earning night has already rolled forward, so
  // a draft that fills at 8:30pm is banking packs for TOMORROW. Surface that
  // count too, or those packs are invisible until the next day (Richard,
  // 2026-08-02: "we need them to see there passes ... for tommorows drawing").
  let next: { nightId: string; locksAt: number; sealed: number } | null = null;
  const earningId = nightIdFor(nowMs);
  if (earningId !== night.nightId) {
    const nextNight = nightFromId(earningId);
    let sealed = 0;
    if (userId) {
      sealed = (await db.collection(NIGHTS).doc(earningId).collection(PACKS)
        .where('userId', '==', userId.toLowerCase()).count().get()).data().count;
    }
    next = { nightId: earningId, locksAt: nextNight.locksAt, sealed };
  }

  // Sealed packs from BEFORE tonight. No auto-open means these can exist for
  // any night the player ever earned into, so the candidate nights come from
  // their own dropLedger (permanent, per-user, one doc per fill) rather than
  // scanning drop_nights — no collection-group index, cost bounded by the
  // player's own history. Equality-only pack queries need no composite index.
  let previous: Array<{ nightId: string; sealed: number }> = [];
  if (userId) {
    try {
      const uid = userId.toLowerCase();
      const ledger = await db.collection(USERS).doc(uid).collection(LEDGER)
        .select('nightId').get();
      const nightIds = [...new Set(
        ledger.docs.map((d) => (d.data() as { nightId?: string }).nightId)
          .filter((id): id is string => !!id && id < night.nightId),
      )].sort().reverse();

      const rows = await Promise.all(nightIds.map(async (id) => {
        // Skip nights that never locked — their packs have no prizes yet and
        // openPacks would refuse them anyway. The cron's straddle candidate
        // locks stragglers on its own.
        const [nightSnap, packSnap] = await Promise.all([
          db.collection(NIGHTS).doc(id).get(),
          db.collection(NIGHTS).doc(id).collection(PACKS).where('userId', '==', uid).get(),
        ]);
        if ((nightSnap.data() as NightDoc | undefined)?.status === 'earning') return null;
        const sealed = packSnap.docs.filter((d) => !(d.data() as PackDoc).opened).length;
        return sealed > 0 ? { nightId: id, sealed } : null;
      }));
      previous = rows.filter((r): r is { nightId: string; sealed: number } => r !== null);
    } catch (err) {
      // The backlog is additive UI — never let it take down tonight's state.
      logger.warn('drop.previous_failed', { err: (err as Error).message });
    }
  }

  return {
    ...base,
    status: doc?.status ?? 'earning',
    packCount,
    seatOdds: seatOddsPerPack(packCount),
    saltHash: doc?.saltHash,
    periodNumber: doc?.periodNumber,
    seedDigest: doc?.seedDigest,
    you,
    next,
    previous,
  };
}

export { nightFromId, NIGHTLY_POOL, TOTAL_SPINS_PER_NIGHT };
