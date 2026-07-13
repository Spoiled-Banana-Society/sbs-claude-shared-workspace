import { describe, it, expect } from 'vitest';
import {
  isSlowDraftPickLength,
  isSlowDraftNightPause,
  slowDraftPickEndUnix,
  slowDraftEffectiveElapsedSeconds,
  slowDraftActiveSecondsUntil,
  slowDraftDisplayedSecondsRemaining,
} from '@/utils/slowDraftClock';

// Helper: unix seconds for a UTC wall-clock instant.
const utc = (y: number, mon1: number, d: number, h: number, m: number, s = 0) =>
  Math.floor(Date.UTC(y, mon1 - 1, d, h, m, s) / 1000);

// Slow-draft clock runs on America/Los_Angeles. Active 05:00–22:00 PT, paused 22:00–05:00 PT.
// Summer (PDT, UTC-7): PT = UTC - 7  →  10:00 PDT = 17:00 UTC
const ptPDT = (y: number, mon1: number, d: number, h: number, m: number, s = 0) =>
  utc(y, mon1, d, h + 7, m, s);

// Winter (PST, UTC-8): PT = UTC - 8
const ptPST = (y: number, mon1: number, d: number, h: number, m: number, s = 0) =>
  utc(y, mon1, d, h + 8, m, s);

const ONE_HOUR = 3600;
const SLOW_PICK_LENGTH = 8 * ONE_HOUR; // 28,800 seconds
const TEN_MIN = 600;

describe('isSlowDraftPickLength', () => {
  it('returns true for slow draft pick lengths (>= 3600s)', () => {
    expect(isSlowDraftPickLength(3600)).toBe(true);
    expect(isSlowDraftPickLength(SLOW_PICK_LENGTH)).toBe(true);
    expect(isSlowDraftPickLength(24 * ONE_HOUR)).toBe(true);
  });

  it('returns false for fast draft pick lengths (< 3600s)', () => {
    expect(isSlowDraftPickLength(30)).toBe(false);
    expect(isSlowDraftPickLength(3599)).toBe(false);
    expect(isSlowDraftPickLength(0)).toBe(false);
  });
});

describe('isSlowDraftNightPause', () => {
  it('is true between 22:00 and 05:00 PT', () => {
    expect(isSlowDraftNightPause(ptPDT(2026, 6, 15, 22, 30))).toBe(true);
    expect(isSlowDraftNightPause(ptPDT(2026, 6, 16, 2, 0))).toBe(true);
    expect(isSlowDraftNightPause(ptPDT(2026, 6, 16, 4, 59))).toBe(true);
  });

  it('is false during the active window (05:00–22:00 PT)', () => {
    expect(isSlowDraftNightPause(ptPDT(2026, 6, 15, 5, 0))).toBe(false);
    expect(isSlowDraftNightPause(ptPDT(2026, 6, 15, 12, 0))).toBe(false);
    expect(isSlowDraftNightPause(ptPDT(2026, 6, 15, 21, 59))).toBe(false);
  });
});

describe('slowDraftPickEndUnix', () => {
  it('returns fromUnix when pickLengthSec is zero or negative', () => {
    const start = ptPDT(2026, 6, 15, 10, 0);
    expect(slowDraftPickEndUnix(start, 0)).toBe(start);
    expect(slowDraftPickEndUnix(start, -5)).toBe(start);
  });

  it('adds pickLength directly when pick fits entirely in active window', () => {
    // 10:00 PT + 10 min → 10:10 PT, all inside 05:00–22:00
    const start = ptPDT(2026, 6, 15, 10, 0);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(start + TEN_MIN);
  });

  it('skips overnight pause when pick straddles 22:00 PT boundary', () => {
    // Start 21:55 PT, pick length 10 min:
    //   5 min until 22:00, then pause 22:00–05:00, then 5 more min → 05:05 PT next day
    const start = ptPDT(2026, 6, 15, 21, 55);
    const expected = ptPDT(2026, 6, 16, 5, 5);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('advances to next active window when starting during overnight pause', () => {
    // Start 23:00 PT (in pause), 10 min → 05:00 next day + 10 min = 05:10 PT
    const start = ptPDT(2026, 6, 15, 23, 0);
    const expected = ptPDT(2026, 6, 16, 5, 10);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('advances to 05:00 same day when starting in early-morning pause', () => {
    // Start 04:00 PT (in pause), 10 min → 05:10 PT same day
    const start = ptPDT(2026, 6, 15, 4, 0);
    const expected = ptPDT(2026, 6, 15, 5, 10);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('handles full 8-hour slow draft pick that fits in one window', () => {
    // Active window is 17h (05:00–22:00). 8h fits in one window.
    // Start 09:00 PT, pickLength 8h → 17:00 PT same day
    const start = ptPDT(2026, 6, 15, 9, 0);
    const expected = ptPDT(2026, 6, 15, 17, 0);
    expect(slowDraftPickEndUnix(start, SLOW_PICK_LENGTH)).toBe(expected);
  });

  it('handles 8-hour slow draft starting near pause that spans into next day', () => {
    // Start 18:00 PT, pickLength 8h:
    //   4h until 22:00, pause, then 4h next day → 09:00 PT next day
    const start = ptPDT(2026, 6, 15, 18, 0);
    const expected = ptPDT(2026, 6, 16, 9, 0);
    expect(slowDraftPickEndUnix(start, SLOW_PICK_LENGTH)).toBe(expected);
  });

  it('handles PST winter time (no DST)', () => {
    // 21:55 PST + 10 min → 05:05 PST next day
    const start = ptPST(2026, 12, 15, 21, 55);
    const expected = ptPST(2026, 12, 16, 5, 5);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('handles a pick fully inside the active window in winter', () => {
    // 09:00 PST + 5h → 14:00 PST, no pause crossed
    const start = ptPST(2026, 3, 7, 9, 0);
    const result = slowDraftPickEndUnix(start, 5 * ONE_HOUR);
    expect(result).toBe(ptPST(2026, 3, 7, 14, 0));
  });

  it('handles a pick fully inside the active window after fall-back', () => {
    // Nov 1 2026 DST ends 02:00; at 09:00 it is PST. 09:00 + 5h → 14:00 PST
    const start = ptPST(2026, 11, 1, 9, 0);
    const result = slowDraftPickEndUnix(start, 5 * ONE_HOUR);
    expect(result).toBe(ptPST(2026, 11, 1, 14, 0));
  });
});

describe('slowDraftEffectiveElapsedSeconds', () => {
  it('returns 0 when end <= start', () => {
    const start = ptPDT(2026, 6, 15, 10, 0);
    expect(slowDraftEffectiveElapsedSeconds(start, start)).toBe(0);
    expect(slowDraftEffectiveElapsedSeconds(start, start - 100)).toBe(0);
  });

  it('returns wall-clock difference inside a single active window', () => {
    const start = ptPDT(2026, 6, 15, 10, 0);
    const end = ptPDT(2026, 6, 15, 10, 10);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(TEN_MIN);
  });

  it('excludes overnight pause from elapsed count', () => {
    // 21:55 PT to 05:05 PT next day = 7h10min wall, but
    // 5min active + (pause skipped) + 5min active = 10 min effective
    const start = ptPDT(2026, 6, 15, 21, 55);
    const end = ptPDT(2026, 6, 16, 5, 5);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(TEN_MIN);
  });

  it('inverse of slowDraftPickEndUnix for slow drafts', () => {
    const start = ptPDT(2026, 6, 15, 18, 0);
    const end = slowDraftPickEndUnix(start, SLOW_PICK_LENGTH);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(SLOW_PICK_LENGTH);
  });

  it('treats start-during-pause as starting at next active window', () => {
    // 23:00 PT → counted as starting 05:00 next day. To 06:00 = 1 hour elapsed.
    const start = ptPDT(2026, 6, 15, 23, 0);
    const end = ptPDT(2026, 6, 16, 6, 0);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(ONE_HOUR);
  });
});

describe('slowDraftActiveSecondsUntil', () => {
  it('returns the full pick length at the moment the pick starts', () => {
    const start = ptPDT(2026, 6, 15, 9, 0);
    const end = slowDraftPickEndUnix(start, SLOW_PICK_LENGTH);
    expect(slowDraftActiveSecondsUntil(start, end)).toBe(SLOW_PICK_LENGTH);
  });

  it('freezes during the overnight pause', () => {
    const start = ptPDT(2026, 6, 15, 18, 0); // 4h before pause
    const end = slowDraftPickEndUnix(start, SLOW_PICK_LENGTH);
    const atPauseStart = ptPDT(2026, 6, 15, 22, 0); // 4h consumed → 4h remaining
    const atPauseMiddle = ptPDT(2026, 6, 16, 2, 0); // still paused
    const r1 = slowDraftActiveSecondsUntil(atPauseStart, end);
    const r2 = slowDraftActiveSecondsUntil(atPauseMiddle, end);
    expect(r1).toBe(r2);
    expect(r1).toBe(4 * ONE_HOUR);
  });
});

describe('slowDraftDisplayedSecondsRemaining', () => {
  it('returns full pick length when no time has elapsed', () => {
    const start = ptPDT(2026, 6, 15, 10, 0);
    expect(slowDraftDisplayedSecondsRemaining(start, start, SLOW_PICK_LENGTH)).toBe(
      SLOW_PICK_LENGTH
    );
  });

  it('decreases as effective elapsed time grows', () => {
    const start = ptPDT(2026, 6, 15, 10, 0);
    const now = ptPDT(2026, 6, 15, 11, 0); // 1 hr later, all active
    expect(slowDraftDisplayedSecondsRemaining(now, start, SLOW_PICK_LENGTH)).toBe(
      SLOW_PICK_LENGTH - ONE_HOUR
    );
  });

  it('stays constant during overnight pause', () => {
    // Pick starts 21:30 PT, 8h length.
    // At 22:00 PT, 30 min has elapsed → 7h30m remaining.
    // At 03:00 PT next day (still in pause), elapsed is still 30 min → same remaining.
    const start = ptPDT(2026, 6, 15, 21, 30);
    const atPauseStart = ptPDT(2026, 6, 15, 22, 0);
    const atPauseMiddle = ptPDT(2026, 6, 16, 3, 0);
    const r1 = slowDraftDisplayedSecondsRemaining(atPauseStart, start, SLOW_PICK_LENGTH);
    const r2 = slowDraftDisplayedSecondsRemaining(atPauseMiddle, start, SLOW_PICK_LENGTH);
    expect(r1).toBe(r2);
    expect(r1).toBe(SLOW_PICK_LENGTH - 30 * 60);
  });

  it('returns 0 (never negative) when pick has expired', () => {
    const start = ptPDT(2026, 6, 15, 10, 0);
    const wayLater = ptPDT(2026, 6, 18, 10, 0); // 3 days later
    expect(slowDraftDisplayedSecondsRemaining(wayLater, start, SLOW_PICK_LENGTH)).toBe(0);
  });
});
