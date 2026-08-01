/**
 * THE ELIMINATOR — Firestore layer. Pure rates/day/burn math lives in
 * lib/eliminatorMath.ts; this does the reads and writes.
 *
 * Collections
 *   eliminator_days/{dayId}                  the day, its sealed commitment + result
 *   eliminator_days/{dayId}/players/{uid}    per-user Bananas + list state (resets daily)
 *   eliminator_days/{dayId}/burns/{index}    one doc per burn — survivors, burned, snapshot
 *   v2_users/{uid}/eliminatorLedger/{id}     PERMANENT credit log — never resets
 *
 * Bananas reset every day by construction: players live UNDER the day, so a new
 * day starts empty with no sweep to run and nothing to get stuck. Same shape as
 * lib/bananaDraw.ts, which this succeeds.
 */

import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getSealedDrawSeed, type SealedDrawSeed } from '@/lib/jackpotDrawProof';
import {
  bananasForSource, dayFor, dayFromId, prevDayId, dueBurns, pickSurvivors, pickJackhofWinner, survivalOdds,
  BANANAS_SURVIVE_HOUR, SURVIVORS_PER_BURN,
  type EliminatorSource, type EliminatorDay, type ListPlayer,
} from '@/lib/eliminatorMath';

const DAYS = 'eliminator_days';
const PLAYERS = 'players';
const BURNS = 'burns';
const USERS = 'v2_users';
const LEDGER = 'eliminatorLedger';
/** Ceiling on username resolution — the Firestore read is the same
 *  full-collection get either way; what scales is the getAll batch. */
const NAME_RESOLVE_CAP = 250;

export interface PlayerDoc {
  userId: string;
  /** Total Bananas this day. KEPT through a burn — only the list spot is lost. */
  bananas: number;
  /** True while they hold a spot. Re-entering costs another draft entry. */
  onList: boolean;
  /** Consecutive burns survived. Display only — the +10 is flat. */
  streak: number;
  freeDrafts: number;
  paidDrafts: number;
  hoursSurvived: number;
  joinedAt: string;
  updatedAt: string;
}

export interface DayDoc {
  dayId: string;
  opensAt: number;
  closesAt: number;
  status: 'open' | 'closed';
  saltHash?: string;
  periodNumber?: number;
  /** Highest burn index already executed. -1 = none yet. */
  lastBurnIndex: number;
  seedDigest?: string;
  winners?: string[];
  jackhofWinnerId?: string | null;
  closedAt?: string;
  /** When the JackHOF winner is revealed — the final burn locks the 5, then
   *  the seat is drawn a few minutes later so the two are separate moments. */
  revealAt?: number;
  revealedAt?: string;
}

const strip0x = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);

/** Per-day burn digest: the period's sealed salt + VRF bound to this day.
 *  Full 32-byte digest so the modulo stays unbiased whatever the pool size. */
export function daySeedDigest(seed: SealedDrawSeed, dayId: string): string {
  return crypto
    .createHash('sha256')
    .update(strip0x(seed.salt) + strip0x(seed.vrfRandomness) + `eliminator:${dayId}`)
    .digest('hex');
}

/** Open today's doc if it doesn't exist, stamping the public commitment.
 *  Idempotent — safe to call on every credit and every cron tick. */
export async function ensureDay(nowMs = Date.now()): Promise<EliminatorDay> {
  const day = dayFor(nowMs);
  if (!isFirestoreConfigured()) return day;
  const ref = getAdminFirestore().collection(DAYS).doc(day.dayId);
  const snap = await ref.get();
  if (snap.exists) return day;

  // Stamp the commitment at OPEN. saltHash is already on-chain from the wheel
  // period's open, so this ties every burn to randomness that provably predates
  // any entry — nobody can compute whether a last-second draft saves them.
  const seed = await getSealedDrawSeed();
  const doc: DayDoc = {
    dayId: day.dayId,
    opensAt: day.opensAt,
    closesAt: day.closesAt,
    status: 'open',
    lastBurnIndex: -1,
    ...(seed ? { saltHash: seed.saltHash, periodNumber: seed.periodNumber } : {}),
  };
  await ref.set(doc, { merge: true });
  return day;
}

/**
 * Credit Bananas AND put the user on the list.
 *
 * IDEMPOTENT on `refId` — the ledger doc id is derived from (day, user, source,
 * refId) and written inside a transaction that refuses a second write, so a
 * webhook and its backstop can both fire and only the first counts.
 *
 * `refId` identifies the earning EVENT: the draftId for a draft entry, the burn
 * index for a survival award.
 *
 * ⚠️ Entering a draft is the ONLY way onto the list. Buying a pass earns nothing
 * and does not seat you (Richard 2026-07-31).
 */
export async function creditBananas(opts: {
  userId: string;
  source: EliminatorSource;
  refId: string;
  nowMs?: number;
  meta?: Record<string, unknown>;
  /**
   * Force the day this credit lands on, instead of deriving it from the clock.
   *
   * ⚠️ REQUIRED for survival awards. dayIdFor rolls at 9pm sharp, which is the
   * same instant the final burn fires — so a survivor's +10 for the LAST burn
   * of the night was landing on TOMORROW's list. The final five then started
   * the next day already holding 10 Bananas while everyone else started at 0
   * (2026-07-31). Burn credits belong to the day that burned.
   */
  dayId?: string;
}): Promise<{ credited: boolean; bananas: number; dayId: string }> {
  const userId = opts.userId.toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  const day = opts.dayId ? dayFromId(opts.dayId) : await ensureDay(nowMs);
  const amount = bananasForSource(opts.source);

  if (!isFirestoreConfigured() || amount <= 0) {
    return { credited: false, bananas: 0, dayId: day.dayId };
  }

  const db = getAdminFirestore();
  // Dedupe key INCLUDES the day: unlike the Banana Draw's referral credits,
  // every source here is a per-day event (a draft entered today, a burn survived
  // today), so the same draft on a later day is a genuinely new credit.
  const dedupeId = `${day.dayId}__${userId}__${opts.source}__${opts.refId}`
    .replace(/[/\\\s]+/g, '_').slice(0, 1400);
  // Ledger lives UNDER the user, not in a root collection — a root collection
  // would need a composite (userId + at) index, which can't ship with a code
  // deploy. As a subcollection this is a plain orderBy Firestore indexes itself.
  const ledgerRef = db.collection(USERS).doc(userId).collection(LEDGER).doc(dedupeId);
  const playerRef = db.collection(DAYS).doc(day.dayId).collection(PLAYERS).doc(userId);

  const isPaid = opts.source === 'draft-paid';
  const isFree = opts.source === 'draft-free';
  const isSurvive = opts.source === 'survive';

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) throw new Error('ALREADY_CREDITED');

      tx.set(ledgerRef, {
        userId,
        dayId: day.dayId,
        source: opts.source,
        refId: opts.refId,
        bananas: amount,
        at: new Date(nowMs).toISOString(),
        ...(opts.meta ?? {}),
      });

      tx.set(playerRef, {
        userId,
        bananas: FieldValue.increment(amount),
        // A draft entry seats you. A survival award keeps you where you are.
        ...(isSurvive ? {} : { onList: true }),
        freeDrafts: FieldValue.increment(isFree ? 1 : 0),
        paidDrafts: FieldValue.increment(isPaid ? 1 : 0),
        hoursSurvived: FieldValue.increment(isSurvive ? 1 : 0),
        joinedAt: existing.exists ? undefined : new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      }, { merge: true });
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'ALREADY_CREDITED') {
      return { credited: false, bananas: 0, dayId: day.dayId };
    }
    logger.error('eliminator.credit.failed', { userId, source: opts.source, refId: opts.refId, err: msg });
    return { credited: false, bananas: 0, dayId: day.dayId };
  }

  return { credited: true, bananas: amount, dayId: day.dayId };
}

/**
 * Put a wallet back ON the list without crediting anything.
 *
 * ⚠️ FILL ONLY. Do not call this from an entry/join path (Richard 2026-07-31).
 * Entering a lobby used to restore the spot, and that was farmable in exactly
 * the way entry-crediting was: leaving a filling lobby refunds the pass
 * (/api/owner/refund-pass), so enter → back on the list → leave → get the pass
 * back left a burned wallet standing in the next burn for free, forever.
 * Standing is the thing that pays — it's what puts you in the weighted draw —
 * so it has to cost the same real play the Bananas do.
 *
 * This exists as a separate write from the credit because a fill can legitimately
 * credit nothing: draft slot ids are RECYCLED within a day (2026-fast-draft-359
 * ran twice on 7/31), so a wallet filling the same slot id twice hits the
 * ledger's ALREADY_CREDITED guard, which aborts the whole transaction — including
 * the onList set. Seating separately means a deduped credit can't silently leave
 * a real filled draft off the list.
 *
 * No-ops for a wallet with no Bananas today: standing is earned by filling a
 * draft, so an empty stack has nothing to restore and zero burn weight anyway.
 */
export async function seatOnList(userId: string, nowMs = Date.now()): Promise<boolean> {
  if (!isFirestoreConfigured()) return false;
  const uid = userId.toLowerCase();
  const day = await ensureDay(nowMs);
  const ref = getAdminFirestore()
    .collection(DAYS).doc(day.dayId).collection(PLAYERS).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const p = snap.data() as PlayerDoc;
  if ((Number(p.bananas) || 0) <= 0 || p.onList === true) return false;
  await ref.set({ onList: true, updatedAt: new Date(nowMs).toISOString() }, { merge: true });
  return true;
}

/** Credit a filled draft. Mirrors the Banana Draw's hook so the same call site
 *  can drive both during the changeover.
 *
 *  Seats the wallet AFTER the credit, unconditionally — see seatOnList for why
 *  the credit alone can't be trusted to do it. */
export async function creditDraft(opts: {
  userId: string;
  draftId: string;
  passType: 'free' | 'paid';
  nowMs?: number;
}) {
  const res = await creditBananas({
    userId: opts.userId,
    source: opts.passType === 'paid' ? 'draft-paid' : 'draft-free',
    refId: opts.draftId,
    nowMs: opts.nowMs,
    meta: { draftId: opts.draftId, passType: opts.passType },
  });
  await seatOnList(opts.userId, opts.nowMs);
  return res;
}

/** Everyone currently holding a spot, for the burn. */
async function readList(dayId: string): Promise<ListPlayer[]> {
  const snap = await getAdminFirestore()
    .collection(DAYS).doc(dayId).collection(PLAYERS).get();
  return snap.docs
    .map((d) => d.data() as PlayerDoc)
    .filter((p) => p.onList === true && (Number(p.bananas) || 0) > 0)
    .map((p) => ({ userId: p.userId, bananas: Number(p.bananas) || 0 }));
}

export interface BurnOutcome {
  ok: boolean;
  reason?: string;
  burnIndex: number;
  survivors: string[];
  burned: string[];
  isFinal: boolean;
}

/**
 * Execute one burn. Idempotent per (day, burnIndex): the day doc's
 * lastBurnIndex advances inside a transaction, so a duplicate cron tick is a
 * no-op rather than a second elimination.
 */
export async function executeBurn(dayId: string, burnIndex: number, nowMs = Date.now()): Promise<BurnOutcome> {
  const empty: BurnOutcome = { ok: false, burnIndex, survivors: [], burned: [], isFinal: false };
  if (!isFirestoreConfigured()) return { ...empty, reason: 'no-firestore' };

  const db = getAdminFirestore();
  const dayRef = db.collection(DAYS).doc(dayId);
  const daySnap = await dayRef.get();
  if (!daySnap.exists) return { ...empty, reason: 'no-day' };
  const dayDoc = daySnap.data() as DayDoc;
  if ((dayDoc.lastBurnIndex ?? -1) >= burnIndex) {
    return { ...empty, ok: true, reason: 'already-burned' };
  }

  // Refuse to burn without sealed randomness rather than fall back to a weak
  // predictable hash. The day stays open and the next tick retries — nobody
  // loses their Bananas. Same stance as the Banana Draw cron.
  const seed = await getSealedDrawSeed();
  if (!seed) return { ...empty, reason: 'no-sealed-seed' };
  const seedHex = daySeedDigest(seed, dayId);

  const day = dayFromId(dayId);
  const isFinal = burnIndex === day.burnAts.length - 1;

  const list = await readList(dayId);
  const result = pickSurvivors(list, seedHex, dayId, burnIndex);

  // Claim the burn first. If this throws (another tick got there), we stop
  // before mutating any player, so a race can't double-eliminate.
  try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(dayRef);
      const cur = (fresh.data() as DayDoc | undefined)?.lastBurnIndex ?? -1;
      if (cur >= burnIndex) throw new Error('ALREADY_BURNED');
      tx.set(dayRef, { lastBurnIndex: burnIndex, seedDigest: seedHex }, { merge: true });
    });
  } catch (err) {
    if ((err as Error).message === 'ALREADY_BURNED') {
      return { ...empty, ok: true, reason: 'already-burned' };
    }
    throw err;
  }

  const playersCol = dayRef.collection(PLAYERS);
  const burnedSet = new Set(result.burned);

  // Knock the burned off the list. Bananas are untouched — that's the rule.
  await Promise.allSettled(result.burned.map((uid) => playersCol.doc(uid).set({
    onList: false,
    streak: 0,
    updatedAt: new Date(nowMs).toISOString(),
  }, { merge: true })));

  // Survivors bank +10 and extend their streak. The ledger keeps this
  // idempotent per (day, user, burn) even if this half re-runs.
  await Promise.allSettled(result.survivors.map(async (uid) => {
    await creditBananas({ userId: uid, source: 'survive', refId: `burn-${burnIndex}`, nowMs, dayId });
    await playersCol.doc(uid).set({
      streak: FieldValue.increment(1),
      updatedAt: new Date(nowMs).toISOString(),
    }, { merge: true });
  }));

  await dayRef.collection(BURNS).doc(String(burnIndex)).set({
    burnIndex,
    at: new Date(nowMs).toISOString(),
    survivors: result.survivors,
    burned: result.burned,
    totalWeight: result.totalWeight,
    snapshot: result.weights,
    seedDigest: seedHex,
    isFinal,
  }, { merge: true });

  if (isFinal) {
    // BEAT ONE. Lock the five and stop there — the seat is drawn separately,
    // REVEAL_DELAY_MS later, so "who made it" and "who won it" are two moments
    // instead of one (Richard 2026-07-31). Without the gap the biggest payoff
    // of the day lasted zero seconds.
    await dayRef.set({
      status: 'closed',
      winners: result.survivors,
      closedAt: new Date(nowMs).toISOString(),
      revealAt: nowMs + REVEAL_DELAY_MS,
    }, { merge: true });
  }

  logger.info('eliminator.burn.complete', {
    dayId, burnIndex, survivors: result.survivors.length, burned: burnedSet.size, isFinal,
  });

  return {
    ok: true, burnIndex, survivors: result.survivors, burned: result.burned, isFinal,
  };
}

/** Gap between the final burn and the winner reveal. */
export const REVEAL_DELAY_MS = 5 * 60 * 1000;

/**
 * BEAT TWO — draw the JackHOF seat from the locked final five.
 *
 * Separate from the burn on purpose so the day ends on two moments: the five
 * survivors lock at 9:00, then five minutes of everyone knowing they're one of
 * five and not which. Idempotent: the winner is claimed in a transaction, so
 * concurrent callers produce exactly one draw.
 *
 * Weighted by the Bananas each finalist FINISHED on, read fresh here so the
 * 9pm +10s count toward the odds.
 */
export async function revealJackhofWinner(dayId: string, nowMs = Date.now()): Promise<{
  ok: boolean; reason?: string; winnerId?: string | null; runnersUp?: string[];
  odds?: Array<{ userId: string; bananas: number; pct: number }>;
}> {
  if (!isFirestoreConfigured()) return { ok: false, reason: 'no-firestore' };
  const db = getAdminFirestore();
  const dayRef = db.collection(DAYS).doc(dayId);
  const snap = await dayRef.get();
  if (!snap.exists) return { ok: false, reason: 'no-day' };
  const doc = snap.data() as DayDoc;
  if (doc.status !== 'closed') return { ok: false, reason: 'not-closed' };
  if (doc.jackhofWinnerId !== undefined && doc.jackhofWinnerId !== null) {
    return { ok: true, reason: 'already-revealed', winnerId: doc.jackhofWinnerId };
  }
  if (typeof doc.revealAt === 'number' && nowMs < doc.revealAt) {
    return { ok: false, reason: 'too-early' };
  }

  const seed = await getSealedDrawSeed();
  if (!seed) return { ok: false, reason: 'no-sealed-seed' };
  const seedHex = daySeedDigest(seed, dayId);

  const finalIds = doc.winners ?? [];
  const playersCol = dayRef.collection(PLAYERS);
  const finalSnap = await playersCol.get();
  const byId = new Map(finalSnap.docs.map((d) => [d.id, d.data() as PlayerDoc]));
  const finalists: ListPlayer[] = finalIds.map((uid) => ({
    userId: uid,
    bananas: Number(byId.get(uid)?.bananas ?? 0),
  }));

  const picked = pickJackhofWinner(finalists, seedHex, dayId);

  try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(dayRef);
      const cur = fresh.data() as DayDoc | undefined;
      if (cur?.jackhofWinnerId) throw new Error('ALREADY_REVEALED');
      tx.set(dayRef, {
        jackhofWinnerId: picked.winnerId,
        revealedAt: new Date(nowMs).toISOString(),
      }, { merge: true });
    });
  } catch (err) {
    if ((err as Error).message === 'ALREADY_REVEALED') {
      const again = (await dayRef.get()).data() as DayDoc;
      return { ok: true, reason: 'already-revealed', winnerId: again.jackhofWinnerId };
    }
    throw err;
  }

  logger.info('eliminator.jackhof.revealed', {
    dayId, winnerId: picked.winnerId, totalBananas: picked.totalBananas,
    odds: picked.odds.map((o) => `${o.userId.slice(0, 8)}:${o.bananas}=${o.pct.toFixed(1)}%`),
  });
  return {
    ok: true,
    winnerId: picked.winnerId,
    runnersUp: finalIds.filter((u) => u !== picked.winnerId),
    odds: picked.odds,
  };
}

/** Every burn whose clock has passed and which hasn't run yet. */
export async function pendingBurns(dayId: string, nowMs = Date.now()): Promise<number[]> {
  if (!isFirestoreConfigured()) return [];
  const snap = await getAdminFirestore().collection(DAYS).doc(dayId).get();
  if (!snap.exists) return [];
  const doc = snap.data() as DayDoc;
  if (doc.status === 'closed') return [];
  return dueBurns(dayFromId(dayId), nowMs, doc.lastBurnIndex ?? -1);
}

export interface LeaderRow {
  userId: string;
  name: string;
  bananas: number;
  streak: number;
  onList: boolean;
  rank: number;
  /** Chance of surviving the NEXT burn, %. Live — moves the moment a fill
   *  lands, which is what makes drafting mid-hour feel like it did something. */
  odds: number;
}

/**
 * Resolve wallets → the handle people display as.
 *
 * ⚠️ Never derive the name from the wallet hash (`bananaNumberFromWallet`).
 * It's display-forbidden: only 90k wide, does NOT match the server-assigned
 * `bananaNumber`, and has mis-identified users twice. Read the STORED field —
 * a leaderboard full of hash-invented names reads as fake data, because it is.
 */
async function resolveNames(userIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!isFirestoreConfigured() || userIds.length === 0) return out;
  const db = getAdminFirestore();
  const refs = [...new Set(userIds.map((u) => u.toLowerCase()))]
    .map((u) => db.collection(USERS).doc(u));
  const snaps = await db.getAll(...refs).catch(() => []);
  for (const s of snaps) {
    const d = s.data() ?? {};
    const raw = String(d.username ?? '').trim();
    if (raw) out[s.id] = raw;
  }
  return out;
}

export interface LastNight {
  dayId: string;
  winnerId: string | null;
  winnerName: string | null;
  finalists: Array<{ userId: string; name: string; bananas: number }>;
}

/** How long the finished board stays up after the seat is drawn, so the reveal
 *  animation plays and the result gets a moment to land before the board turns
 *  over to the summary card. */
const REVEAL_HOLD_MS = 15 * 60 * 1000;

function revealSettledAt(doc: DayDoc): number {
  const base = doc.revealAt ?? (doc.closesAt + REVEAL_DELAY_MS);
  return base + REVEAL_HOLD_MS;
}

/**
 * The day the BOARD renders while the night is finishing.
 *
 * dayIdFor rolls at 9pm sharp — the same instant the final burn fires — so
 * without this the board flips to an empty list at the exact moment the seat is
 * won and nobody ever sees the final 5, the reveal, or the winner. We hold the
 * finished day through the reveal; after that getLeaderboard's `lastNight`
 * summary takes over and the live list becomes the board again.
 */
async function displayDay(nowMs: number): Promise<EliminatorDay> {
  const today = dayFor(nowMs);
  if (nowMs >= today.opensAt || !isFirestoreConfigured()) return today;
  const prev = dayFromId(prevDayId(today.dayId));
  const snap = await getAdminFirestore().collection(DAYS).doc(prev.dayId).get();
  const doc = snap.data() as DayDoc | undefined;
  if (doc?.status !== 'closed') return today;
  return nowMs < revealSettledAt(doc) ? prev : today;
}

/**
 * Last night's result, for the board to show ALONGSIDE the live list.
 *
 * The board itself always shows the CURRENT day — dayIdFor rolls at 9pm, so
 * from 9:00pm the live list is already tomorrow's and drafting right now banks
 * onto it. That is the thing we want people acting on overnight, so it stays
 * the main board. But the payoff still has to be visible or the night just ends
 * in an empty list with no answer to "who won?" — hence this alongside it.
 *
 * Returns null once the new day has genuinely started (9am), and for any
 * previous day that never closed.
 */
async function readLastNight(today: EliminatorDay, nowMs: number): Promise<LastNight | null> {
  if (nowMs >= today.opensAt || !isFirestoreConfigured()) return null;
  const db = getAdminFirestore();
  const prevId = prevDayId(today.dayId);
  const snap = await db.collection(DAYS).doc(prevId).get();
  const doc = snap.data() as DayDoc | undefined;
  if (doc?.status !== 'closed') return null;
  // Hold off until the LIVE reveal has finished playing. Until then the board
  // proper is still parked on last night (see displayDay) so the final-5 lock
  // and the seat draw animate exactly as built; handing back a summary card
  // here would yank the board out from under that.
  if (nowMs < revealSettledAt(doc)) return null;

  const finalIds = (doc.winners ?? []) as string[];
  if (finalIds.length === 0) return null;
  const names = await resolveNames(finalIds);
  const players = await Promise.all(finalIds.map((uid) => db
    .collection(DAYS).doc(prevId).collection(PLAYERS).doc(uid).get()));
  const finalists = finalIds.map((uid, i) => ({
    userId: uid,
    name: names[uid] ?? 'Player',
    bananas: Number((players[i].data() as PlayerDoc | undefined)?.bananas) || 0,
  })).sort((a, b) => b.bananas - a.bananas);

  const winnerId = doc.jackhofWinnerId ?? null;
  return {
    dayId: prevId,
    winnerId,
    winnerName: winnerId ? (names[winnerId] ?? 'Winner') : null,
    finalists,
  };
}

/**
 * Everything the leaderboard needs in one read: the survivors, the two rows
 * below the cut (what makes a holder sweat and a challenger push), and the
 * viewer's own row with the exact gap to a seat.
 */
export async function getLeaderboard(viewerId?: string, nowMs = Date.now()): Promise<{
  dayId: string;
  opensAt: number;
  closesAt: number;
  nextBurnAt: number | null;
  status: 'pending' | 'live' | 'closed';
  survivors: LeaderRow[];
  contenders: LeaderRow[];
  you: (LeaderRow & { bananasToSeat: number }) | null;
  /** EVERY player on the list, ranked — powers "Show all". */
  all: LeaderRow[];
  /** Highest burn already executed today. The client watches this increment
   *  to know a burn just fired and play the burn animation. -1 = none yet. */
  burnIndex: number;
  /** When the JackHOF seat is drawn from the locked final 5. */
  revealAt?: number | null;
  /** Public VRF commitment, recorded when the day OPENED — before anyone
   *  earned a Banana. Shown on the board so the fairness is verifiable rather
   *  than merely claimed. */
  saltHash?: string;
  periodNumber?: number;
  /** Digest every burn today derives from. Set at the first burn. */
  seedDigest?: string;
  onListCount: number;
  survivorSlots: number;
  jackhofWinnerId?: string | null;
  winners?: string[];
  /** Last night's final 5 + seat winner, shown above tonight's live list. */
  lastNight?: LastNight | null;
}> {
  const day = await displayDay(nowMs);
  const base = {
    dayId: day.dayId,
    opensAt: day.opensAt,
    closesAt: day.closesAt,
    nextBurnAt: day.burnAts.find((at) => at > nowMs) ?? null,
    survivors: [] as LeaderRow[],
    contenders: [] as LeaderRow[],
    all: [] as LeaderRow[],
    burnIndex: -1,
    revealAt: null as number | null,
    you: null,
    onListCount: 0,
    survivorSlots: SURVIVORS_PER_BURN,
  };
  if (!isFirestoreConfigured()) return { ...base, status: 'pending' as const };

  // ⚠️ dayFor, NOT `day` — `day` may be last night while the reveal is still
  // holding the board, and readLastNight works backwards from the real today.
  const lastNight = await readLastNight(dayFor(nowMs), nowMs);
  const db = getAdminFirestore();
  const dayRef = db.collection(DAYS).doc(day.dayId);
  const [daySnap, playerSnap] = await Promise.all([
    dayRef.get(),
    dayRef.collection(PLAYERS).get(),
  ]);
  const dayDoc = daySnap.data() as DayDoc | undefined;

  const all = playerSnap.docs.map((d) => d.data() as PlayerDoc);
  const onList = all.filter((p) => p.onList === true)
    .sort((a, b) => (Number(b.bananas) || 0) - (Number(a.bananas) || 0));
  const off = all.filter((p) => p.onList !== true)
    .sort((a, b) => (Number(b.bananas) || 0) - (Number(a.bananas) || 0));

  // Resolve enough names for the FULL expanded board, not just the visible
  // rows — "Show all" renders every player on the list. Capped so one
  // getAll batch stays bounded if the promo ever gets big.
  // Odds use the same capped weights the real burn uses, so what a user sees is
  // what they actually get.
  const odds = survivalOdds(onList.map((p) => ({ userId: p.userId, bananas: Number(p.bananas) || 0 })));

  const names = await resolveNames(
    [...onList, ...off].slice(0, NAME_RESOLVE_CAP).map((p) => p.userId),
  );
  const row = (p: PlayerDoc, rank: number): LeaderRow => ({
    userId: p.userId,
    name: names[p.userId] ?? 'Player',
    bananas: Number(p.bananas) || 0,
    streak: Number(p.streak) || 0,
    onList: p.onList === true,
    rank,
    odds: odds[p.userId] ?? 0,
  });

  // ⚠️ SURVIVORS ARE THE PEOPLE WHO ACTUALLY SURVIVED THE LAST BURN — read from
  // the burn record, NOT the top N by Bananas.
  //
  // This used to slice the top 5 of the list, which is a different thing
  // entirely and actively wrong: survival is a WEIGHTED DRAW, so the biggest
  // stacks routinely get burned and small ones live. Worse, a burned player who
  // re-enters a draft rejoins the list and can out-Banana a real survivor, so
  // the board handed seats to people who had just been eliminated. It did
  // exactly that within an hour of launch — RisBrian re-entered after the 5pm
  // burn and displaced Wp34, who had actually survived it (Richard 2026-07-31).
  //
  // Everyone else on the list is a CHALLENGER: still in the pool for the next
  // burn, but not currently holding a seat.
  const lastBurnIndex = dayDoc?.lastBurnIndex ?? -1;
  let survivorIds: string[] = [];
  if (lastBurnIndex >= 0) {
    const burnSnap = await dayRef.collection(BURNS).doc(String(lastBurnIndex)).get();
    survivorIds = (burnSnap.data()?.survivors as string[] | undefined) ?? [];
  }
  const survivorSet = new Set(survivorIds);
  const byId = new Map(all.map((p) => [p.userId, p]));

  // Before the first burn nobody has survived anything, so the board falls back
  // to the list ranked by Bananas — the client labels that state differently.
  const survivors = lastBurnIndex >= 0
    ? survivorIds
      .map((uid) => byId.get(uid))
      .filter((p): p is PlayerDoc => !!p)
      .sort((a, b) => (Number(b.bananas) || 0) - (Number(a.bananas) || 0))
      .map((p, i) => row(p, i + 1))
    : onList.slice(0, SURVIVORS_PER_BURN).map((p, i) => row(p, i + 1));

  const challengers = onList.filter((p) => !survivorSet.has(p.userId));
  const contenders = (lastBurnIndex >= 0
    ? challengers.slice(0, 2)
    : onList.slice(SURVIVORS_PER_BURN, SURVIVORS_PER_BURN + 2)
  ).map((p, i) => row(p, survivors.length + i + 1));

  let you: (LeaderRow & { bananasToSeat: number }) | null = null;
  if (viewerId) {
    const vid = viewerId.toLowerCase();
    const idxOn = onList.findIndex((p) => p.userId === vid);
    const mine = idxOn >= 0 ? onList[idxOn] : off.find((p) => p.userId === vid);
    if (mine) {
      // Holding a seat means SURVIVING the last burn, not out-Bananaing the
      // list. bananasToSeat is 0 for an actual survivor; for everyone else it's
      // the gap to the smallest surviving stack — the number that says how much
      // further they need to go to be a serious threat at the next burn.
      const holdsSeat = survivorSet.has(vid);
      const smallestSurvivor = survivors.length
        ? Math.min(...survivors.map((r) => r.bananas))
        : 0;
      const mineBananas = Number(mine.bananas) || 0;
      you = {
        ...row(mine, idxOn >= 0 ? idxOn + 1 : onList.length + 1),
        bananasToSeat: holdsSeat ? 0 : Math.max(0, smallestSurvivor - mineBananas + 1),
      };
    }
  }

  const status: 'pending' | 'live' | 'closed' = dayDoc?.status === 'closed'
    ? 'closed'
    : nowMs < day.opensAt ? 'pending' : 'live';

  return {
    ...base,
    status,
    survivors,
    contenders,
    // ⚠️ SURVIVORS FIRST, then challengers by Bananas — NOT a flat Banana sort.
    // "Show all" draws the cut line at index survivorSlots, so a plain Banana
    // ordering puts whoever has the most Bananas in the survivor block even if
    // they were just burned. That's the same mistake the collapsed board had:
    // it showed RisBrian (16, burned) above Wp34 (14, survived) inside the
    // expanded list while the collapsed one was already correct
    // (Richard 2026-07-31).
    all: (lastBurnIndex >= 0
      ? [
        ...survivorIds
          .map((uid) => byId.get(uid))
          .filter((p): p is PlayerDoc => !!p)
          .sort((a, b) => (Number(b.bananas) || 0) - (Number(a.bananas) || 0)),
        ...challengers,
      ]
      : onList
    ).slice(0, NAME_RESOLVE_CAP).map((p, i) => row(p, i + 1)),
    burnIndex: dayDoc?.lastBurnIndex ?? -1,
    revealAt: dayDoc?.revealAt ?? null,
    saltHash: dayDoc?.saltHash,
    periodNumber: dayDoc?.periodNumber,
    seedDigest: dayDoc?.seedDigest,
    you,
    onListCount: onList.length,
    jackhofWinnerId: dayDoc?.jackhofWinnerId ?? null,
    winners: dayDoc?.winners,
    lastNight,
  };
}

export { BANANAS_SURVIVE_HOUR, SURVIVORS_PER_BURN };
