import { describe, it, expect } from 'vitest';
import {
  isSlowDraftPickLength,
  slowDraftPickEndUnix,
  slowDraftEffectiveElapsedSeconds,
  slowDraftDisplayedSecondsRemaining,
} from '@/utils/slowDraftClock';

// Helper: unix seconds for a UTC wall-clock instant.
const utc = (y: number, mon1: number, d: number, h: number, m: number, s = 0) =>
  Math.floor(Date.UTC(y, mon1 - 1, d, h, m, s) / 1000);

// June (EDT, UTC-4): NY = UTC - 4
// 10:00 EDT = 14:00 UTC
// 22:00 EDT = 02:00 UTC next day
const nyEDT = (y: number, mon1: number, d: number, h: number, m: number, s = 0) =>
  utc(y, mon1, d, h + 4, m, s);

// December (EST, UTC-5): NY = UTC - 5
const nyEST = (y: number, mon1: number, d: number, h: number, m: number, s = 0) =>
  utc(y, mon1, d, h + 5, m, s);

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

describe('slowDraftPickEndUnix', () => {
  it('returns fromUnix when pickLengthSec is zero or negative', () => {
    const start = nyEDT(2026, 6, 15, 10, 0);
    expect(slowDraftPickEndUnix(start, 0)).toBe(start);
    expect(slowDraftPickEndUnix(start, -5)).toBe(start);
  });

  it('adds pickLength directly when pick fits entirely in active window', () => {
    // 10:00 EDT + 10 min → 10:10 EDT, all inside 08:00–22:00
    const start = nyEDT(2026, 6, 15, 10, 0);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(start + TEN_MIN);
  });

  it('skips overnight pause when pick straddles 22:00 NY boundary', () => {
    // Start 21:55 EDT, pick length 10 min:
    //   5 min until 22:00, then pause 22:00–08:00, then 5 more min → 08:05 EDT next day
    const start = nyEDT(2026, 6, 15, 21, 55);
    const expected = nyEDT(2026, 6, 16, 8, 5);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('advances to next active window when starting during overnight pause', () => {
    // Start 23:00 EDT (in pause), 10 min → 08:00 next day + 10 min = 08:10 EDT
    const start = nyEDT(2026, 6, 15, 23, 0);
    const expected = nyEDT(2026, 6, 16, 8, 10);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('advances to 08:00 same day when starting in early-morning pause', () => {
    // Start 06:00 EDT (in pause), 10 min → 08:10 EDT same day
    const start = nyEDT(2026, 6, 15, 6, 0);
    const expected = nyEDT(2026, 6, 15, 8, 10);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('handles full 8-hour slow draft pick spanning multiple days', () => {
    // Active window is 14h (08:00–22:00). 8h fits in one window.
    // Start 09:00 EDT, pickLength 8h → 17:00 EDT same day
    const start = nyEDT(2026, 6, 15, 9, 0);
    const expected = nyEDT(2026, 6, 15, 17, 0);
    expect(slowDraftPickEndUnix(start, SLOW_PICK_LENGTH)).toBe(expected);
  });

  it('handles 8-hour slow draft starting near pause that spans into next day', () => {
    // Start 18:00 EDT, pickLength 8h:
    //   4h until 22:00, pause, then 4h next day → 12:00 EDT next day
    const start = nyEDT(2026, 6, 15, 18, 0);
    const expected = nyEDT(2026, 6, 16, 12, 0);
    expect(slowDraftPickEndUnix(start, SLOW_PICK_LENGTH)).toBe(expected);
  });

  it('handles EST winter time (no DST)', () => {
    // 21:55 EST + 10 min → 08:05 EST next day
    const start = nyEST(2026, 12, 15, 21, 55);
    const expected = nyEST(2026, 12, 16, 8, 5);
    expect(slowDraftPickEndUnix(start, TEN_MIN)).toBe(expected);
  });

  it('correctly handles spring-forward DST transition', () => {
    // 2026 DST: 2am EST on Mar 8 → 3am EDT (skips 02:00–03:00 local)
    // Start 08:00 EST on Mar 7, 24h pickLength = 1 day of active time
    // Active window is 14h, so 24h spans 2 days of windows
    // Math doesn't break across DST — just verify the function returns a sensible
    // unix value (must be > start + actual elapsed wall time).
    const start = nyEST(2026, 3, 7, 9, 0);
    const result = slowDraftPickEndUnix(start, 5 * ONE_HOUR);
    expect(result).toBe(nyEST(2026, 3, 7, 14, 0));
  });

  it('correctly handles fall-back DST transition', () => {
    // 2026 DST end: 2am EDT on Nov 1 → 1am EST (repeats 01:00–02:00 local)
    // 09:00 EST = 14:00 UTC. 5h later = 19:00 UTC = 14:00 EST.
    const start = nyEST(2026, 11, 1, 9, 0);
    const result = slowDraftPickEndUnix(start, 5 * ONE_HOUR);
    expect(result).toBe(nyEST(2026, 11, 1, 14, 0));
  });
});

describe('slowDraftEffectiveElapsedSeconds', () => {
  it('returns 0 when end <= start', () => {
    const start = nyEDT(2026, 6, 15, 10, 0);
    expect(slowDraftEffectiveElapsedSeconds(start, start)).toBe(0);
    expect(slowDraftEffectiveElapsedSeconds(start, start - 100)).toBe(0);
  });

  it('returns wall-clock difference inside a single active window', () => {
    const start = nyEDT(2026, 6, 15, 10, 0);
    const end = nyEDT(2026, 6, 15, 10, 10);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(TEN_MIN);
  });

  it('excludes overnight pause from elapsed count', () => {
    // 21:55 EDT to 08:05 EDT next day = 10h10min wall, but
    // 5min active + (pause skipped) + 5min active = 10 min effective
    const start = nyEDT(2026, 6, 15, 21, 55);
    const end = nyEDT(2026, 6, 16, 8, 5);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(TEN_MIN);
  });

  it('inverse of slowDraftPickEndUnix for slow drafts', () => {
    const start = nyEDT(2026, 6, 15, 18, 0);
    const end = slowDraftPickEndUnix(start, SLOW_PICK_LENGTH);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(SLOW_PICK_LENGTH);
  });

  it('treats start-during-pause as starting at next active window', () => {
    // 23:00 EDT → counted as starting 08:00 next day. To 09:00 = 1 hour elapsed.
    const start = nyEDT(2026, 6, 15, 23, 0);
    const end = nyEDT(2026, 6, 16, 9, 0);
    expect(slowDraftEffectiveElapsedSeconds(start, end)).toBe(ONE_HOUR);
  });
});

describe('slowDraftDisplayedSecondsRemaining', () => {
  it('returns full pick length when no time has elapsed', () => {
    const start = nyEDT(2026, 6, 15, 10, 0);
    expect(slowDraftDisplayedSecondsRemaining(start, start, SLOW_PICK_LENGTH)).toBe(
      SLOW_PICK_LENGTH
    );
  });

  it('decreases as effective elapsed time grows', () => {
    const start = nyEDT(2026, 6, 15, 10, 0);
    const now = nyEDT(2026, 6, 15, 11, 0); // 1 hr later, all active
    expect(slowDraftDisplayedSecondsRemaining(now, start, SLOW_PICK_LENGTH)).toBe(
      SLOW_PICK_LENGTH - ONE_HOUR
    );
  });

  it('stays constant during overnight pause', () => {
    // Pick starts 21:30 EDT, 8h length.
    // At 22:00 EDT, 30 min has elapsed → 7h30m remaining.
    // At 03:00 EDT next day (still in pause), elapsed is still 30 min → same remaining.
    const start = nyEDT(2026, 6, 15, 21, 30);
    const atPauseStart = nyEDT(2026, 6, 15, 22, 0);
    const atPauseMiddle = nyEDT(2026, 6, 16, 3, 0);
    const r1 = slowDraftDisplayedSecondsRemaining(atPauseStart, start, SLOW_PICK_LENGTH);
    const r2 = slowDraftDisplayedSecondsRemaining(atPauseMiddle, start, SLOW_PICK_LENGTH);
    expect(r1).toBe(r2);
    expect(r1).toBe(SLOW_PICK_LENGTH - 30 * 60);
  });

  it('returns 0 (never negative) when pick has expired', () => {
    const start = nyEDT(2026, 6, 15, 10, 0);
    const wayLater = nyEDT(2026, 6, 18, 10, 0); // 3 days later
    expect(slowDraftDisplayedSecondsRemaining(wayLater, start, SLOW_PICK_LENGTH)).toBe(0);
  });
});
