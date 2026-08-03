/**
 * The board must agree with itself.
 *
 * Fantasy Couch sat in row 2 of the survivors and read "You · #3" underneath it
 * at the same moment (ticket-2661, 2026-08-01). He was tied at 58 Bananas with
 * AeroSpace, and the two arrays the board builds — survivors (from the burn
 * record's order) and the viewer's rank (from the list's Firestore doc order) —
 * sorted that tie differently, because `sort` is stable and keeps whatever order
 * the source array had.
 *
 * These tests pin the invariant rather than the symptom: whatever rank the
 * viewer's own ROW shows, "You · #N" must show the same number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: {
  players: Array<{ userId: string; bananas: number; onList: boolean; streak: number }>;
  survivorIds: string[];
  lastBurnIndex: number;
} = { players: [], survivorIds: [], lastBurnIndex: -1 };

/** Minimal Firestore stand-in: only the reads getLeaderboard actually makes. */
function fakeDb() {
  const snap = (data: unknown, id = '') => ({ id, data: () => data, exists: data != null });
  return {
    collection(name: string) {
      return {
        doc: (id: string) => ({
          id,
          get: async () => snap(
            name === 'eliminator_days'
              ? { status: 'open', lastBurnIndex: state.lastBurnIndex }
              : undefined,
            id,
          ),
          collection: (sub: string) => ({
            get: async () => ({
              docs: sub === 'players' ? state.players.map((p) => snap(p, p.userId)) : [],
            }),
            doc: () => ({
              get: async () => snap({ survivors: state.survivorIds }),
            }),
          }),
        }),
      };
    },
    // resolveNames: hand back a username per user doc.
    getAll: async (...refs: Array<{ id: string }>) =>
      refs.map((r) => snap({ username: `name-${r.id}` }, r.id)),
  };
}

vi.mock('@/lib/firebaseAdmin', () => ({
  isFirestoreConfigured: () => true,
  getAdminFirestore: () => fakeDb(),
}));

const { getLeaderboard } = await import('@/lib/eliminator');

/** Mid-afternoon PT on a live day — past the open, well before the 9pm close. */
const NOW = Date.UTC(2026, 7, 1, 23, 41); // 4:41pm PT

beforeEach(() => {
  state.lastBurnIndex = 0;
  // Doc order deliberately differs from the burn record's order below.
  state.players = [
    { userId: '0xaaa', bananas: 59, onList: true, streak: 5 },
    { userId: '0xbbb', bananas: 58, onList: true, streak: 5 }, // the viewer
    { userId: '0xccc', bananas: 58, onList: true, streak: 5 }, // tied with them
    { userId: '0xddd', bananas: 54, onList: true, streak: 5 },
    { userId: '0xeee', bananas: 38, onList: true, streak: 1 },
  ];
  // The burn wrote its survivors in ITS order — the tied pair reversed.
  state.survivorIds = ['0xccc', '0xbbb', '0xaaa', '0xddd', '0xeee'];
});

describe('eliminator leaderboard ranks', () => {
  it('gives the viewer the same rank their own row shows, tied or not', async () => {
    const board = await getLeaderboard('0xbbb', NOW);
    const myRow = board.survivors.find((r) => r.userId === '0xbbb');
    expect(myRow).toBeDefined();
    expect(board.you?.rank).toBe(myRow!.rank);
  });

  it('ranks every player identically in the survivors block and in "Show all"', async () => {
    const board = await getLeaderboard('0xbbb', NOW);
    for (const r of board.survivors) {
      expect(board.all.find((a) => a.userId === r.userId)?.rank).toBe(r.rank);
    }
  });

  it('breaks Banana ties the same way no matter what order the source is in', async () => {
    const forward = await getLeaderboard('0xbbb', NOW);
    state.survivorIds = [...state.survivorIds].reverse();
    state.players = [...state.players].reverse();
    const reversed = await getLeaderboard('0xbbb', NOW);
    expect(reversed.all.map((r) => r.userId)).toEqual(forward.all.map((r) => r.userId));
    expect(reversed.you?.rank).toBe(forward.you?.rank);
  });

  it('agrees with itself before the first burn too', async () => {
    state.lastBurnIndex = -1;
    state.survivorIds = [];
    const board = await getLeaderboard('0xccc', NOW);
    const myRow = board.all.find((r) => r.userId === '0xccc');
    expect(board.you?.rank).toBe(myRow!.rank);
  });

  it('still ranks an off-list viewer below everyone on it', async () => {
    state.players.push({ userId: '0xfff', bananas: 12, onList: false, streak: 0 });
    const board = await getLeaderboard('0xfff', NOW);
    expect(board.you?.onList).toBe(false);
    expect(board.you?.rank).toBe(5 + 1);
  });
});
