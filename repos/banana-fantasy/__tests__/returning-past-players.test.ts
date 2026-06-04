import { describe, it, expect } from 'vitest';
import { isReturningWalletSync, isPastPlayer, PAST_PLAYER_COUNT } from '@/lib/returningUsers';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import type { Promo } from '@/types';
import existingPlayers from '@/lib/data/existing-players.json';

const SAMPLE_PAST_WALLET = (existingPlayers.wallets as string[])[0];
const RANDOM_NEW_WALLET = '0xffffffffffffffffffffffffffffffffffffffff';

const promos = [
  { id: 'n', type: 'new-user' },
  { id: 'fp', type: 'first-purchase' },
] as unknown as Promo[];

describe('all-time past-players → returning treatment', () => {
  it('snapshot has the full 2,624-wallet list', () => {
    expect(PAST_PLAYER_COUNT).toBe(2624);
  });

  it('flags a known past player as returning (case-insensitive)', () => {
    expect(isPastPlayer(SAMPLE_PAST_WALLET)).toBe(true);
    expect(isPastPlayer(SAMPLE_PAST_WALLET.toUpperCase())).toBe(true);
    expect(isReturningWalletSync(SAMPLE_PAST_WALLET)).toBe(true);
  });

  it('does NOT flag an unknown wallet as returning', () => {
    expect(isPastPlayer(RANDOM_NEW_WALLET)).toBe(false);
    expect(isReturningWalletSync(RANDOM_NEW_WALLET)).toBe(false);
    expect(isReturningWalletSync(null)).toBe(false);
  });

  it('past player: new-user promo HIDDEN, first-purchase shown', () => {
    const isBB3Holder = isReturningWalletSync(SAMPLE_PAST_WALLET);
    const types = filterAndSortVisiblePromos(promos, { isBB3Holder, flagsKnown: true }).map((p) => p.type);
    expect(types).not.toContain('new-user');
    expect(types).toContain('first-purchase');
  });

  it('genuine new user: new-user promo SHOWN', () => {
    const isBB3Holder = isReturningWalletSync(RANDOM_NEW_WALLET);
    const types = filterAndSortVisiblePromos(promos, {
      isBB3Holder,
      flagsKnown: true,
      firstPurchasePromoUnlocked: false,
    }).map((p) => p.type);
    expect(types).toContain('new-user');
    expect(types).not.toContain('first-purchase');
  });
});
