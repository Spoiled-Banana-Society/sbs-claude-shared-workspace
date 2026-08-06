import type { WheelPrize } from '@/types';

/**
 * Central place for all API/config values.
 * This file is intended to be swapped to env/config service later.
 */

export const API_CONFIG = {
  wheel: {
    // Odds must sum to 100.
    odds: [
      { prize: { type: 'drafts', amount: 1 } as WheelPrize, weight: 93 },
      { prize: { type: 'drafts', amount: 5 } as WheelPrize, weight: 2.5 },
      { prize: { type: 'drafts', amount: 10 } as WheelPrize, weight: 1 },
      { prize: { type: 'hof' } as WheelPrize, weight: 2 },
      { prize: { type: 'drafts', amount: 20 } as WheelPrize, weight: 0.5 },
      { prize: { type: 'jackpot' } as WheelPrize, weight: 1 },
    ],
  },

  purchases: {
    pricePerPassUsd: 25,
    spinsPerPasses: 10, // buy 10 passes => 1 wheel spin

    usdc: {
      chain: 'base' as const,
      chainId: 8453,
      // Base USDC (native) contract address
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
      // TODO: replace with SBS treasury / payment receiver
      toAddress: '0x0000000000000000000000000000000000000000',
    },
  },

  promos: {
    dailyDrafts: {
      requiredDrafts: 4,
      windowHours: 24,
    },

    buyBonus: {
      // Kickoff Weekend promo (football is back) — runs through Sunday
      // night 2026-08-09. Disabled stops purchases from advancing the
      // promo; endsAtMs auto-cuts increments + hides the card without a
      // manual teardown deploy (the July 4th run needed one).
      enabled: true,
      // Midnight Pacific, end of Sunday 2026-08-09 (= 2026-08-10T07:00:00Z).
      endsAtMs: 1786345200000,
      buy: 2,
      // What a milestone pays out on claim. 'spin' = 1 Banana Wheel spin
      // (Richard's July 4th 2026 call); 'draft' = the original flat
      // free-draft reward — that machinery (on-chain mint, Go API
      // registration) is intact, flip this back to restore it.
      reward: 'spin' as 'spin' | 'draft',
      bonusFreeDrafts: 1,
    },

    tweetEngagement: {
      tweetId: '2029602200041951655',
      tweetUrl: 'https://x.com/BorisVagner/status/2029602200041951655',
    },
  },
} as const;

/**
 * True while the Buy 2 → FREE SPIN promo is live: enabled AND before the
 * Sunday-night cutoff. Every purchase-path increment and every visibility
 * surface must key off THIS, not `enabled` alone — that's what auto-ends
 * the promo at midnight without a deploy. Claims of already-earned spins
 * are NOT gated here (earned rewards stay claimable after the window).
 */
export function isBuyBonusActive(now: number = Date.now()): boolean {
  return API_CONFIG.promos.buyBonus.enabled && now < API_CONFIG.promos.buyBonus.endsAtMs;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function getUsdcPaymentAddressOrThrow(): string {
  const address = API_CONFIG.purchases.usdc.toAddress;
  // This MUST be replaced with the real treasury address before going live.
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error('USDC payment address is still set to the zero address. Configure the production treasury address before attempting a transaction.');
  }
  return address;
}
