import { describe, it, expect } from 'vitest';
import { replayJpLane, replayHofLane, laneDraftsLeft, lanePct, computeJpCycle } from '@/lib/rollingLanes';

// Go's era model PRE-WRITES each window's drawn positions into the tracker id
// arrays (live values minutes after the 2026-07-20 cutover: JP [255], HOF
// [205, 216, 266, 279, 297] with only draft 201 filled). These are the exact
// regression tests for that incident: scheduled-but-unfilled ids must never
// advance a lane or move the public odds — the odds formula is invertible, so
// counting them leaks the secret positions.
describe('rolling lanes vs pre-written schedules', () => {
  const START = 201;

  it('JP lane ignores a scheduled future hit (cutover live data)', () => {
    const lane = replayJpLane([148, 255], START, 201); // 148 = legacy batch era
    expect(lane.windowStart).toBe(201);
    expect(lane.remaining).toBe(1);
    // filled=201, no hit yet → 1/99 ≈ 1.01%, NOT 1/154 = 0.65%
    expect(lanePct(lane.remaining, laneDraftsLeft(201, lane.windowStart))!).toBeCloseTo(1.0101, 3);
  });

  it('HOF lane ignores scheduled future hits (cutover live data)', () => {
    const lane = replayHofLane([205, 216, 266, 279, 297], START, 201);
    expect(lane.windowStart).toBe(201);
    expect(lane.remaining).toBe(5);
    expect(lane.hitsInWindow).toBe(0);
    expect(lanePct(5, laneDraftsLeft(201, 201))!).toBeCloseTo(5.0505, 3);
  });

  it('a scheduled id starts counting the moment that draft fills', () => {
    // draft 205 (a scheduled HOF) has now filled
    const lane = replayHofLane([205, 216, 266, 279, 297], START, 205);
    expect(lane.hitsInWindow).toBe(1);
    expect(lane.remaining).toBe(4);
    expect(lane.windowStart).toBe(201);
  });

  it('JP window resets when its scheduled draft fills', () => {
    const lane = replayJpLane([255], START, 255);
    expect(lane.windowStart).toBe(256);
    expect(lane.remaining).toBe(1);
  });

  it('completed HOF window rolls and the next schedule stays secret', () => {
    // all 5 window-1 HOFs filled; window 2's draws are pre-written but unfilled
    const ids = [205, 216, 266, 279, 297, 301, 344];
    const lane = replayHofLane(ids, START, 298);
    expect(lane.windowStart).toBe(298);
    expect(lane.remaining).toBe(5);
    expect(lane.hitsInWindow).toBe(0);
  });

  it('duplicate id (schedule + hit-append) counts once', () => {
    const lane = replayJpLane([255, 255], START, 255);
    expect(lane.windowStart).toBe(256);
  });
});

// ── Jackpot-hit promo cycle ─────────────────────────────────────────────────
// The bug (Boris 2026-07-25): /api/promos computed the promo card's position
// as `(filled - 1) % 100` — the LEGACY fixed-batch math — while crediting used
// the rolling window. Once the global count drifted past its mod-50 mark the
// card said "bonus windows closed" even though the JP lane had just reset and
// the next hit really did pay 10 spins.
describe('computeJpCycle', () => {
  const START = 201;

  it('a fresh window after a hit pays 10 spins, whatever the global count is', () => {
    // JP hit at 255 → window reopens at 256. Global count 300 would have given
    // the legacy math position 100 ("windows closed"); the real position is 45.
    const c = computeJpCycle([255], START, 300, 301);
    expect(c.windowStart).toBe(256);
    expect(c.position).toBe(46);
    expect(c.reward).toBe(5);
    expect(c.rolling).toBe(true);
  });

  it('the very next draft after a hit is position 1 → 10 spins', () => {
    const c = computeJpCycle([255], START, 255, 256);
    expect(c.position).toBe(1);
    expect(c.reward).toBe(10);
    expect(c.tenLeft).toBe(25);
    expect(c.fiveLeft).toBe(50);
  });

  it('crediting asks about the draft that just filled — its own hit is excluded', () => {
    // Draft 255 IS the jackpot. It must resolve to the window it landed in
    // (opened at 201), not to the window its own hit opens.
    const c = computeJpCycle([255], START, 255, 255);
    expect(c.windowStart).toBe(START);
    expect(c.position).toBe(55);
    expect(c.reward).toBe(0); // past 50 → no draw at all
  });

  it('a LATE draw still credits the draft at its own position (BBB #349 incident, 2026-07-29)', () => {
    // BBB #349 was a SLOW draft: its draw fired at reveal, after draft 350 had
    // filled and 349's own hit was already in JackpotLeagueIds. Crediting must
    // ask about draft 349 itself — window opened at 256 (hit at 255), so the
    // true position is 94 → no spin draw. Asking about the live filled count
    // (350) counts 349's own hit as prior, "resets" the window, and pays
    // position 1 → 10 spins. That wrong call is what awardJackpotDraw used to
    // make via the readJpCycle default.
    const right = computeJpCycle([255, 349, 434], 201, 350, 349);
    expect(right.windowStart).toBe(256);
    expect(right.position).toBe(94);
    expect(right.reward).toBe(0);
    const wrong = computeJpCycle([255, 349, 434], 201, 350, 350);
    expect(wrong.position).toBe(1); // documents the failure mode, not desired behavior
  });

  it('scheduled-but-unfilled ids never open a window early', () => {
    // 255 is pre-written by Go but only 210 has filled.
    const c = computeJpCycle([255], START, 210, 211);
    expect(c.windowStart).toBe(START);
    expect(c.position).toBe(11);
    expect(c.reward).toBe(10);
  });

  it('tier boundaries are inclusive: 25 → 10 spins, 26 → 5, 50 → 5, 51 → 0', () => {
    const at = (pos: number) => computeJpCycle([], START, 400, START + pos - 1).reward;
    expect(at(25)).toBe(10);
    expect(at(26)).toBe(5);
    expect(at(50)).toBe(5);
    expect(at(51)).toBe(0);
  });

  it('tenLeft/fiveLeft count the current draft in, and never go negative', () => {
    const c = computeJpCycle([], START, 400, START + 24); // position 25
    expect(c.tenLeft).toBe(1);
    expect(c.fiveLeft).toBe(26);
    const past = computeJpCycle([], START, 400, START + 60); // position 61
    expect(past.tenLeft).toBe(0);
    expect(past.fiveLeft).toBe(0);
  });

  it('pre-cutover drafts still use aligned fixed batches', () => {
    const c = computeJpCycle([], START, 150, 150);
    expect(c.rolling).toBe(false);
    expect(c.windowStart).toBe(101);
    expect(c.position).toBe(50);
    expect(c.reward).toBe(5);
  });
});
