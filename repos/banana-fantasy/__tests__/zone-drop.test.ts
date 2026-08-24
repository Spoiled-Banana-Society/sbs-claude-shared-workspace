import { describe, it, expect } from 'vitest';
import { assignGoldenTickets, type PackRef } from '@/lib/dropMath';
import { bandSpecs, bandForPosition, TICKETS_BY_BAND } from '@/lib/zoneDrop';
import type { BonusZoneConfig } from '@/lib/bonusZone';

const cfg = (t1: number, t2: number, t3: number): BonusZoneConfig => ({
  enabled: true, launchAtIso: '2026-08-23T00:00:00Z',
  tier1Through: t1, tier2Through: t2, tier3Through: t3,
  grandfatherTokenIds: [],
} as unknown as BonusZoneConfig);

describe('Golden Ticket bands (final 8/23: 1-25 → 6, 26-50 → 4)', () => {
  it('25/50/50 config yields exactly two bands, 6 and 4 tickets', () => {
    const specs = bandSpecs(cfg(25, 50, 50));
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ band: 1, fromPos: 1, toPos: 25, tickets: 6 });
    expect(specs[1]).toMatchObject({ band: 2, fromPos: 26, toPos: 50, tickets: 4 });
  });

  it('10 tickets per window — one full JackHOF league', () => {
    const total = bandSpecs(cfg(25, 50, 50)).reduce((s, b) => s + b.tickets, 0);
    expect(total).toBe(10);
  });

  it('a real third tier still produces no band — its ticket count is 0', () => {
    expect(TICKETS_BY_BAND[2]).toBe(0);
    expect(bandSpecs(cfg(20, 40, 60))).toHaveLength(2);
  });

  it('band edges: 25 is band 1, 26 is band 2, 50 is band 2, 51 is out', () => {
    const c = cfg(25, 50, 50);
    expect(bandForPosition(1, c)?.band).toBe(1);
    expect(bandForPosition(25, c)?.band).toBe(1);
    expect(bandForPosition(26, c)?.band).toBe(2);
    expect(bandForPosition(50, c)?.band).toBe(2);
    expect(bandForPosition(51, c)).toBeNull();
    expect(bandForPosition(0, c)).toBeNull();
  });
});

describe('assignGoldenTickets', () => {
  const packs = (n: number): PackRef[] =>
    Array.from({ length: n }, (_, i) => ({ packId: `p${String(i).padStart(3, '0')}`, userId: `u${i % 7}` }));

  it('deals exactly the requested tickets, everything else empty', () => {
    const out = assignGoldenTickets(packs(200), 'ab'.repeat(32), '867__b1', 6);
    expect(out).toHaveLength(200);
    expect(out.filter((a) => a.prize.kind === 'jackhof')).toHaveLength(6);
    expect(out.filter((a) => a.prize.kind === 'none')).toHaveLength(194);
  });

  it('is deterministic for the same seed and band, different across bands', () => {
    const seed = 'cd'.repeat(32);
    const a = assignGoldenTickets(packs(50), seed, '867__b1', 6).filter((x) => x.prize.kind === 'jackhof').map((x) => x.packId);
    const b = assignGoldenTickets(packs(50), seed, '867__b1', 6).filter((x) => x.prize.kind === 'jackhof').map((x) => x.packId);
    const c = assignGoldenTickets(packs(50), seed, '867__b2', 6).filter((x) => x.prize.kind === 'jackhof').map((x) => x.packId);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('is independent of input order (sorted by packId internally)', () => {
    const seed = 'ef'.repeat(32);
    const forward = assignGoldenTickets(packs(30), seed, '867__b1', 4);
    const reversed = assignGoldenTickets([...packs(30)].reverse(), seed, '867__b1', 4);
    const winners = (l: typeof forward) => l.filter((x) => x.prize.kind === 'jackhof').map((x) => x.packId).sort();
    expect(winners(forward)).toEqual(winners(reversed));
  });

  it('caller-capped tickets: an early-hit band with 2 packs deals at most 2', () => {
    const out = assignGoldenTickets(packs(2), '12'.repeat(32), '867__b1', Math.min(6, 2));
    expect(out.filter((a) => a.prize.kind === 'jackhof')).toHaveLength(2);
  });
});
