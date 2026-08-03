/**
 * Pure math for THE DROP — packs earned all day, opened at 8pm.
 *
 * Fill a draft, earn sealed packs. At 8:00pm PT the night LOCKS: every pack
 * earned that day goes into one pool, and the night's prizes are assigned
 * across them by a pre-committed seed. Opening a pack after that is pure
 * reveal — the contents were already decided, and anyone can verify it.
 *
 * Why guaranteed prizes rather than per-pack odds (Richard 2026-08-02): a flat
 * 0.1% is the same number the wheel wedge already pays, so it gave nobody a
 * reason to draft. A guaranteed nightly seat makes the odds `1 / packs opened`
 * — around 1 in 180 on current volume — which is ~44x the wedge and makes
 * "more packs" directly, visibly better.
 *
 * Side-effect free so prize assignment is unit-testable without Firestore.
 * lib/drop.ts does the I/O. Same split as lib/eliminatorMath.ts before it.
 */

import crypto from 'node:crypto';

// Rates and schedule live in lib/dropRates — a client-safe module with no
// Node built-ins. This file imports crypto, so anything a 'use client'
// component needs must NOT come from here (see the header note).
import {
  PACKS_PAID_FILL, PACKS_FREE_FILL, packsForFill,
  DROP_HOUR_PT, AUTO_OPEN_HOUR_PT, ptHourUtc,
  msUntilOpen, formatOpenCountdown,
  nightIdFor, nightFromId, nightFor, revealNightIdFor, NIGHTLY_PRIZES,
  nightlyPrizesFor,
  type DropNight,
} from '@/lib/dropRates';

export {
  PACKS_PAID_FILL, PACKS_FREE_FILL, packsForFill,
  DROP_HOUR_PT, AUTO_OPEN_HOUR_PT, ptHourUtc,
  msUntilOpen, formatOpenCountdown,
  nightIdFor, nightFromId, nightFor, revealNightIdFor,
};
export type { DropNight };

// ── The nightly pool ────────────────────────────────────────────────────────

export type PrizeKind = 'jackpot' | 'jackhof' | 'hof' | 'spins' | 'none';

export interface Prize {
  kind: PrizeKind;
  /** Spins awarded, when kind === 'spins'. */
  spins?: number;
}

/**
 * What goes out every night, guaranteed (Richard 2026-08-02).
 *
 * A spin is worth ~1.19 draft passes against the live wedge table, so the
 * nightly cost is ~18 passes — bounded, knowable, nothing that compounds.
 *
 * ⚠️ No free-draft prizes, deliberately. A free draft earns a pack, and a pack
 * containing a free draft makes the loop self-sustaining — it came out at
 * almost exactly break-even when we ran the numbers.
 */
// Built from lib/dropRates.NIGHTLY_PRIZES so the list users are shown and the
// list actually assigned are the same data — they cannot drift.
export const NIGHTLY_POOL: Prize[] = NIGHTLY_PRIZES.flatMap((p) =>
  Array.from({ length: p.count }, () => (
    p.kind === 'spins' ? { kind: 'spins' as const, spins: p.spins } : { kind: p.kind }
  )),
);

export const TOTAL_SPINS_PER_NIGHT = NIGHTLY_POOL.reduce((s, p) => s + (p.spins ?? 0), 0);

/** The pool a specific night assigns — honors one-night overrides. */
export function poolForNight(nightId: string): Prize[] {
  return nightlyPrizesFor(nightId).flatMap((p) =>
    Array.from({ length: p.count }, () => (
      p.kind === 'spins' ? { kind: 'spins' as const, spins: p.spins } : { kind: p.kind }
    )),
  );
}

export function totalSpinsForNight(nightId: string): number {
  return poolForNight(nightId).reduce((s, p) => s + (p.spins ?? 0), 0);
}

// ── Prize assignment ────────────────────────────────────────────────────────

export interface PackRef {
  /** Globally unique id for this pack — the nonce the draw is bound to. */
  packId: string;
  userId: string;
}

export interface Assignment {
  packId: string;
  userId: string;
  prize: Prize;
}

/**
 * Assign the night's pool across every sealed pack, once, at lock time.
 *
 * Deterministic shuffle from the sealed seed: each pack gets a sort key derived
 * from (seed, packId), the packs are ordered by it, and the pool is handed to
 * the front of that order. Publishing the seed lets anyone recompute the entire
 * night — which pack won the seat, and that it was decided before a single pack
 * was opened.
 *
 * ⚠️ The seed MUST be committed before 8pm. If it were derived at lock time
 * from anything observable, whoever controlled that input could decide who wins
 * the seat. Same stance as lib/jackpotDrawProof.ts and the burns before it.
 *
 * Packs are sorted by packId first so the shuffle is reproducible from the
 * published snapshot alone, independent of Firestore read order.
 */
export function assignPrizes(packs: PackRef[], seedHex: string, nightId: string): Assignment[] {
  const seed = seedHex.replace(/^0x/, '');
  const ordered = [...packs]
    .sort((a, b) => (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0))
    .map((p) => ({
      ...p,
      key: crypto.createHash('sha256').update(`${seed}:drop:${nightId}:${p.packId}`).digest('hex'),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const pool = poolForNight(nightId);
  return ordered.map((p, i) => ({
    packId: p.packId,
    userId: p.userId,
    prize: pool[i] ?? { kind: 'none' as const },
  }));
}

/** Recompute one pack's prize from the published seed — the whole verification
 *  path in a single call. */
export function verifyAssignment(
  packs: PackRef[], seedHex: string, nightId: string, packId: string,
): Prize | null {
  return assignPrizes(packs, seedHex, nightId).find((a) => a.packId === packId)?.prize ?? null;
}

/** Odds of a given pack holding the seat tonight. Shown to users BEFORE the
 *  drop as "1 in N" — it's the number that makes drafting one more worth it. */
export function seatOddsPerPack(totalPacks: number): number {
  return totalPacks > 0 ? 1 / totalPacks : 0;
}
