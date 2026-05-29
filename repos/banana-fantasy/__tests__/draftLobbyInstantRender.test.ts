import { describe, it, expect } from 'vitest';
import { computeInitialPlayerCount, shouldShowPlayerCount, parseInitialPlayers, reconcileLiveCount, resolveRandomizeAnchor } from '@/lib/draftRoomLobby';

describe('Draft lobby instant render — no false "1/10" flash', () => {
  describe('computeInitialPlayerCount', () => {
    it('returns null (NOT 1) when the count is unknown — kills the "1/10" flash', () => {
      expect(computeInitialPlayerCount({})).toBeNull();
      expect(
        computeInitialPlayerCount({ storedPhase: 'filling', storedPlayers: 0, initialPlayers: 0 }),
      ).toBeNull();
      // The whole point: the unknown state must never resolve to 1.
      expect(computeInitialPlayerCount({})).not.toBe(1);
    });

    it('returns the stored player count when known', () => {
      expect(computeInitialPlayerCount({ storedPlayers: 6 })).toBe(6);
    });

    it('falls back to initialPlayers when there is no stored count', () => {
      expect(computeInitialPlayerCount({ initialPlayers: 5 })).toBe(5);
    });

    it('prefers stored count over initialPlayers', () => {
      expect(computeInitialPlayerCount({ storedPlayers: 7, initialPlayers: 2 })).toBe(7);
    });

    it('returns 10 when the stored phase is past filling', () => {
      expect(computeInitialPlayerCount({ storedPhase: 'pre-spin' })).toBe(10);
      expect(computeInitialPlayerCount({ storedPhase: 'countdown', storedPlayers: 3 })).toBe(10);
    });

    it('treats a stored "filling" phase with no count as unknown (null)', () => {
      expect(computeInitialPlayerCount({ storedPhase: 'filling' })).toBeNull();
    });

    it('clamps known counts into 1..10', () => {
      expect(computeInitialPlayerCount({ storedPlayers: 99 })).toBe(10);
      expect(computeInitialPlayerCount({ initialPlayers: 50 })).toBe(10);
    });
  });

  describe('parseInitialPlayers — the URL hint that caused the flash', () => {
    it('returns null when the players param is absent (the normal Enter-draft case)', () => {
      // This is the exact bug: no `players` param previously defaulted to 1.
      expect(parseInitialPlayers(null)).toBeNull();
      expect(parseInitialPlayers(undefined)).toBeNull();
      expect(parseInitialPlayers('')).toBeNull();
    });

    it('end-to-end: no param → initial count is null (pulse), never 1', () => {
      const initialPlayers = parseInitialPlayers(null);
      expect(initialPlayers).toBeNull();
      expect(computeInitialPlayerCount({ initialPlayers })).toBeNull();
    });

    it('returns the count when a valid param is present', () => {
      expect(parseInitialPlayers('6')).toBe(6);
    });

    it('returns null for non-positive or garbage params', () => {
      expect(parseInitialPlayers('0')).toBeNull();
      expect(parseInitialPlayers('-3')).toBeNull();
      expect(parseInitialPlayers('abc')).toBeNull();
    });
  });

  describe('reconcileLiveCount — no flicker on join, but leaves update live', () => {
    const GRACE = 2500;

    it('always accepts an increase immediately (new joiner)', () => {
      expect(reconcileLiveCount(2, 3, 0)).toBe(3);
      expect(reconcileLiveCount(2, 3, 999999)).toBe(3);
      expect(reconcileLiveCount(null, 2, 0)).toBe(2);
    });

    it('ignores a downward reading within the grace window (stale post-join dip)', () => {
      // Joined just now, count is 2, RTDB attaches with stale 1 → keep 2.
      expect(reconcileLiveCount(2, 1, 50)).toBe(2);
    });

    it('accepts a downward reading after the grace window (a real leave)', () => {
      // Been in the lobby a while; someone leaves 4→3 → show 3 live.
      expect(reconcileLiveCount(4, 3, GRACE + 1)).toBe(3);
    });

    it('a long-time watcher (large msSinceJoin) sees leaves immediately', () => {
      expect(reconcileLiveCount(5, 4, Number.POSITIVE_INFINITY)).toBe(4);
    });

    it('end-to-end joiner: 2 → stale 1 (ignored) → 2, no flicker', () => {
      let pc: number | null = 2;            // join response
      pc = reconcileLiveCount(pc, 1, 80);   // stale RTDB attach within grace
      expect(pc).toBe(2);
      pc = reconcileLiveCount(pc, 2, 120);  // corrected push
      expect(pc).toBe(2);
    });

    it('end-to-end watcher: 3 → 4 (join) → 3 (leave) all live', () => {
      let pc: number | null = 3;
      pc = reconcileLiveCount(pc, 4, 99999); // new joiner
      expect(pc).toBe(4);
      pc = reconcileLiveCount(pc, 3, 99999); // someone leaves
      expect(pc).toBe(3);
    });
  });

  describe('resolveRandomizeAnchor — synced bar start across all clients', () => {
    it('prefers the shared backend randomizeStartAt so every client matches', () => {
      expect(resolveRandomizeAnchor(1000, 5000, 9999)).toBe(1000);
    });

    it('falls back to a stored local anchor on resume', () => {
      expect(resolveRandomizeAnchor(null, 5000, 9999)).toBe(5000);
      expect(resolveRandomizeAnchor(0, 5000, 9999)).toBe(5000);
    });

    it('falls back to now when neither exists (old backend, no break)', () => {
      expect(resolveRandomizeAnchor(null, null, 9999)).toBe(9999);
      expect(resolveRandomizeAnchor(undefined, undefined, 9999)).toBe(9999);
    });

    it('two clients with the same shared anchor get identical bar timing', () => {
      const shared = 1_700_000_000_000;
      // observer (stored from a prior render) and 10th joiner (no stored yet)
      expect(resolveRandomizeAnchor(shared, 1_700_000_001_111, 1_700_000_002_222)).toBe(shared);
      expect(resolveRandomizeAnchor(shared, null, 1_700_000_002_999)).toBe(shared);
    });
  });

  describe('shouldShowPlayerCount', () => {
    it('hides the number (shows a pulse) when the count is unknown', () => {
      expect(shouldShowPlayerCount(null)).toBe(false);
    });

    it('shows the number once a real count is known', () => {
      expect(shouldShowPlayerCount(0)).toBe(false); // 0 is not a meaningful lobby count
      expect(shouldShowPlayerCount(1)).toBe(true);
      expect(shouldShowPlayerCount(6)).toBe(true);
      expect(shouldShowPlayerCount(10)).toBe(true);
    });
  });
});
