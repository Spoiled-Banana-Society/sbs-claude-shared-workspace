import { describe, it, expect } from 'vitest';
import { wheelSegments, jackhofWheelSegments } from '@/lib/wheelConfig';

describe('Wheel Configuration', () => {
  it('has segments defined', () => {
    expect(wheelSegments.length).toBeGreaterThan(0);
  });

  it('probabilities sum to approximately 1.0', () => {
    const sum = wheelSegments.reduce((s, seg) => s + seg.probability, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it('every segment has required fields', () => {
    for (const seg of wheelSegments) {
      expect(seg.id).toBeTruthy();
      expect(seg.label).toBeTruthy();
      expect(typeof seg.probability).toBe('number');
      expect(seg.probability).toBeGreaterThan(0);
      expect(seg.probability).toBeLessThanOrEqual(1);
    }
  });

  it('no duplicate segment IDs', () => {
    const ids = wheelSegments.map(s => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('contains draft prize segments', () => {
    const ids = wheelSegments.map(s => s.id);
    expect(ids.some(id => id.startsWith('draft-'))).toBe(true);
  });
});

describe('JackHOF era wheel configuration', () => {
  it('probabilities sum to exactly 1.0', () => {
    const sum = jackhofWheelSegments.reduce((s, seg) => s + seg.probability, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('same 12-wedge geometry as the classic wheel', () => {
    expect(jackhofWheelSegments.length).toBe(wheelSegments.length);
  });

  it('has the 0.1% JackHOF wedge in place of draft-1-e, same wedges otherwise', () => {
    const jackhof = jackhofWheelSegments.find((s) => s.id === 'jackhof');
    expect(jackhof).toBeDefined();
    expect(jackhof!.probability).toBeCloseTo(0.001, 10);
    expect(jackhof!.prizeValue).toBe('jackhof');
    // Same wedge SET as the classic wheel with only draft-1-e → jackhof.
    // Order is intentionally different (see adjacency test below), which is
    // safe because outcomes/rendering follow each period's segmentsSnapshot.
    const classicIds = wheelSegments.map((s) => (s.id === 'draft-1-e' ? 'jackhof' : s.id)).sort();
    const jhIds = jackhofWheelSegments.map((s) => s.id).sort();
    expect(jhIds).toEqual(classicIds);
  });

  it('JackHOF never borders another warm-colored wedge', () => {
    // Richard 2026-07-20: jackhof orange next to jackpot red / hof gold /
    // draft-20 amber reads as one blob at wheel speed. Circular adjacency.
    const warm = new Set(['jackpot', 'hof', 'draft-20']);
    const n = jackhofWheelSegments.length;
    const i = jackhofWheelSegments.findIndex((s) => s.id === 'jackhof');
    expect(i).toBeGreaterThanOrEqual(0);
    const prev = jackhofWheelSegments[(i - 1 + n) % n];
    const next = jackhofWheelSegments[(i + 1) % n];
    expect(warm.has(prev.id)).toBe(false);
    expect(warm.has(next.id)).toBe(false);
  });

  it('no duplicate segment IDs', () => {
    const ids = jackhofWheelSegments.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
