/**
 * Banana Draw — Firestore layer. Pure rates/cycle/winner math lives in
 * lib/bananaDrawMath.ts; this does the reads and writes.
 *
 * Collections
 *   banana_cycles/{cycleId}                 the 24h cycle + its sealed commitment + result
 *   banana_cycles/{cycleId}/entries/{uid}   per-user Bananas for that cycle (resets each cycle)
 *   v2_users/{uid}/bananaLedger/{dedupeId}  PERMANENT credit log — never resets, powers
 *                                           the all-time history and every dispute
 *
 * Bananas reset every cycle by construction: entries live UNDER the cycle, so
 * a new cycle starts empty with no sweep to run and nothing to get stuck.
 */

import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getSealedDrawSeed, type SealedDrawSeed } from '@/lib/jackpotDrawProof';
import {
  bananasForSource, cycleFor, pickWinner, shareOf, referralCountsForBananas,
  BANANAS_MAX_PER_FRIEND, type BananaSource, type DrawCycle, type DrawEntry,
} from '@/lib/bananaDrawMath';

const CYCLES = 'banana_cycles';
const ENTRIES = 'entries';
const USERS = 'v2_users';
/** Subcollection under v2_users/{uid} — see creditBananas for why it isn't a
 *  root collection (composite indexes can't ship with a code deploy). */
const LEDGER = 'bananaLedger';

export interface CycleEntry {
  userId: string;
  bananas: number;
  /** Breakdown so the modal can show where they came from. */
  free: number;
  paid: number;
  referral: number;
  freeDrafts: number;
  paidDrafts: number;
  referrals: number;
  updatedAt: string;
}

export interface CycleDoc {
  cycleId: string;
  opensAt: number;
  closesAt: number;
  status: 'open' | 'drawn' | 'void';
  /** Public commitment recorded at cycle OPEN — proves the randomness existed
   *  before entries closed. The salt itself stays secret until period reveal. */
  saltHash?: string;
  periodNumber?: number;
  totalBananas?: number;
  entrantCount?: number;
  // Result (written at draw)
  winnerId?: string | null;
  winningIndex?: number;
  drawnAt?: string;
  /** Full entry list as it stood at close, so anyone can recompute the draw. */
  snapshot?: DrawEntry[];
  seedDigest?: string;
}

const strip0x = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);

/**
 * Per-cycle draw digest: the period's sealed salt + VRF, bound to this cycle.
 * Full 32-byte digest (not a truncated uint32) so the modulo stays unbiased
 * whatever the pool size.
 */
export function cycleSeedDigest(seed: SealedDrawSeed, cycleId: string): string {
  return crypto
    .createHash('sha256')
    .update(strip0x(seed.salt) + strip0x(seed.vrfRandomness) + `banana-draw:${cycleId}`)
    .digest('hex');
}

/** Open the cycle doc if it doesn't exist yet, stamping the public commitment.
 *  Idempotent — safe to call on every credit. */
export async function ensureCycle(nowMs = Date.now()): Promise<DrawCycle> {
  const cycle = cycleFor(nowMs);
  // The draw ends with BANANA_DRAW_FINAL_CYCLE_ID — no cycles open after it.
  if (cycle.cycleId > BANANA_DRAW_FINAL_CYCLE_ID) return cycle;
  if (!isFirestoreConfigured()) return cycle;
  const ref = getAdminFirestore().collection(CYCLES).doc(cycle.cycleId);
  const snap = await ref.get();
  if (snap.exists) return cycle;

  // Stamp the commitment at OPEN. saltHash is already on-chain from the wheel
  // period's open, so recording it here ties this cycle to randomness that
  // provably predates any entry.
  const seed = await getSealedDrawSeed();
  const doc: CycleDoc = {
    cycleId: cycle.cycleId,
    opensAt: cycle.opensAt,
    closesAt: cycle.closesAt,
    status: 'open',
    ...(seed ? { saltHash: seed.saltHash, periodNumber: seed.periodNumber } : {}),
  };
  await ref.set(doc, { merge: true });
  return cycle;
}

/**
 * Credit Bananas. IDEMPOTENT on `refId` — the ledger doc id is derived from
 * (cycle, user, source, refId) and written with .create(), so the draft-fill
 * webhook and its backstop can both fire and only the first one counts.
 *
 * `refId` must identify the earning EVENT: the draftId for a draft, the
 * friend's wallet for a referral.
 */
export async function creditBananas(opts: {
  userId: string;
  source: BananaSource;
  refId: string;
  nowMs?: number;
  meta?: Record<string, unknown>;
}): Promise<{ credited: boolean; bananas: number; cycleId: string }> {
  const userId = opts.userId.toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  const cycle = await ensureCycle(nowMs);
  const amount = bananasForSource(opts.source);
  // Promo over (final cycle closed noon PT Jul 31) — later fills earn nothing.
  if (cycle.cycleId > BANANA_DRAW_FINAL_CYCLE_ID) {
    return { credited: false, bananas: 0, cycleId: cycle.cycleId };
  }
  if (!isFirestoreConfigured() || amount <= 0) {
    return { credited: false, bananas: 0, cycleId: cycle.cycleId };
  }

  const db = getAdminFirestore();
  // Dedupe key deliberately EXCLUDES the cycle, because refId already
  // identifies the event uniquely and the semantics differ by source:
  //   • draft-*    refId = draftId, globally unique → once per draft, ever
  //   • referral-* refId = friendId → ONCE EVER per friend
  // Including the cycle would have re-paid a referrer 5 Bananas every single
  // day their friend drafted, since a new cycle makes a new key.
  const dedupeId = `${userId}__${opts.source}__${opts.refId}`
    .replace(/[/\\\s]+/g, '_').slice(0, 1400);
  // Ledger lives UNDER the user, not in a root collection. A root collection
  // would need a composite (userId + at) index to read someone's history —
  // and a composite index is a separate `firebase deploy` step that can't ship
  // with the code. As a subcollection, the same read is a plain orderBy on one
  // field, which Firestore indexes automatically. Nothing to deploy.
  const ledgerRef = db.collection(USERS).doc(userId).collection(LEDGER).doc(dedupeId);
  const entryRef = db.collection(CYCLES).doc(cycle.cycleId).collection(ENTRIES).doc(userId);

  const isReferral = opts.source.startsWith('referral');
  const isPaid = opts.source === 'draft-paid';

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) throw new Error('ALREADY_CREDITED');

      // A single friend can never be worth more than 10 across the campaign.
      // Checked by reading the TWO deterministic keys directly rather than
      // querying — the dedupe ids are computable, so this needs no index and
      // no query at all. Reads the permanent ledger, not the cycle, so it
      // can't be reset by waiting for tomorrow.
      if (isReferral) {
        const friendId = opts.refId.toLowerCase();
        const others = (['referral-draft', 'referral-purchase'] as const)
          .filter((s) => s !== opts.source)
          .map((s) => db.collection(USERS).doc(userId).collection(LEDGER)
            .doc(`${userId}__${s}__${friendId}`.replace(/[/\\\s]+/g, '_').slice(0, 1400)));
        const snaps = await Promise.all(others.map((r) => tx.get(r)));
        const already = snaps.reduce((s, d) => s + (d.exists ? Number(d.data()?.bananas) || 0 : 0), 0);
        if (already + amount > BANANAS_MAX_PER_FRIEND) throw new Error('FRIEND_CAP');
      }

      tx.set(ledgerRef, {
        userId,
        cycleId: cycle.cycleId,
        source: opts.source,
        refId: opts.refId,
        ...(isReferral ? { friendId: opts.refId.toLowerCase() } : { draftId: opts.refId }),
        bananas: amount,
        at: new Date(nowMs).toISOString(),
        ...(opts.meta ?? {}),
      });

      tx.set(entryRef, {
        userId,
        bananas: FieldValue.increment(amount),
        free: FieldValue.increment(isReferral || isPaid ? 0 : amount),
        paid: FieldValue.increment(isPaid ? amount : 0),
        referral: FieldValue.increment(isReferral ? amount : 0),
        freeDrafts: FieldValue.increment(opts.source === 'draft-free' ? 1 : 0),
        paidDrafts: FieldValue.increment(isPaid ? 1 : 0),
        referrals: FieldValue.increment(isReferral ? 1 : 0),
        updatedAt: new Date(nowMs).toISOString(),
      }, { merge: true });
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'ALREADY_CREDITED' || msg === 'FRIEND_CAP') {
      return { credited: false, bananas: 0, cycleId: cycle.cycleId };
    }
    logger.error('banana.credit.failed', { userId, source: opts.source, refId: opts.refId, err: msg });
    return { credited: false, bananas: 0, cycleId: cycle.cycleId };
  }

  return { credited: true, bananas: amount, cycleId: cycle.cycleId };
}

/**
 * Credit the REFERRER when a friend they invited hits a milestone.
 *
 * Fires once ever per (referrer, friend, source) — the ledger key omits the
 * cycle, so a friend who drafts every day pays out exactly once.
 *
 * NEW players only: `referredBy` is only ever set through the /r/{code} signup
 * flow, so an existing account can't be retro-attributed. That's the same
 * anti-farm guard the referral ladder already relies on.
 *
 * NEW REFERRALS only, too. `referredBy` says nothing about WHEN the invite
 * happened, so on launch day this paid out on the whole historic referral
 * book — one referrer collected 5 Bananas for a friend he'd invited 25 days
 * earlier, and was sitting on 22 more of them. The friend must have signed up
 * after the promo went live (Richard 2026-07-26).
 */
export async function creditReferralBananas(opts: {
  friendUserId: string;
  kind: 'draft' | 'purchase';
  nowMs?: number;
}): Promise<{ credited: boolean; referrerId?: string }> {
  if (!isFirestoreConfigured()) return { credited: false };
  const friendId = opts.friendUserId.toLowerCase();
  try {
    const snap = await getAdminFirestore().collection('v2_users').doc(friendId).get();
    const friendData = snap.data() ?? {};
    const referrerId = (friendData.referredBy as string | undefined)?.toLowerCase();
    // No referrer, or a self-referral attempt — nothing to pay.
    if (!referrerId || referrerId === friendId) return { credited: false };

    // Invited BEFORE the promo existed → not a Banana referral. Silent by
    // design: the referrer was never promised anything for it.
    const createdMs = Date.parse(String(friendData.createdAt ?? ''));
    if (!referralCountsForBananas(Number.isNaN(createdMs) ? null : createdMs)) {
      return { credited: false, referrerId };
    }

    const res = await creditBananas({
      userId: referrerId,
      source: opts.kind === 'draft' ? 'referral-draft' : 'referral-purchase',
      refId: friendId,
      nowMs: opts.nowMs,
      meta: { friendId },
    });
    return { credited: res.credited, referrerId };
  } catch (err) {
    logger.warn('banana.referral_credit_failed', { friendId, kind: opts.kind, err: String(err) });
    return { credited: false };
  }
}

/** Everything the promo card + modal need for one user, in one read. */
export async function getUserCycleState(userId: string, nowMs = Date.now()): Promise<{
  cycle: DrawCycle;
  entry: CycleEntry | null;
  totalBananas: number;
  entrantCount: number;
  sharePct: number;
}> {
  const cycle = cycleFor(nowMs);
  const empty = { cycle, entry: null, totalBananas: 0, entrantCount: 0, sharePct: 0 };
  if (!isFirestoreConfigured()) return empty;

  const db = getAdminFirestore();
  const entriesRef = db.collection(CYCLES).doc(cycle.cycleId).collection(ENTRIES);
  const [mine, all] = await Promise.all([
    entriesRef.doc(userId.toLowerCase()).get(),
    entriesRef.get(),
  ]);

  let totalBananas = 0;
  all.forEach((d) => { totalBananas += Number(d.data().bananas) || 0; });
  const entry = mine.exists ? (mine.data() as CycleEntry) : null;
  return {
    cycle,
    entry,
    totalBananas,
    entrantCount: all.size,
    sharePct: shareOf(entry?.bananas ?? 0, totalBananas),
  };
}

export interface LeaderboardRow {
  userId: string;
  bananas: number;
  sharePct: number;
  /** Real display name, resolved SERVER-side. */
  name: string;
}

/**
 * Resolve wallets → the handle people actually display as.
 *
 * ⚠️ Never derive the name from the wallet hash (`bananaNumberFromWallet`).
 * That helper is display-forbidden: it's only 90k wide, it does NOT match the
 * server-assigned `bananaNumber` stored on the user doc, and it has already
 * mis-identified a user once (2026-07-04 name-twin mis-grant; again on
 * 2026-07-25 when a lookup by hash "found" nothing for Banana10546, whose
 * wallet hashes to 46904). Read the STORED field — a leaderboard full of
 * hash-invented names reads as fake data, because it is.
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
    // Skip the "User-0x…" placeholder — it's not a name anyone recognises.
    const real = raw && !/^user-0x/i.test(raw) && !/^0x[0-9a-f]{6,}/i.test(raw) ? raw : null;
    out[s.id] = real
      ?? (typeof d.bananaNumber === 'number' ? `Banana${d.bananaNumber}` : `${s.id.slice(0, 6)}…${s.id.slice(-4)}`);
  }
  return out;
}

/** Leaderboard for the current cycle, ranked by Bananas but SURFACED as share
 *  — "the leader holds 14%" reads as an invitation; "you're 47th" reads as a
 *  reason to quit. */
export async function getCycleLeaderboard(nowMs = Date.now(), limit = 25): Promise<{
  cycle: DrawCycle;
  rows: LeaderboardRow[];
  totalBananas: number;
  entrantCount: number;
}> {
  const cycle = cycleFor(nowMs);
  if (!isFirestoreConfigured()) return { cycle, rows: [], totalBananas: 0, entrantCount: 0 };

  const all = await getAdminFirestore()
    .collection(CYCLES).doc(cycle.cycleId).collection(ENTRIES).get();

  const entries: Array<{ userId: string; bananas: number }> = [];
  let totalBananas = 0;
  all.forEach((d) => {
    const b = Number(d.data().bananas) || 0;
    if (b > 0) entries.push({ userId: d.id, bananas: b });
    totalBananas += b;
  });
  entries.sort((a, b) => b.bananas - a.bananas || (a.userId < b.userId ? -1 : 1));

  const top = entries.slice(0, limit);
  const names = await resolveNames(top.map((e) => e.userId));
  return {
    cycle,
    totalBananas,
    entrantCount: entries.length,
    rows: top.map((e) => ({
      ...e,
      sharePct: shareOf(e.bananas, totalBananas),
      name: names[e.userId] ?? `${e.userId.slice(0, 6)}…${e.userId.slice(-4)}`,
    })),
  };
}

/** Permanent all-time credit history for one user (never resets). */
export async function getUserLedger(userId: string, limit = 100): Promise<Array<{
  cycleId: string; source: BananaSource; bananas: number; at: string; refId: string;
}>> {
  if (!isFirestoreConfigured()) return [];
  // Subcollection + single-field orderBy → auto-indexed, no deploy step.
  const snap = await getAdminFirestore()
    .collection(USERS).doc(userId.toLowerCase()).collection(LEDGER)
    .orderBy('at', 'desc')
    .limit(limit)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      cycleId: String(x.cycleId), source: x.source as BananaSource,
      bananas: Number(x.bananas) || 0, at: String(x.at), refId: String(x.refId ?? ''),
    };
  });
}

/**
 * Drafts the user is SEATED IN that haven't filled yet, so the card can say
 * "🍌 6 · 2 filling" instead of looking broken.
 *
 * Bananas land at FILL, which is correct — an entry can be left and refunded,
 * so crediting at entry would be farmable. But with no pending indicator the
 * user enters a draft, sees nothing move, and reports a bug.
 *
 * Delegates to the Go API's live seat state (fetchOwnerSeatedFillingCount)
 * rather than replaying activity events. That means it's exact: leaving a
 * lobby clears it at once, and a slow draft stays pending for however many
 * days it actually takes.
 */
export async function getPendingDrafts(userId: string): Promise<number> {
  try {
    const { fetchOwnerSeatedFillingCount } = await import('@/lib/api/owner');
    return await fetchOwnerSeatedFillingCount(userId);
  } catch {
    return 0; // decoration — never block the promo read
  }
}

/** Past winners, newest first — the social proof that makes the promo feel
 *  real. Worth surfacing the winner's Banana count too: the day someone wins
 *  on 2 Bananas is the best possible argument that one Banana can win. */
export async function getRecentWinners(limit = 5): Promise<Array<{
  cycleId: string; name: string; bananas: number;
}>> {
  if (!isFirestoreConfigured()) return [];
  // Cycle ids ARE dates, so the last N are computable — fetch them by id with
  // one getAll instead of a status+closesAt query. Avoids a composite index
  // (which would be a separate `firebase deploy` step, not shippable with the
  // code) and is a cheaper read besides.
  const db = getAdminFirestore();
  const today = cycleFor(Date.now());
  const refs = Array.from({ length: limit + 2 }, (_, i) => {
    const d = new Date(today.closesAt);
    d.setUTCDate(d.getUTCDate() - i);
    const id = d.toISOString().slice(0, 10);
    return db.collection(CYCLES).doc(id);
  });
  const snaps = await db.getAll(...refs).catch(() => null);
  if (!snaps) return [];
  const winners = snaps.flatMap((s) => {
    if (!s.exists) return [];
    const c = s.data() as CycleDoc;
    if (c.status !== 'drawn' || !c.winnerId) return [];
    const won = (c.snapshot ?? []).find((e) => e.userId === c.winnerId);
    return [{ cycleId: c.cycleId, userId: c.winnerId, bananas: won?.bananas ?? 0 }];
  }).slice(0, limit);
  const names = await resolveNames(winners.map((w) => w.userId));
  return winners.map((w) => ({
    cycleId: w.cycleId,
    name: names[w.userId] ?? `${w.userId.slice(0, 6)}…${w.userId.slice(-4)}`,
    bananas: w.bananas,
  }));
}

/** Entrant display names from the most recent DRAWN cycle — the cast of the
 *  draw the modal replays. The reel used to cycle the CURRENT cycle's board,
 *  which right after the noon reset is empty or a different set of people
 *  entirely: a replay of yesterday's draw performed by today's entrants.
 *  Reads the same cycle docs getRecentWinners does (7 doc gets, no index). */
export async function getLastDrawEntrantNames(limit = 60): Promise<string[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  const today = cycleFor(Date.now());
  const refs = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.closesAt);
    d.setUTCDate(d.getUTCDate() - i);
    return db.collection(CYCLES).doc(d.toISOString().slice(0, 10));
  });
  const snaps = await db.getAll(...refs).catch(() => null);
  if (!snaps) return [];
  const latest = snaps
    .filter((s) => s.exists && (s.data() as CycleDoc).status === 'drawn')
    .sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  if (!latest) return [];
  const snapshot = ((latest.data() as CycleDoc).snapshot ?? []).slice(0, limit);
  const names = await resolveNames(snapshot.map((e) => e.userId));
  return snapshot.map((e) => names[e.userId] ?? `${e.userId.slice(0, 6)}…${e.userId.slice(-4)}`);
}

/**
 * THE PROMO'S FINAL CYCLE (Boris 2026-07-30): the Banana Draw awards FIVE
 * seats total, and the cycle closing noon PT Jul 31 is the last one. After
 * its draw: no new cycles open, fills stop earning Bananas, and the card
 * retires. History (cycle docs, per-user ledgers) is kept forever.
 */
export const BANANA_DRAW_FINAL_CYCLE_ID = '2026-07-31';
export const BANANA_DRAW_TOTAL_SEATS = 5;

/** Seats framing changed 2026-07-30: count the DRAW's own winners (drawn
 *  cycles), NOT league chairs — a wheel-wedge winner (roarstone, 7/29) sits in
 *  the same league but is not a Banana Draw seat, and counting chairs made the
 *  banner claim five seats when four were drawn. */
export async function getBananaDrawSeatCount(): Promise<{ claimed: number; total: number }> {
  const total = BANANA_DRAW_TOTAL_SEATS;
  if (!isFirestoreConfigured()) return { claimed: 0, total };
  try {
    const snap = await getAdminFirestore().collection(CYCLES).get();
    let claimed = 0;
    snap.forEach((d) => {
      const c = d.data() as CycleDoc;
      if (c.status === 'drawn' && c.winnerId) claimed += 1;
    });
    return { claimed: Math.min(claimed, total), total };
  } catch {
    return { claimed: 0, total };
  }
}

/** Seats taken in the FIRST (lowest-numbered still-filling) JackHOF league —
 *  the "7 of 10 seats claimed" counter. Reads the same v2_queues doc the
 *  wheel's seating path writes, so it can never disagree with reality. */
export async function getJackhofSeatCount(): Promise<{ claimed: number; total: number }> {
  const total = 10;
  if (!isFirestoreConfigured()) return { claimed: 0, total };
  try {
    const snap = await getAdminFirestore().collection('v2_queues').doc('jackhof').get();
    const rounds = (snap.exists ? snap.data()?.rounds : null) as
      Array<{ roundId: number; status: string; members?: unknown[] }> | null;
    if (!Array.isArray(rounds) || rounds.length === 0) return { claimed: 0, total };
    const filling = rounds
      .filter((r) => r.status === 'filling')
      .sort((a, b) => a.roundId - b.roundId)[0];
    // No filling round left means league #1 already went to draft.
    if (!filling) return { claimed: total, total };
    return { claimed: Array.isArray(filling.members) ? filling.members.length : 0, total };
  } catch {
    return { claimed: 0, total };
  }
}

/**
 * Close the cycle and draw a winner. Called by the noon-PT cron.
 *
 * ⚠️ FAILS CLOSED with no sealed seed. getSealedDrawSeed() returns null when no
 * wheel period is active, and the legacy fallback other draws use is a weak,
 * predictable hash. An unprovable draw on a public leaderboard is worse than a
 * late one — so we void nothing, draw nothing, and alert instead.
 *
 * Idempotent: the cycle doc flips to 'drawn' inside the transaction, so a
 * double-fired cron can't draw twice.
 */
export async function closeCycleAndDraw(cycleId: string): Promise<{
  ok: boolean; reason?: string; winnerId?: string | null; totalBananas?: number;
}> {
  if (!isFirestoreConfigured()) return { ok: false, reason: 'firestore-unconfigured' };
  const db = getAdminFirestore();
  const cycleRef = db.collection(CYCLES).doc(cycleId);

  const cycleSnap = await cycleRef.get();
  if (!cycleSnap.exists) return { ok: false, reason: 'no-cycle' };
  if ((cycleSnap.data() as CycleDoc).status !== 'open') return { ok: false, reason: 'already-drawn' };

  const seed = await getSealedDrawSeed();
  if (!seed) {
    logger.error('banana.draw.no-sealed-seed', { cycleId });
    return { ok: false, reason: 'no-sealed-seed' };
  }

  const all = await cycleRef.collection(ENTRIES).get();
  const entries: DrawEntry[] = [];
  all.forEach((d) => {
    const b = Number(d.data().bananas) || 0;
    if (b > 0) entries.push({ userId: d.id, bananas: b });
  });
  if (entries.length === 0) {
    await cycleRef.set({ status: 'void', drawnAt: new Date().toISOString(), totalBananas: 0, entrantCount: 0 }, { merge: true });
    return { ok: true, winnerId: null, totalBananas: 0, reason: 'no-entries' };
  }

  const seedDigest = cycleSeedDigest(seed, cycleId);
  const result = pickWinner(entries, seedDigest);

  const drawn = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(cycleRef);
    if ((fresh.data() as CycleDoc).status !== 'open') return false;
    tx.set(cycleRef, {
      status: 'drawn',
      drawnAt: new Date().toISOString(),
      winnerId: result.winnerId,
      winningIndex: result.winningIndex,
      totalBananas: result.totalBananas,
      entrantCount: result.ordered.length,
      snapshot: result.ordered,   // published so anyone can recompute
      seedDigest,                 // salt stays secret until period reveal
      saltHash: seed.saltHash,
      periodNumber: seed.periodNumber,
    }, { merge: true });
    return true;
  });
  if (!drawn) return { ok: false, reason: 'already-drawn' };

  return { ok: true, winnerId: result.winnerId, totalBananas: result.totalBananas };
}
