import { describe, it, expect, vi } from 'vitest';

// db-firestore initializes Firebase Admin at module load. Mock it so importing
// the pure helper under test doesn't try to connect to Firestore.
vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminFirestore: () => ({}),
}));

import { dailyDraftCycleNeedsReset } from '@/lib/db-firestore';

const NOW = new Date('2026-06-18T00:00:00Z').getTime();
const future = new Date(NOW + 60 * 60 * 1000).toISOString(); // +1h
const past = new Date(NOW - 60 * 60 * 1000).toISOString(); // -1h

describe('dailyDraftCycleNeedsReset (4-drafts-daily cycle)', () => {
  it('does NOT reset an active cycle (timer still in the future)', () => {
    expect(dailyDraftCycleNeedsReset({ timerEndTime: future, progressCurrent: 2 }, NOW)).toBe(false);
  });

  it('resets once the 24h timer has expired', () => {
    expect(dailyDraftCycleNeedsReset({ timerEndTime: past, progressCurrent: 2 }, NOW)).toBe(true);
  });

  // Wallet #1: 3/4 stuck at 24:00:00 — progress with NO timer (the old
  // delete-collision left the cycle without a timer). Must reset to 0/4.
  it('resets an ORPHANED cycle: progress > 0 but no timer', () => {
    expect(dailyDraftCycleNeedsReset({ progressCurrent: 3 }, NOW)).toBe(true);
  });

  it('does NOT reset a fresh/empty cycle (0 progress, no timer)', () => {
    expect(dailyDraftCycleNeedsReset({ progressCurrent: 0 }, NOW)).toBe(false);
    expect(dailyDraftCycleNeedsReset({}, NOW)).toBe(false);
  });

  // Wallet #2: 2/4 · 0:00:00 with a pending CLAIM. The reset must NOT be
  // blocked by unclaimed spins — the helper ignores claimable entirely, and the
  // caller keeps claimable/claimCount while resetting the cycle.
  it('resets an expired cycle regardless of pending claims', () => {
    expect(dailyDraftCycleNeedsReset({ timerEndTime: past, progressCurrent: 2 }, NOW)).toBe(true);
  });
});
