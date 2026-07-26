import { describe, it, expect } from 'vitest';
import {
  bananasForDraft, bananasForSource, cycleFor, pickWinner, shareOf,
  BANANAS_MAX_PER_FRIEND, DRAW_HOUR_PT,
} from '@/lib/bananaDrawMath';

// Noon Pacific on a given PDT (UTC-7) day, as UTC ms.
const pdtNoon = (day: number) => Date.UTC(2026, 6, day, 19, 0, 0);

describe('banana earning rates', () => {
  it('free draft earns the baseline, paid earns baseline + bonus', () => {
    expect(bananasForDraft('free')).toBe(1);
    expect(bananasForDraft('paid')).toBe(2);
  });

  it('referral sources pay 5 each, capped at 10 per friend', () => {
    expect(bananasForSource('referral-draft')).toBe(5);
    expect(bananasForSource('referral-purchase')).toBe(5);
    expect(BANANAS_MAX_PER_FRIEND).toBe(10);
  });
});

describe('cycleFor', () => {
  it('before noon PT sits in the cycle closing TODAY at noon', () => {
    const c = cycleFor(pdtNoon(27) - 60_000); // 11:59am PT Jul 27
    expect(c.cycleId).toBe('2026-07-27');
    expect(c.closesAt).toBe(pdtNoon(27));
    expect(c.opensAt).toBe(pdtNoon(26));
  });

  it('exactly at noon PT rolls into the NEXT cycle', () => {
    const c = cycleFor(pdtNoon(27));
    expect(c.cycleId).toBe('2026-07-28');
    expect(c.opensAt).toBe(pdtNoon(27));
    expect(c.closesAt).toBe(pdtNoon(28));
  });

  it('cycles are exactly 24h and tile without gaps or overlap', () => {
    const a = cycleFor(pdtNoon(27) + 3_600_000);  // 1pm PT
    const b = cycleFor(pdtNoon(28) + 3_600_000);  // 1pm PT next day
    expect(a.closesAt - a.opensAt).toBe(86_400_000);
    expect(b.opensAt).toBe(a.closesAt); // no gap, no overlap
  });

  it('survives the PST changeover — still noon PT, not 11am or 1pm', () => {
    // Nov 2 2026 is after DST ends, so PT is UTC-8.
    const c = cycleFor(Date.UTC(2026, 10, 3, 1, 0, 0)); // 5pm PT Nov 2
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
    }).format(new Date(c.closesAt));
    expect(Number(hour)).toBe(DRAW_HOUR_PT);
    expect(c.closesAt - c.opensAt).toBe(86_400_000);
  });
});

describe('pickWinner', () => {
  const entries = [
    { userId: '0xaaa', bananas: 1 },
    { userId: '0xbbb', bananas: 5 },
    { userId: '0xccc', bananas: 4 },
  ]; // 10 total: aaa=[0], bbb=[1..5], ccc=[6..9]

  const seedFor = (n: number) => n.toString(16).padStart(64, '0');

  it('lays out contiguous ranges in userId order', () => {
    expect(pickWinner(entries, seedFor(0)).winnerId).toBe('0xaaa');
    expect(pickWinner(entries, seedFor(1)).winnerId).toBe('0xbbb');
    expect(pickWinner(entries, seedFor(5)).winnerId).toBe('0xbbb');
    expect(pickWinner(entries, seedFor(6)).winnerId).toBe('0xccc');
    expect(pickWinner(entries, seedFor(9)).winnerId).toBe('0xccc');
  });

  it('wraps by modulo so any seed lands in the pool', () => {
    const r = pickWinner(entries, seedFor(13)); // 13 % 10 = 3 → bbb
    expect(r.winningIndex).toBe(3);
    expect(r.winnerId).toBe('0xbbb');
    expect(r.totalBananas).toBe(10);
  });

  it('a single Banana really can win — 1 of 10 is reachable', () => {
    // The promo promises this out loud, so it gets a test.
    const winners = new Set<string>();
    for (let i = 0; i < 10; i++) winners.add(pickWinner(entries, seedFor(i)).winnerId!);
    expect(winners.has('0xaaa')).toBe(true);
  });

  it('is deterministic and read-order independent', () => {
    const a = pickWinner(entries, seedFor(7));
    const b = pickWinner([...entries].reverse(), seedFor(7));
    expect(b.winnerId).toBe(a.winnerId);
    expect(b.winningIndex).toBe(a.winningIndex);
  });

  it('drops zero/negative balances instead of giving them a slot', () => {
    const r = pickWinner([...entries, { userId: '0xddd', bananas: 0 }], seedFor(0));
    expect(r.totalBananas).toBe(10);
    expect(r.ordered.some((e) => e.userId === '0xddd')).toBe(false);
  });

  it('an empty pool has no winner rather than throwing', () => {
    const r = pickWinner([], seedFor(3));
    expect(r.winnerId).toBeNull();
    expect(r.totalBananas).toBe(0);
  });

  it('weights hold across the whole seed space', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const w = pickWinner(entries, seedFor(i)).winnerId!;
      counts[w] = (counts[w] || 0) + 1;
    }
    expect(counts['0xaaa']).toBe(100); // 1/10
    expect(counts['0xbbb']).toBe(500); // 5/10
    expect(counts['0xccc']).toBe(400); // 4/10
  });
});

describe('shareOf', () => {
  it('reports pool share for the leaderboard', () => {
    expect(shareOf(6, 612)).toBeCloseTo(0.98, 2);
    expect(shareOf(84, 612)).toBeCloseTo(13.73, 2);
  });
  it('never divides by zero', () => {
    expect(shareOf(5, 0)).toBe(0);
  });
});
