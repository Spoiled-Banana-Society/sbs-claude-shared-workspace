import { describe, it, expect } from 'vitest';
import { isPromoCodeActive, normalizeCode, type PromoCodeConfig } from '@/lib/promoCode';

const cfg: PromoCodeConfig = { enabled: true, code: 'BANANA', spins: 4, startsAtMs: 1_000, endsAtMs: 1_000 + 48 * 3600_000 };

describe('promo code window', () => {
  it('is live only inside [start, end) and only when enabled', () => {
    expect(isPromoCodeActive(cfg, 999)).toBe(false);
    expect(isPromoCodeActive(cfg, 1_000)).toBe(true);
    expect(isPromoCodeActive(cfg, cfg.endsAtMs - 1)).toBe(true);
    expect(isPromoCodeActive(cfg, cfg.endsAtMs)).toBe(false);
    expect(isPromoCodeActive({ ...cfg, enabled: false }, 5_000)).toBe(false);
    expect(isPromoCodeActive({ ...cfg, spins: 0 }, 5_000)).toBe(false);
  });
  it('ships dark by default shape (disabled, zero window)', () => {
    expect(isPromoCodeActive({ enabled: false, code: 'BANANA', spins: 4, startsAtMs: 0, endsAtMs: 0 })).toBe(false);
  });
});

describe('normalizeCode', () => {
  it('uppercases, trims, strips punctuation so " banana! " matches BANANA', () => {
    expect(normalizeCode(' banana! ')).toBe('BANANA');
    expect(normalizeCode('Ba-Na-Na')).toBe('BANANA');
    expect(normalizeCode('')).toBe('');
    expect(normalizeCode(undefined)).toBe('');
  });
});
