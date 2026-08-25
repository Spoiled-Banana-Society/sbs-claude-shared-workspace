import { describe, it, expect } from 'vitest';
import { assignGoldenTickets, type PackRef } from '@/lib/dropMath';
import {
  bandSpecs, bandForPosition, TICKETS_BY_BAND,
  sealedSeatPositions, seatsToDealAt, stagedApplies, packOpenable, packSeatsLeftForTier,
  zonePackRulesExplanation, SEAT_RAMP_DEFAULT,
  type InstantBandState, type ZoneDropConfig,
} from '@/lib/zoneDrop';
import type { BonusZoneConfig } from '@/lib/bonusZone';

const cfg = (t1: number, t2: number, t3: number): BonusZoneConfig => ({
  enabled: true, launchAtIso: '2026-08-23T00:00:00Z',
  tier1Through: t1, tier2Through: t2, tier3Through: t3,
  grandfatherTokenIds: [],
} as unknown as BonusZoneConfig);

const zdInstant = (over: Partial<ZoneDropConfig> = {}): ZoneDropConfig => ({
  enabled: true, sinceIso: null, instant: true, seatsByBand: [3, 7, 0], seatRamp: 1, next: null, liveSeats: null, ...over,
});

describe('Golden Ticket bands (batch default 8/23: 1-25 → 6, 26-50 → 4)', () => {
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

describe('Instant mode bands (Richard 8/25: 1-30 → 3, 31-60 → 7)', () => {
  it('30/60 config with seatsByBand [3,7] yields 3 + 7 = 10', () => {
    const specs = bandSpecs(cfg(30, 60, 60), [3, 7, 0]);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ band: 1, fromPos: 1, toPos: 30, tickets: 3 });
    expect(specs[1]).toMatchObject({ band: 2, fromPos: 31, toPos: 60, tickets: 7 });
    expect(specs.reduce((s, b) => s + b.tickets, 0)).toBe(10);
  });

  it('band edges under 30/60: 30 → band 1, 31 → band 2, 61 → out', () => {
    const c = cfg(30, 60, 60);
    expect(bandForPosition(30, c, [3, 7, 0])?.band).toBe(1);
    expect(bandForPosition(31, c, [3, 7, 0])?.band).toBe(2);
    expect(bandForPosition(61, c, [3, 7, 0])).toBeNull();
  });

  it('a staged change applies only once the window moves PAST the staged one', () => {
    const next = { instant: true, seatsByBand: [3, 7, 0], tiers: [30, 60, 60] as [number, number, number], seatRamp: 1, stagedWindowStart: 867, stagedAtIso: '' };
    expect(stagedApplies(next, 867)).toBe(false);
    expect(stagedApplies(next, 860)).toBe(false);
    expect(stagedApplies(next, 0)).toBe(false);
    expect(stagedApplies(next, 901)).toBe(true);
    expect(stagedApplies(null, 901)).toBe(false);
  });

  it('header countdown: seats left = tickets − dealt for the live band; total otherwise; null in batch', () => {
    const c = cfg(30, 60, 60);
    const zd = zdInstant({ liveSeats: { windowStart: 901, band: 1, dealt: 1, tickets: 3 } });
    expect(packSeatsLeftForTier(1, 901, c, zd)).toBe(2);
    expect(packSeatsLeftForTier(2, 901, c, zd)).toBe(7);       // band 2 untouched → total
    expect(packSeatsLeftForTier(1, 950, c, zd)).toBe(3);       // stale stamp from an older window → total
    expect(packSeatsLeftForTier(null, 901, c, zd)).toBeNull();
    expect(packSeatsLeftForTier(1, 901, c, zdInstant({ instant: false }))).toBeNull();
  });

  it('rules copy switches to the instant wording and says the seats lean late', () => {
    const txt = zonePackRulesExplanation(cfg(30, 60, 60), zdInstant());
    expect(txt).toContain('opens right here, the moment your draft fills');
    expect(txt).toContain('3 JackHOF seats are hidden in drafts 1 to 30. 7 more are hidden in drafts 31 to 60.');
    expect(txt).toContain('Every seat still hidden lands in the packs of the draft that hit');
    expect(txt).toContain('more likely the deeper you get into each batch');
    expect(txt).not.toMatch(/\d–\d/); // no dashes in copy
    const flat = zonePackRulesExplanation(cfg(30, 60, 60), zdInstant({ seatRamp: 0 }));
    expect(flat).not.toContain('more likely the deeper');
  });
});

describe('sealedSeatPositions', () => {
  const seed = 'ab'.repeat(32);

  it('draws exactly N distinct positions inside the band, sorted, deterministic', () => {
    const a = sealedSeatPositions(seed, '901__b1', 1, 30, 3);
    const b = sealedSeatPositions(seed, '901__b1', 1, 30, 3);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(a.every((p) => p >= 1 && p <= 30)).toBe(true);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
  });

  it('different band → different positions; caps at the band width', () => {
    const a = sealedSeatPositions(seed, '901__b1', 1, 30, 3);
    const c = sealedSeatPositions(seed, '901__b2', 31, 60, 7);
    expect(c.every((p) => p >= 31 && p <= 60)).toBe(true);
    expect(a).not.toEqual(c);
    expect(sealedSeatPositions(seed, '901__b1', 1, 5, 9)).toHaveLength(5);
    expect(sealedSeatPositions(seed, '901__b1', 1, 30, 0)).toHaveLength(0);
  });

  it('ramp 1 leans the seats toward the END of the batch (snowball), ramp 0 is flat', () => {
    // Average position over many seeds: linear ramp should sit well past
    // the midpoint of 1..30 (flat ≈ 15.5, linear ≈ 20.5).
    const avg = (ramp: number) => {
      let sum = 0, n = 0;
      for (let i = 0; i < 400; i++) {
        const s = sealedSeatPositions(`${i.toString(16).padStart(4, '0')}`.repeat(16), '901__b1', 1, 30, 3, ramp);
        for (const p of s) { sum += p; n++; }
      }
      return sum / n;
    };
    const flat = avg(0);
    const ramp = avg(1);
    expect(flat).toBeGreaterThan(13);
    expect(flat).toBeLessThan(18);
    expect(ramp).toBeGreaterThan(18.5);
    expect(ramp).toBeGreaterThan(flat + 3);
    expect(SEAT_RAMP_DEFAULT).toBe(1);
  });
});

describe('seatsToDealAt (the per-draft rule)', () => {
  const band = (over: Partial<InstantBandState> = {}): InstantBandState => ({
    seatPositions: [7, 18, 27], resolved: {}, absorbedPositions: [], rollover: 0, ...over,
  });

  it('a plain draft deals 0; a seat position deals 1; once, never twice', () => {
    expect(seatsToDealAt(band(), 5, false).seats).toBe(0);
    expect(seatsToDealAt(band(), 7, false).seats).toBe(1);
    expect(seatsToDealAt(band({ resolved: { '7': { seats: 1 } } }), 7, false).seats).toBe(0);
  });

  it('ELI5: JP hits at draft 7 with 2 seats not yet given → both land in draft 7 (plus its own)', () => {
    const r = seatsToDealAt(band(), 7, true);
    expect(r.seats).toBe(3);          // own seat at 7 + 18 + 27
    expect(r.absorbs).toEqual([18, 27]);
    // A hit at 10 with draft 7's seat somehow still undealt (missed webhook)
    // sweeps that one up too — nothing hidden survives a hit.
    const r2 = seatsToDealAt(band(), 10, true);
    expect(r2.seats).toBe(3);
    expect(r2.absorbs).toEqual([7, 18, 27]);
  });

  it('a hit only pulls seats that have not landed yet', () => {
    const b = band({ resolved: { '7': { seats: 1 } } });
    const r = seatsToDealAt(b, 12, true);
    expect(r.seats).toBe(2);
    expect(r.absorbs).toEqual([18, 27]);
  });

  it('an absorbed seat position never deals again if its draft fills later (webhook race)', () => {
    const b = band({ absorbedPositions: [18, 27], resolved: { '7': { seats: 1 }, '10': { seats: 2, } } });
    expect(seatsToDealAt(b, 18, false).seats).toBe(0);
  });

  it('rollover (a seat whose draft had no packs) rides on the next draft', () => {
    expect(seatsToDealAt(band({ rollover: 1 }), 8, false).seats).toBe(1);
    expect(seatsToDealAt(band({ rollover: 1 }), 18, false).seats).toBe(2);
  });
});

describe('packOpenable', () => {
  it('batch: locked + past reveal; instant: dealt (prize set) + past any hit hold', () => {
    const now = 1_000_000;
    expect(packOpenable({ mode: 'batch', status: 'locked', revealAtMs: now - 1 }, { prize: null, opened: false }, now)).toBe(true);
    expect(packOpenable({ mode: 'batch', status: 'earning' }, { prize: null, opened: false }, now)).toBe(false);
    expect(packOpenable({ mode: 'instant', status: 'earning' }, { prize: null, opened: false }, now)).toBe(false);
    expect(packOpenable({ mode: 'instant', status: 'earning' }, { prize: { kind: 'none' }, opened: false }, now)).toBe(true);
    expect(packOpenable({ mode: 'instant', status: 'earning' }, { prize: { kind: 'jackhof' }, opened: false, openableAtMs: now + 5 }, now)).toBe(false);
    expect(packOpenable({ mode: 'instant', status: 'earning' }, { prize: { kind: 'jackhof' }, opened: false, openableAtMs: now - 5 }, now)).toBe(true);
    expect(packOpenable({ mode: 'instant', status: 'locked' }, { prize: { kind: 'none' }, opened: true }, now)).toBe(false);
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

  it('instant: a 10-pack draft dealing 3 seats (the ELI5 hit) — 3 win, 7 empty, one per pack', () => {
    const out = assignGoldenTickets(packs(10), '34'.repeat(32), '901__b1:p7', 3);
    expect(out.filter((a) => a.prize.kind === 'jackhof')).toHaveLength(3);
    expect(out.filter((a) => a.prize.kind === 'none')).toHaveLength(7);
  });
});
