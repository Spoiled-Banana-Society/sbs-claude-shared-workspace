import { describe, it, expect } from 'vitest';
import { replayJpLane, replayHofLane, laneDraftsLeft, lanePct } from '@/lib/rollingLanes';

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
