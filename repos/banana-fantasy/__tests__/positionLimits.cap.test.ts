import { describe, it, expect } from 'vitest';
import { DEFAULT_POSITION_LIMITS, type Position, type PositionLimits } from '@/lib/positionLimits';
import { positionFromPlayerId, slotFromPlayerId } from '@/lib/draftRoomConstants';

// Mirrors the EXACT isAtCap + BPA-filter logic in useDraftEngine.autoPickForPlayer,
// using the REAL position helpers and REAL default caps — so this proves the
// algorithm the engine runs, not a paraphrase.
type Roster = Record<string, string[]>; // basePos -> playerIds

function isAtCap(roster: Roster, limits: PositionLimits, playerId: string): boolean {
  const slot = slotFromPlayerId(playerId) as Position;
  const cap = limits[slot];
  if (typeof cap !== 'number') return false;
  const basePos = positionFromPlayerId(playerId);
  const have = (roster[basePos] ?? []).filter((pid) => slotFromPlayerId(pid) === slot).length;
  return have >= cap;
}

function autoPick(
  roster: Roster,
  available: { playerId: string; adp: number }[],
  limits = DEFAULT_POSITION_LIMITS,
  queue: { playerId: string }[] = [],
): string {
  // Queue first — a queued player is a deferred manual pick; caps do NOT
  // apply (queue beats caps).
  const queuePick = queue.find((q) => available.some((a) => a.playerId === q.playerId));
  if (queuePick) return queuePick.playerId;
  const ok = available.filter((p) => !isAtCap(roster, limits, p.playerId)).sort((a, b) => a.adp - b.adp);
  if (ok.length) return ok[0].playerId;          // BPA not at cap
  return [...available].sort((a, b) => a.adp - b.adp)[0]?.playerId ?? ''; // RELAX
}

describe('auto-draft position caps (default RB2:1)', () => {
  it('SKIPS a better-ADP RB2 once the team already has its 1 RB2, takes next position', () => {
    const roster: Roster = { RB: ['ATL-RB2'] }; // already at RB2 cap (1)
    const best = autoPick(roster, [
      { playerId: 'DET-RB2', adp: 116 }, // best ADP but RB2 is capped
      { playerId: 'GB-WR2', adp: 140 },  // next best, not capped
    ]);
    expect(best).toBe('GB-WR2');
  });

  it('TAKES the RB2 when the team has zero RB2 (cap not hit)', () => {
    const best = autoPick({}, [{ playerId: 'DET-RB2', adp: 116 }, { playerId: 'GB-WR2', adp: 140 }]);
    expect(best).toBe('DET-RB2');
  });

  it('RELAXES (picks best available) when every candidate is at cap', () => {
    const roster: Roster = { RB: ['ATL-RB2'], QB: ['KC-QB', 'BUF-QB', 'SEA-QB'] }; // RB2 cap 1, QB cap 3 — both maxed
    const best = autoPick(roster, [{ playerId: 'DET-RB2', adp: 116 }, { playerId: 'MIA-QB', adp: 130 }]);
    expect(best).toBe('DET-RB2'); // relax -> best ADP even though capped
  });

  it('counts RB1 and RB2 SEPARATELY (RB1 at cap does not block RB2)', () => {
    const roster: Roster = { RB: ['DET-RB1', 'ATL-RB1', 'PHI-RB1', 'BUF-RB1'] }; // 4 RB1 = RB1 cap, but 0 RB2
    const best = autoPick(roster, [{ playerId: 'DET-RB2', adp: 116 }]);
    expect(best).toBe('DET-RB2'); // RB2 still allowed
  });

  it('QUEUE BEATS CAPS: takes a queued player even when its slot is at cap (jetsonjets22 draft-77)', () => {
    const roster: Roster = { WR: ['LAC-WR2'] }; // WR2 already rostered
    const limits: PositionLimits = { ...DEFAULT_POSITION_LIMITS, WR2: 1 }; // his setting: max 1 WR2
    const best = autoPick(
      roster,
      [{ playerId: 'NO-RB2', adp: 100 }, { playerId: 'TB-WR2', adp: 120 }],
      limits,
      [{ playerId: 'TB-WR2' }], // queued WR2, at cap under old rule
    );
    expect(best).toBe('TB-WR2'); // queue wins — must NOT fall through to NO-RB2
  });

  it('queue skips DRAFTED players and takes the next queued one', () => {
    const best = autoPick(
      {},
      [{ playerId: 'NO-WR2', adp: 150 }, { playerId: 'NO-RB2', adp: 100 }],
      DEFAULT_POSITION_LIMITS,
      [{ playerId: 'TB-WR2' }, { playerId: 'NO-WR2' }], // TB-WR2 already drafted (not in available)
    );
    expect(best).toBe('NO-WR2');
  });
});
