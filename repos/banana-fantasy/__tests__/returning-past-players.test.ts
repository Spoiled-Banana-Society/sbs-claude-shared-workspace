import { describe, it, expect } from 'vitest';
import { isReturningWalletSync, isPastPlayer, PAST_PLAYER_COUNT } from '@/lib/returningUsers';
import { filterAndSortVisiblePromos } from '@/lib/promoFilter';
import type { Promo } from '@/types';
import existingPlayers from '@/lib/data/existing-players.json';

const SAMPLE_PAST_WALLET = (existingPlayers.wallets as string[])[0];
const RANDOM_NEW_WALLET = '0xffffffffffffffffffffffffffffffffffffffff';
// Genesis-only NFT holder (never entered a Best Ball season) — must be treated
// as a NEW user, not returning, since the genesis-only cohort was dropped.
const GENESIS_ONLY_WALLET = '0x0000007370af0000ad00be0efd2f1eb6e6e9d700';

const promos = [
  { id: 'n', type: 'new-user' },
  { id: 'fp', type: 'first-purchase' },
] as unknown as Promo[];

describe('all-time past-players → returning treatment', () => {
  it('snapshot has the Best-Ball-players list (genesis-only excluded)', () => {
    expect(PAST_PLAYER_COUNT).toBe(1745);
  });

  it('genesis-only NFT holder is treated as NEW, not returning', () => {
    expect(isPastPlayer(GENESIS_ONLY_WALLET)).toBe(false);
    expect(isReturningWalletSync(GENESIS_ONLY_WALLET)).toBe(false);
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

  it('past player: new-user promo HIDDEN and first-purchase HIDDEN too (new players only, 2026-07-10)', () => {
    const isBB3Holder = isReturningWalletSync(SAMPLE_PAST_WALLET);
    const types = filterAndSortVisiblePromos(promos, { isBB3Holder, flagsKnown: true }).map((p) => p.type);
    expect(types).not.toContain('new-user');
    expect(types).not.toContain('first-purchase');
  });

  it('past player with unclaimed first-purchase spins: card still shown (claim never stranded)', () => {
    const claimablePromos = [
      { id: 'fp', type: 'first-purchase', claimable: true, claimCount: 2 },
    ] as unknown as Promo[];
    const types = filterAndSortVisiblePromos(claimablePromos, {
      isBB3Holder: true,
      flagsKnown: true,
    }).map((p) => p.type);
    expect(types).toContain('first-purchase');
  });

  it('new user after unlock: first-purchase SHOWN', () => {
    const types = filterAndSortVisiblePromos(promos, {
      isBB3Holder: false,
      flagsKnown: true,
      firstPurchasePromoUnlocked: true,
    }).map((p) => p.type);
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
