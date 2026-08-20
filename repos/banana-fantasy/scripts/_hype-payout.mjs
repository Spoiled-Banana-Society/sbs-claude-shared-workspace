/**
 * Banana Hype week-1 payout (Boris 2026-08-20). Reads the week's standings
 * (final snapshot after 6pm PT; live tiles in --dry-run before), maps handles
 * → wallets via v2_twitter_links, and pays the ladder:
 *   1st JackHOF seat · 2nd-3rd Jackpot seat · 4th-6th HOF seat ·
 *   7th-15th +3 spins · 16th-25th +1 spin.
 * Seats = EXACT wheel-win path: reserveTokensToWallet → recordPassOrigins →
 * registerMintedTokens(free) → Level stamp on validDraftTokens →
 * joinQueueWithToken(source 'wheel') → ensureSpecialDraftSeat. Spins =
 * wheelSpins increment (same field the wheel consumes) + bell.
 * Idempotent: hype_payouts/{weekId}__{handle} created per award via create().
 * Usage: node scripts/_hype-payout.mjs [--apply]
 */
import 'dotenv/config';
const APPLY = process.argv.includes('--apply');
process.env.NODE_ENV = 'production';
const { getAdminFirestore } = await import('../lib/firebaseAdmin.ts').catch(() => ({}));
console.log('This script must run through tsx for TS imports — use scripts/_hype-payout-run.sh');
