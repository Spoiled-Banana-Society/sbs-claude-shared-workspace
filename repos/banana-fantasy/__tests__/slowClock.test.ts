import { describe, it, expect } from 'vitest';
import { LEGACY_SLOW_CLOCK, normalizeSlowClockConfig, slowClockCopy } from '@/lib/slowClock';
import { buildFAQSections, mockFAQSections } from '@/lib/faqContent';
import { slowDraftPickEndUnix, isSlowDraftNightPause, slowDraftEffectiveElapsedSeconds } from '@/utils/slowDraftClock';

describe('slowClockCopy — switch OFF is byte-identical to the legacy copy', () => {
  const c = slowClockCopy(LEGACY_SLOW_CLOCK);
  it('legacy phrasings', () => {
    expect(c.pickLengthSec).toBe(28800);
    expect(c.long).toBe('8 hours');
    expect(c.perPick).toBe('8 hours per pick');
    expect(c.short).toBe('8hr');
    expect(c.compact).toBe('8h');
    expect(c.hrsPick).toBe('8 hrs/pick');
    expect(c.word).toBe('8 hour');
    expect(c.hyphen).toBe('8-hour');
    expect(c.shorteningNote).toBe('');
    expect(c.pauseNote).toBe('');
    expect(c.enabled).toBe(false);
    expect(c.freshClockAfterPause).toBe(false);
    expect(c.pauseEndLabel).toBe('5am');
    expect(c.pauseWindowLabel).toBe('10pm–5am PT');
  });
  it('FAQ legacy snapshot still says 8 hours and nothing about shortening', () => {
    const all = JSON.stringify(mockFAQSections);
    expect(all).toContain('8 hours per pick');
    expect(all).not.toContain('Clocks get shorter');
    expect(all).not.toContain('fresh full clock');
  });
});

describe('slowClockCopy — switch ON', () => {
  const on = normalizeSlowClockConfig({ enabled: true, pickLengthSec: 14400, freshClockAfterPause: true });
  const c = slowClockCopy(on);
  it('4h phrasings + notes', () => {
    expect(c.long).toBe('4 hours');
    expect(c.perPick).toBe('4 hours per pick');
    expect(c.short).toBe('4hr');
    expect(c.compact).toBe('4h');
    expect(c.hrsPick).toBe('4 hrs/pick');
    expect(c.word).toBe('4 hour');
    expect(c.hyphen).toBe('4-hour');
    expect(c.shorteningNote).toContain('Clocks get shorter');
    expect(c.pauseNote).toContain('fresh full clock at 5am PT');
    expect(c.freshClockAfterPause).toBe(true);
  });
  it('FAQ picks up the new clock and the shortening line', () => {
    const all = JSON.stringify(buildFAQSections(c));
    expect(all).toContain('4 hours per pick');
    expect(all).not.toContain('8 hours per pick');
    expect(all).toContain('Clocks get shorter');
  });
  it('1 hour + sub-hour phrasing', () => {
    expect(slowClockCopy(normalizeSlowClockConfig({ enabled: true, pickLengthSec: 3600 })).long).toBe('1 hour');
    expect(slowClockCopy(normalizeSlowClockConfig({ enabled: true, pickLengthSec: 3600 })).hrsPick).toBe('1 hr/pick');
    expect(slowClockCopy(normalizeSlowClockConfig({ enabled: true, pickLengthSec: 1800 })).long).toBe('30 minutes');
  });
  it('normalize: startsAtIso gates enabled until the instant passes', () => {
    const raw = { enabled: true, pickLengthSec: 14400, freshClockAfterPause: true, startsAtIso: '2026-08-27T12:00:00Z' };
    const before = Date.parse('2026-08-27T11:59:00Z');
    const after = Date.parse('2026-08-27T12:00:00Z');
    expect(normalizeSlowClockConfig(raw, before)).toEqual(LEGACY_SLOW_CLOCK);
    expect(normalizeSlowClockConfig(raw, after)).toEqual({ enabled: true, pickLengthSec: 14400, freshClockAfterPause: true, pauseEndHour: 5, pauseStartHour: 22, regularJoinClosed: false, regularJoinLastLobbyId: '' });
    expect(normalizeSlowClockConfig({ ...raw, startsAtIso: 'garbage' }, before).enabled).toBe(true);
  });
  it('normalize: disabled ignores pickLengthSec; garbage → legacy', () => {
    expect(normalizeSlowClockConfig({ enabled: false, pickLengthSec: 14400 })).toEqual(LEGACY_SLOW_CLOCK);
    expect(normalizeSlowClockConfig(null)).toEqual(LEGACY_SLOW_CLOCK);
    expect(normalizeSlowClockConfig({ enabled: true, pickLengthSec: -1 }).pickLengthSec).toBe(28800);
    expect(normalizeSlowClockConfig({ enabled: true, pickLengthSec: 7200 }).freshClockAfterPause).toBe(false);
  });
  it('pauseEndHour: 7 while on, legacy 5 while off or invalid', () => {
    const on = normalizeSlowClockConfig({ enabled: true, pickLengthSec: 14400, freshClockAfterPause: true, pauseEndHour: 7 });
    expect(on.pauseEndHour).toBe(7);
    expect(slowClockCopy(on).pauseEndLabel).toBe('7am');
    expect(slowClockCopy(on).pauseWindowLabel).toBe('10pm–7am PT');
    expect(slowClockCopy(on).pauseNote).toContain('7am PT');
    expect(normalizeSlowClockConfig({ enabled: false, pauseEndHour: 7 }).pauseEndHour).toBe(5);
    expect(normalizeSlowClockConfig({ enabled: true, pauseEndHour: 22 }).pauseEndHour).toBe(5);
  });
});

describe('slowDraftPickEndUnix — fresh clock after the overnight pause (mirrors Go)', () => {
  // 2026-08-26 is PDT (UTC-7). 21:00 PT = 04:00Z next day.
  const pt = (y: number, m: number, d: number, h: number) => Date.UTC(y, m - 1, d, h + 7, 0, 0) / 1000;
  it('9pm + 4h: legacy ends 8am (1h + 3h carried), fresh ends 9am (full 4h from 5am)', () => {
    const start = pt(2026, 8, 26, 21);
    expect(slowDraftPickEndUnix(start, 4 * 3600)).toBe(pt(2026, 8, 27, 8));
    expect(slowDraftPickEndUnix(start, 4 * 3600, false)).toBe(pt(2026, 8, 27, 8));
    expect(slowDraftPickEndUnix(start, 4 * 3600, true)).toBe(pt(2026, 8, 27, 9));
  });
  it('no straddle → identical', () => {
    const start = pt(2026, 8, 26, 10);
    expect(slowDraftPickEndUnix(start, 4 * 3600, true)).toBe(pt(2026, 8, 26, 14));
    expect(slowDraftPickEndUnix(start, 4 * 3600, false)).toBe(pt(2026, 8, 26, 14));
  });
  it('pause ending 7am: 9pm + 4h fresh → 11am; 6am is still paused', () => {
    const start = pt(2026, 8, 26, 21);
    expect(slowDraftPickEndUnix(start, 4 * 3600, true, 7)).toBe(pt(2026, 8, 27, 11));
    expect(slowDraftPickEndUnix(pt(2026, 8, 27, 6), 4 * 3600, true, 7)).toBe(pt(2026, 8, 27, 11));
    expect(isSlowDraftNightPause(pt(2026, 8, 27, 6) + 1800, 7)).toBe(true);
    expect(isSlowDraftNightPause(pt(2026, 8, 27, 6) + 1800, 5)).toBe(false);
    expect(slowDraftEffectiveElapsedSeconds(start, pt(2026, 8, 27, 12), 7)).toBe(6 * 3600);
  });
  it('too long for one window degrades to carry-over instead of looping', () => {
    const start = pt(2026, 8, 26, 6);
    expect(slowDraftPickEndUnix(start, 18 * 3600, true)).toBe(slowDraftPickEndUnix(start, 18 * 3600, false));
  });
});
