/**
 * Rolling reset windows — shared math for the post-batch specials system.
 *
 * From draft `RollingStartDraft` (cutover, e.g. 201) onward, the fixed
 * per-100 batch is replaced by two INDEPENDENT lanes:
 *   • Jackpot: 1 slot somewhere in the next 100 drafts; the window RESETS the
 *     draft after the hit. A jackpot is always ≤100 drafts away.
 *   • HOF: 5 slots per 100-draft window; the window resets after the 5th hit.
 * Both lanes landing on the same draft = a JACKHOF (dual-type, both perks) —
 * there is deliberately NO collision handling.
 *
 * Window starts are NOT stored anywhere — they are derived by replaying the
 * hit arrays (JackpotLeagueIds / HofLeagueIds) from RollingStartDraft. That
 * keeps the Firestore tracker contract to a single new field and lets a
 * "pre-reveal" view be computed by simply excluding hits whose slot-machine
 * reveal hasn't landed yet (same reveal-gating the fixed-batch header used:
 * nothing may move before the slot lands).
 *
 * Used by the batchProgress SSE route and the bot feed. The Go API runs the
 * equivalent placement logic server-side; these replays only ever READ the
 * hit arrays Go writes, so display can never disagree with crediting.
 */

export const WINDOW_SIZE = 100;
export const HOF_PER_WINDOW = 5;

export interface LaneSnapshot {
  /** Global draft number of the FIRST draft in the lane's current window. */
  windowStart: number;
  /** Specials still to hit in this window (JP: always 1; HOF: 1–5). */
  remaining: number;
  /** Hits already landed in this window (JP: always 0; HOF: 0–4). */
  hitsInWindow: number;
}

export interface RollingLanes {
  rollingStart: number;
  /** Eventual state (all hits applied) + optional pre-reveal view while a
   *  hit's slot machine hasn't landed yet. */
  jp: LaneSnapshot & { pre?: LaneSnapshot };
  hof: LaneSnapshot & { pre?: LaneSnapshot };
}

/** Rolling mode is live once the tracker carries the cutover draft number and
 *  the last pre-cutover draft has filled (RollingStartDraft − 1). Before that,
 *  everything renders the legacy fixed-batch view. */
export function isRollingActive(rollingStart: number, filled: number): boolean {
  return rollingStart > 0 && filled >= rollingStart - 1;
}

/** Replay the jackpot lane: every hit at draft X closes its window and the
 *  next one opens at X+1. Ids below rollingStart (old fixed batches) never
 *  advance the lane. The current window is unhit by construction.
 *
 *  ⚠️ throughDraft (= FilledLeaguesCount) is REQUIRED: Go's era model writes
 *  each window's drawn positions into the id arrays UP FRONT (caught live at
 *  cutover 2026-07-20: JackpotLeagueIds already held a future id minutes
 *  after draft 200 filled). An id greater than the filled count is a
 *  SCHEDULED draw, not a hit — counting it collapses the window early AND
 *  leaks the secret position through the public odds (remaining/draftsLeft
 *  is invertible). Only ids ≤ throughDraft may advance a lane. */
export function replayJpLane(jpIds: number[], rollingStart: number, throughDraft: number): LaneSnapshot {
  let start = rollingStart;
  for (const id of [...jpIds].sort((a, b) => a - b)) {
    if (id > throughDraft) break; // scheduled, not yet filled — must stay secret
    if (id >= start) start = id + 1;
  }
  return { windowStart: start, remaining: 1, hitsInWindow: 0 };
}

/** Replay the HOF lane: hits accumulate within the window; the 5th closes it
 *  and the next window opens at that draft + 1. Same throughDraft contract as
 *  replayJpLane — ids beyond the filled count are scheduled draws, not hits. */
export function replayHofLane(hofIds: number[], rollingStart: number, throughDraft: number): LaneSnapshot {
  let start = rollingStart;
  let hits = 0;
  for (const id of [...hofIds].sort((a, b) => a - b)) {
    if (id > throughDraft) break; // scheduled, not yet filled — must stay secret
    if (id < start) continue;
    hits++;
    if (hits >= HOF_PER_WINDOW) {
      start = id + 1;
      hits = 0;
    }
  }
  return { windowStart: start, remaining: HOF_PER_WINDOW - hits, hitsInWindow: hits };
}

/** Drafts filled into a window so far — the "47" of 47/100. Ticks live at
 *  fill (numerator is unaffected by reveal gating, matching the old X/100). */
export function lanePosition(filled: number, windowStart: number): number {
  return Math.max(0, Math.min(WINDOW_SIZE, filled - windowStart + 1));
}

/** Slots left for the lane's remaining specials — the odds denominator.
 *  Computed off the REVEALED fill count so the % only moves when a slot
 *  lands, exactly like the fixed-batch header. */
export function laneDraftsLeft(revealedFilled: number, windowStart: number): number {
  return Math.max(1, windowStart + WINDOW_SIZE - 1 - revealedFilled);
}

/** Live chance-to-hit %, same formula + rendering contract as the fixed-batch
 *  header and X/Discord bot (callers render toFixed(2)). */
export function lanePct(remaining: number, draftsLeft: number): number | null {
  return remaining > 0 && draftsLeft > 0 ? (remaining / draftsLeft) * 100 : null;
}

// ── Jackpot-hit promo cycle ─────────────────────────────────────────────────
// A Jackpot landing early in its window pays a bonus. ONE definition, shared by
// the CREDIT path (awardJackpotDraw → getCurrentBatchPosition) and the DISPLAY
// path (/api/promos → the Jackpot promo modal), because they drifted once:
// display kept the legacy `(filled - 1) % 100` batch math after the rolling-lane
// cutover, so the modal read "bonus windows closed" while the JP lane had in
// fact reset and the next hit was really worth 10 spins (Boris 2026-07-25).

/** Positions 1..25 of a JP window pay this many spins. */
export const JP_TEN_SPIN_THROUGH = 25;
/** Positions 26..50 pay 5; everything after pays 1. */
export const JP_FIVE_SPIN_THROUGH = 50;

export interface JpCycleState {
  /** Global draft number that opened the window `draftNo` sits in. */
  windowStart: number;
  /** 1-indexed position of `draftNo` within that window (1..WINDOW_SIZE). */
  position: number;
  /** Window length — always WINDOW_SIZE; exposed so UI never hardcodes 100. */
  windowLength: number;
  /** Spins a Jackpot landing on `draftNo` pays: 10 / 5 / 1. */
  reward: number;
  /** Drafts still in the 10-spin band, counting `draftNo` itself. 0 once past. */
  tenLeft: number;
  /** Drafts still in the 5-spin band, counting `draftNo` itself. */
  fiveLeft: number;
  /** True when the rolling-lane era drove this (vs. legacy fixed batches). */
  rolling: boolean;
}

/**
 * Spins paid for a Jackpot at a given 1-indexed window position.
 * Past position 50 the bonus draw is skipped entirely — no winner, no credit,
 * no bells, no receipt (Boris 2026-06-30). The jackpot draft itself still
 * works; only the bonus spins are gated to the first 50 of the window.
 */
export function jpRewardForPosition(position: number): number {
  if (position >= 1 && position <= JP_TEN_SPIN_THROUGH) return 10;
  if (position <= JP_FIVE_SPIN_THROUGH) return 5;
  return 0;
}

/**
 * Where `draftNo` sits in the Jackpot lane's window, and what a Jackpot there
 * would pay.
 *
 * `filled` is the tracker's FilledLeaguesCount and bounds which ids may count:
 * Go writes each window's drawn position into JackpotLeagueIds UP FRONT, so an
 * id above `filled` is a SCHEDULED draw, not a hit — honoring it would both
 * close the window early and leak the secret position (see replayJpLane).
 *
 * Hits at or after `draftNo` are excluded too, so asking about the draft that
 * just filled returns the window it landed IN (crediting), while asking about
 * `filled + 1` returns the window the NEXT draft opens into (display). That
 * one-draft difference is the whole reason both callers must share this.
 */
export function computeJpCycle(
  jpIds: number[],
  rollingStart: number,
  filled: number,
  draftNo: number,
): JpCycleState {
  const target = Math.max(1, Math.floor(draftNo));
  let windowStart: number;
  let rolling = false;

  if (rollingStart > 0 && target >= rollingStart) {
    rolling = true;
    const prior = (Array.isArray(jpIds) ? jpIds : [])
      .map(Number)
      .filter((id) => Number.isFinite(id) && id >= rollingStart && id < target && id <= filled);
    windowStart = replayJpLane(prior, rollingStart, filled).windowStart;
  } else {
    // Legacy fixed-batch era: windows are the aligned blocks of 100.
    windowStart = target - ((target - 1) % WINDOW_SIZE);
  }

  const position = Math.max(1, Math.min(WINDOW_SIZE, target - windowStart + 1));
  return {
    windowStart,
    position,
    windowLength: WINDOW_SIZE,
    reward: jpRewardForPosition(position),
    tenLeft: Math.max(0, JP_TEN_SPIN_THROUGH - position + 1),
    fiveLeft: Math.max(0, JP_FIVE_SPIN_THROUGH - position + 1),
    rolling,
  };
}
