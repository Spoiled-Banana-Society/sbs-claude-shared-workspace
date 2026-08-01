/**
 * Pure math for THE ELIMINATOR — the hourly burn-down promo that succeeds the
 * Banana Draw (whose final cycle closed noon PT 2026-07-31).
 *
 * The game: enter a draft and you're on the LIST. Every hour on the hour the
 * list burns down to 5 survivors — everyone else is wiped. You keep the Bananas
 * you earned; you only lose your spot, and re-entering the list costs another
 * draft entry. At 9pm PT the burning stops and the 5 standing win: one takes a
 * JackHOF seat (drawn at random from the five), the other four take 2 spins.
 *
 * Side-effect free so the burn selection — the part that decides real prizes —
 * is unit-testable without Firestore. lib/eliminator.ts does the I/O and imports
 * these. Same split as lib/bananaDrawMath.ts, which this replaces.
 */

import crypto from 'node:crypto';

// ── Earning rates (Richard 2026-07-31) ──────────────────────────────────────
// Deliberately the SAME per-draft rates the Banana Draw used (free 1, paid 2),
// so a user who played the old promo carries no relearning cost.
//
// ⚠️ BUYING A PASS EARNS NOTHING. Bananas come only from ENTERING drafts.
// This is the rule that makes the promo work: with a purchase reward, someone
// could buy 30 passes at 8:45pm and instantly match a player who had survived
// six hours. Entering 30 drafts takes hours of real attention, so time cannot
// be bought (Richard 2026-07-31). Passes stay the upstream driver — you need
// them to enter paid drafts — they just don't convert to standing directly.
// Imported for local use AND re-exported, so existing server-side callers can
// keep importing every rate from eliminatorMath without caring about the split.
import {
  BANANAS_FREE_DRAFT, BANANAS_PAID_DRAFT, BANANAS_SURVIVE_HOUR,
  SURVIVORS_PER_BURN, SPINS_PER_RUNNER_UP,
  OPEN_HOUR_PT, FINAL_BURN_HOUR_PT, SHORT_DAY_OPEN_HOUR_PT,
} from '@/lib/eliminatorRates';

export {
  BANANAS_FREE_DRAFT, BANANAS_PAID_DRAFT, BANANAS_SURVIVE_HOUR,
  SURVIVORS_PER_BURN, SPINS_PER_RUNNER_UP,
  OPEN_HOUR_PT, FINAL_BURN_HOUR_PT, SHORT_DAY_OPEN_HOUR_PT,
};



/**
 * Hard ceiling on any single player's chance of surviving one burn.
 *
 * ⚠️ Do not remove this. It is the backstop against a stack growing large enough
 * to be mathematically unremovable — with only ~30 people on the list, a frozen
 * board is visible to everyone and they stop playing.
 *
 * Measured against a simulated 12-burn day on the real population shape
 * (20 casuals at 2 Bananas, 7 regulars at 8, 3 grinders at 30–35):
 *   • a runaway stack tops out at 82% survival per burn
 *   • ~2.7 of the 5 seats change hands each hour, average tenure ~1.7 hours
 *
 * Note the churn is NOT driven by this constant — sweeping it from 0.6 to 0.9
 * barely moves the flip rate, because no realistic stack ever reaches the cap.
 * Hour-to-hour rotation is just the natural behaviour of a weighted draw at
 * these stack sizes, and it's desirable: the board stays alive all day.
 *
 * Stickiness comes from ACCUMULATION instead, which is why Bananas are kept
 * through a burn. Survivors bank +10 an hour, so by the 9pm burn — the only one
 * that pays — a day-long player sits around 125 Bananas and survives at ~60%,
 * against ~1% for someone who joined at 8:55pm. Roughly 45× the chance. That is
 * what stops an end-of-day pile-in, not per-hour tenure.
 *
 * Users never see this number — it just means everyone is killable, always.
 */
export const MAX_SURVIVAL_PROB = 0.8;

export type EliminatorSource = 'draft-free' | 'draft-paid' | 'survive';

export function bananasForSource(source: EliminatorSource): number {
  switch (source) {
    case 'draft-free': return BANANAS_FREE_DRAFT;
    case 'draft-paid': return BANANAS_PAID_DRAFT;
    case 'survive': return BANANAS_SURVIVE_HOUR;
  }
}

export function bananasForDraft(passType: 'free' | 'paid'): number {
  return passType === 'paid' ? BANANAS_PAID_DRAFT : BANANAS_FREE_DRAFT;
}

// ── Day boundaries ──────────────────────────────────────────────────────────
// The list OPENS at 9am PT and the FINAL burn lands at 9pm PT. Burns fire at
// the top of every hour in between, so a full day is 12 burns (10am … 9pm).
//
// Overnight is deliberately dead: between midnight and 5am PT there are 2–3
// users on the whole site per hour, so burning a 3-person list would hand a
// full survival streak to whoever happened to be awake, for free, having
// drafted nothing. Bananas earned overnight still count — they bank into the
// 9am open (Richard 2026-07-31).



export interface EliminatorDay {
  /** PT calendar date the day runs on, e.g. "2026-08-01". Doc id. */
  dayId: string;
  /** List opens (ms). No burn fires at this instant — it's the join window. */
  opensAt: number;
  /** Final burn (ms). Whoever is standing after this one wins. */
  closesAt: number;
  /** Every burn instant in order, last entry === closesAt. */
  burnAts: number[];
  openHourPt: number;
}

/** UTC instant when LA wall-clock hits `hour` on the given y/m/d.
 *  LA is UTC-7 (PDT) or UTC-8 (PST) — try both and keep the one that
 *  round-trips, so the promo survives the November DST change.
 *  Same technique as lib/sbsDay.ts and lib/bananaDrawMath.ts. */
export function ptHourUtc(y: number, m: number, d: number, hour: number): number {
  for (const offset of [7, 8]) {
    const candidate = Date.UTC(y, m - 1, d, hour + offset, 0, 0);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false, day: '2-digit',
    }).formatToParts(new Date(candidate))
      .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    if (Number(parts.hour) === hour && Number(parts.day) === d) return candidate;
  }
  return Date.UTC(y, m - 1, d, hour + 7, 0, 0); // unreachable fallback: PDT
}

/** PT calendar parts for an instant. */
function ptParts(nowMs: number): { y: number; m: number; d: number; hour: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(nowMs))
    .reduce<Record<string, string>>((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) };
}

/**
 * The day a credit earned at `nowMs` belongs to.
 *
 * ⚠️ Rolls to TOMORROW once the final burn hour has passed. Richard's rule:
 * "after 9pm PT everything you do counts toward the first burn at 10am." Using
 * the bare PT calendar date instead would drop every post-9pm entry into a day
 * whose final burn had already fired — the Bananas would be written to a closed
 * day and silently never count. Same before/after-the-draw shape as
 * lib/bananaDrawMath.cycleFor.
 */
export function dayIdFor(nowMs: number): string {
  const { y, m, d, hour } = ptParts(nowMs);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (hour >= FINAL_BURN_HOUR_PT) date.setUTCDate(date.getUTCDate() + 1);
  const cy = date.getUTCFullYear();
  const cm = date.getUTCMonth() + 1;
  const cd = date.getUTCDate();
  return `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`;
}

/**
 * The PT date before `dayId`.
 *
 * ⚠️ Load-bearing. dayIdFor rolls forward at 9pm sharp — the exact instant the
 * FINAL burn is due — so from 21:00:00 onward "today" is already tomorrow and a
 * runner that only looks at dayFor(now) never fires the burn that closes the
 * day, locks the five, and awards the seat (2026-07-31: burns 0-3 ran, burn 4
 * never did, day stuck 'open', no winner). Every runner must sweep this day too.
 */
export function prevDayId(dayId: string): string {
  const [y, m, d] = dayId.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Build the day descriptor for a given PT date. */
export function dayFromId(dayId: string): EliminatorDay {
  const [y, m, d] = dayId.split('-').map(Number);
  const openHourPt = SHORT_DAY_OPEN_HOUR_PT[dayId] ?? OPEN_HOUR_PT;
  const opensAt = ptHourUtc(y, m, d, openHourPt);
  const closesAt = ptHourUtc(y, m, d, FINAL_BURN_HOUR_PT);
  const burnAts: number[] = [];
  for (let h = openHourPt + 1; h <= FINAL_BURN_HOUR_PT; h += 1) {
    burnAts.push(ptHourUtc(y, m, d, h));
  }
  return { dayId, opensAt, closesAt, burnAts, openHourPt };
}

/** The day `nowMs` falls inside — the one currently accepting entries. */
export function dayFor(nowMs: number): EliminatorDay {
  return dayFromId(dayIdFor(nowMs));
}

/** True while the list is live and burns are firing. */
export function isDayLive(day: EliminatorDay, nowMs: number): boolean {
  return nowMs >= day.opensAt && nowMs <= day.closesAt;
}

/** Burns whose instant has passed and which therefore still owe an execution.
 *  Returned oldest-first so a cron that missed ticks catches up in order. */
export function dueBurns(day: EliminatorDay, nowMs: number, lastBurnIndex: number): number[] {
  const out: number[] = [];
  day.burnAts.forEach((at, i) => {
    if (i > lastBurnIndex && at <= nowMs) out.push(i);
  });
  return out;
}

/** Milliseconds until the next burn, or null once the day is done. */
export function msToNextBurn(day: EliminatorDay, nowMs: number): number | null {
  const next = day.burnAts.find((at) => at > nowMs);
  return next === undefined ? null : next - nowMs;
}

// ── The burn ────────────────────────────────────────────────────────────────

export interface ListPlayer {
  userId: string;
  bananas: number;
}

export interface BurnResult {
  survivors: string[];
  burned: string[];
  /** Capped weights actually used, so the burn is reproducible from the
   *  published snapshot alone. */
  weights: Array<{ userId: string; weight: number }>;
  totalWeight: number;
}

/**
 * The share of total weight a player must be held under so that their chance of
 * surviving one burn stays at or below `maxProb`.
 *
 * ⚠️ The obvious formula — share = maxProb / slots — is WRONG, and was the first
 * version of this code. It assumes inclusion probability ≈ slots × share, which
 * only holds while share is tiny. Because the burn draws WITHOUT replacement, a
 * player of share s survives with probability ≈ 1 − (1 − s)^slots, so the naive
 * cap over-restricts badly: maxProb 0.8 with 5 slots capped share at 0.16 and
 * produced a measured survival ceiling of 60%, not 80%. Inverting the real
 * relationship gives s = 1 − (1 − P)^(1/slots), which measures at 82% against
 * 4k simulated burns — close enough that the constant now means what it says.
 */
export function shareCapFor(maxProb: number, slots: number): number {
  return 1 - Math.pow(1 - maxProb, 1 / slots);
}

/**
 * Cap weights so no player's chance of surviving one burn exceeds `maxProb`.
 *
 * Capping lowers the total, which lowers the cap, so this iterates to a fixed
 * point (the total shrinks monotonically and is bounded below, so it converges —
 * in practice in 2–3 passes).
 *
 * On a realistic list this does NOTHING: with ~30 players and stacks from 2 to
 * ~125, the biggest share reached is around 0.21 against a cap of 0.275. It is
 * purely a backstop against the runaway case, which is exactly what it's for.
 *
 * Returns weights in the SAME order as the input.
 */
export function capWeights(weights: number[], slots: number, maxProb: number): number[] {
  if (weights.length === 0) return [];
  const share = shareCapFor(maxProb, slots);
  let capped = weights.slice();
  for (let pass = 0; pass < 40; pass += 1) {
    const total = capped.reduce((s, w) => s + w, 0);
    if (total <= 0) return capped;
    const cap = share * total;
    // Nobody over the line → fixed point reached.
    if (capped.every((w) => w <= cap + 1e-9)) return capped;
    capped = capped.map((w) => Math.min(w, cap));
  }
  return capped;
}

/** Deterministic sub-seed for the k-th pick of a burn. Full 32-byte digest so
 *  the modulo stays unbiased whatever the pool size. */
function subSeed(seedHex: string, dayId: string, burnIndex: number, k: number): bigint {
  const h = crypto.createHash('sha256')
    .update(`${seedHex.replace(/^0x/, '')}:eliminator:${dayId}:${burnIndex}:${k}`)
    .digest('hex');
  return BigInt(`0x${h}`);
}

/**
 * Pick the survivors of one burn.
 *
 * Weighted selection WITHOUT replacement: each pick lays every remaining player
 * out over a contiguous run of their (capped) weight, the sub-seed lands on one
 * point, and whoever's run contains it survives and is removed from the pool.
 *
 * ⚠️ The seed must be committed BEFORE the burn — see lib/jackpotDrawProof.ts.
 * If it were derived at burn time from anything observable, someone holding
 * several wallets could compute whether a last-second draft entry saved them
 * and enter only if it did. Sealing first makes that calculation impossible.
 *
 * Players are sorted by userId first so the layout is reproducible by any
 * auditor from the published snapshot, independent of Firestore read order.
 *
 * Fewer players than seats → everybody survives (and nobody is burned), which
 * is what should happen on a thin list rather than inventing losers.
 */
export function pickSurvivors(
  players: ListPlayer[],
  seedHex: string,
  dayId: string,
  burnIndex: number,
  slots = SURVIVORS_PER_BURN,
  maxProb = MAX_SURVIVAL_PROB,
): BurnResult {
  const ordered = players
    .filter((p) => Number.isFinite(p.bananas) && p.bananas > 0)
    .map((p) => ({ userId: p.userId, bananas: Math.floor(p.bananas) }))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  if (ordered.length <= slots) {
    return {
      survivors: ordered.map((p) => p.userId),
      burned: [],
      weights: ordered.map((p) => ({ userId: p.userId, weight: p.bananas })),
      totalWeight: ordered.reduce((s, p) => s + p.bananas, 0),
    };
  }

  const capped = capWeights(ordered.map((p) => p.bananas), slots, maxProb);
  const weights = ordered.map((p, i) => ({ userId: p.userId, weight: capped[i] }));
  const totalWeight = capped.reduce((s, w) => s + w, 0);

  // Integer lattice keeps the modulo exact — scale the capped (fractional)
  // weights up and round, rather than doing float comparisons against a BigInt.
  const SCALE = 1_000_000;
  const pool = weights.map((w) => ({ userId: w.userId, w: Math.max(1, Math.round(w.weight * SCALE)) }));

  const survivors: string[] = [];
  for (let k = 0; k < slots && pool.length > 0; k += 1) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    const hit = Number(subSeed(seedHex, dayId, burnIndex, k) % BigInt(total));
    let cursor = 0;
    let idx = pool.length - 1; // unreachable fallback: hit < total by construction
    for (let i = 0; i < pool.length; i += 1) {
      if (hit < cursor + pool[i].w) { idx = i; break; }
      cursor += pool[i].w;
    }
    survivors.push(pool[idx].userId);
    pool.splice(idx, 1);
  }

  const survivorSet = new Set(survivors);
  return {
    survivors,
    burned: ordered.map((p) => p.userId).filter((u) => !survivorSet.has(u)),
    weights,
    totalWeight,
  };
}

/**
 * Pick which of the final survivors takes the JackHOF seat. The rest take spins.
 *
 * WEIGHTED BY BANANAS (Richard 2026-07-31 — changed from a flat 1-in-5). Each
 * finalist occupies a contiguous run of Banana indices and the sealed seed lands
 * on one, so finishing the day on 120 Bananas is worth twice the shot of
 * finishing on 60. Surviving all day now pays twice over: it gets you INTO the
 * final five, and then it decides how much of that final five is yours.
 *
 * Every finalist keeps a real chance — a small stack is a smaller slice, never a
 * zero one — so someone who scraped in late can still take it.
 *
 * Sorted by userId first so the layout is reproducible by any auditor from the
 * published snapshot alone, independent of Firestore read order. Same shape as
 * pickSurvivors and lib/bananaDrawMath.pickWinner.
 */
export function pickJackhofWinner(
  finalists: ListPlayer[],
  seedHex: string,
  dayId: string,
): { winnerId: string | null; totalBananas: number; odds: Array<{ userId: string; bananas: number; pct: number }> } {
  const ordered = finalists
    .filter((p) => Number.isFinite(p.bananas) && p.bananas > 0)
    .map((p) => ({ userId: p.userId, bananas: Math.floor(p.bananas) }))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  const totalBananas = ordered.reduce((s, e) => s + e.bananas, 0);
  const odds = ordered.map((e) => ({
    userId: e.userId,
    bananas: e.bananas,
    pct: totalBananas > 0 ? (e.bananas / totalBananas) * 100 : 0,
  }));
  if (totalBananas <= 0) return { winnerId: null, totalBananas: 0, odds };

  const hit = Number(subSeed(seedHex, dayId, -1, 0) % BigInt(totalBananas));
  let cursor = 0;
  for (const e of ordered) {
    if (hit < cursor + e.bananas) return { winnerId: e.userId, totalBananas, odds };
    cursor += e.bananas;
  }
  // Unreachable — hit < totalBananas by construction.
  return { winnerId: ordered[ordered.length - 1].userId, totalBananas, odds };
}


/**
 * A player's chance of surviving the NEXT burn, as a percentage.
 *
 * The burn draws `slots` survivors without replacement, so a player holding
 * share s of the (capped) weight survives with probability ~ 1 - (1-s)^slots.
 * Validated against the simulator: a stack pinned at the ceiling share of
 * 0.2752 predicts 79.95% and measures 80.8% over 4k burns.
 *
 * Uses the SAME capWeights the real burn uses, so the number shown to a user is
 * the number they actually get — displaying raw shares would overstate a big
 * stack and quietly break the promise that nobody is ever safe.
 */
export function survivalOdds(
  players: ListPlayer[],
  slots = SURVIVORS_PER_BURN,
  maxProb = MAX_SURVIVAL_PROB,
): Record<string, number> {
  const live = players.filter((p) => Number.isFinite(p.bananas) && p.bananas > 0);
  const out: Record<string, number> = {};
  if (live.length === 0) return out;
  // Fewer players than seats → everyone survives.
  if (live.length <= slots) {
    live.forEach((p) => { out[p.userId] = 100; });
    return out;
  }
  const capped = capWeights(live.map((p) => p.bananas), slots, maxProb);
  const total = capped.reduce((a, w) => a + w, 0);
  if (total <= 0) return out;
  live.forEach((p, i) => {
    const share = capped[i] / total;
    out[p.userId] = Math.min(100, (1 - Math.pow(1 - share, slots)) * 100);
  });
  return out;
}

/** Share of the list's Bananas, for the leaderboard's "you need N more" line. */
export function bananasToReachSeat(mine: number, survivorCutoffBananas: number): number {
  return Math.max(0, survivorCutoffBananas - mine + 1);
}
