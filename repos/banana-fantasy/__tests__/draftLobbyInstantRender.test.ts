import { describe, it, expect } from 'vitest';
import { computeInitialPlayerCount, shouldShowPlayerCount } from '@/lib/draftRoomLobby';

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
