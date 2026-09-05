/**
 * BANANA RACE — client-safe half of lib/bananaRace.ts.
 *
 * Everything here is pure: types, the config constants, and the mock board
 * that /preview/banana-race renders. It imports NOTHING server-only (no
 * firebase-admin, no logger, no db), so a `'use client'` page can pull
 * `mockRaceBoard` in without dragging firebaseAdmin (fs/http2/net/tls) into the
 * browser bundle. lib/bananaRace.ts re-exports all of this, so existing
 * `@/lib/bananaRace` importers are unchanged. See bananaRace.ts for the full
 * feature write-up and the server-side tally / seats / board builders.
 */

export const RACE_CONFIG_DOC = { col: 'system_config', doc: 'bananaRace' } as const;
export const RACE_COLLECTION = 'banana_race';
export const RACE_FINAL_DOC = 'final';

/** Sat Sep 5 2026 12:00 AM PT (PDT = UTC-7). */
export const RACE_DEFAULT_START_ISO = '2026-09-05T07:00:00.000Z';
/** Tue Sep 8 2026 5:00 PM PT — points close, board freezes, draw runs. */
export const RACE_DEFAULT_END_ISO = '2026-09-09T00:00:00.000Z';
/** Tue Sep 8 2026 6:00 PM PT — every filled league drafts (fast clock). */
export const RACE_DEFAULT_DRAFT_ISO = '2026-09-09T01:00:00.000Z';
export const RACE_DEFAULT_TOP_N = 10;

export type SpecialTier = 'jackhof' | 'jackpot' | 'hof';
export const TIER_ORDER: readonly SpecialTier[] = ['jackhof', 'jackpot', 'hof'];
export const TIER_LABEL: Record<SpecialTier, string> = { jackhof: 'JackHOF', jackpot: 'Jackpot', hof: 'HOF' };

export interface BananaRaceConfig {
  enabled: boolean;
  startAtIso: string;
  endAtIso: string;
  draftAtIso: string;
  topN: number;
  /** Set by the freeze script: the board is served from banana_race/final. */
  frozen: boolean;
  /** Stamped by the toggle script on the first flip to ON. */
  launchAtIso: string | null;
}

// ── Tally ───────────────────────────────────────────────────────────────────

export interface RaceRow {
  /** Canonical person key: the lowest wallet of the linked group. */
  key: string;
  wallets: string[];
  name: string;
  points: number;
  /** ISO of the purchase that brought them to their current total (tie-break). */
  reachedAtIso: string;
}

export interface RaceTally {
  rows: RaceRow[];
  totals: { players: number; points: number };
  computedAtIso: string;
}

// ── Open seats ──────────────────────────────────────────────────────────────

export interface OpenLeague {
  tier: SpecialTier;
  roundId: number;
  draftId: string | null;
  source: string;
  members: string[];
  open: number;
}

export interface SeatSummary {
  byTier: Record<SpecialTier, { open: number; leagues: number }>;
  total: number;
  leagues: OpenLeague[];
}

// ── Board (what the page renders) ───────────────────────────────────────────

export interface BoardRow { rank: number; name: string; points: number; you: boolean; locked: boolean }

export interface RaceResults {
  frozenAtIso: string;
  topN: Array<{ rank: number; name: string; points: number }>;
  /** Every drawn seat, in draw order. */
  draw: Array<{ name: string; tier: SpecialTier; draftId: string | null; roundId: number; guaranteed: boolean }>;
  seatsFilled: number;
}

export interface RaceBoard {
  enabled: boolean;
  startAtIso: string;
  endAtIso: string;
  draftAtIso: string;
  topN: number;
  frozen: boolean;
  nowIso: string;
  seats: { byTier: SeatSummary['byTier']; total: number };
  board: BoardRow[];
  you: { rank: number; points: number; toCutoff: number; inTopN: boolean } | null;
  totals: { players: number; points: number };
  results: RaceResults | null;
}

/** Mock board for /preview/banana-race — every visual, no switch, no Firestore. */
export function mockRaceBoard(): RaceBoard {
  const names = ['Banana2210', 'BigBananaEnergy', 'Banana3311', 'PeelKing', 'Banana4102', 'SplitSecond', 'Banana5590', 'Nanerz', 'Banana6075', 'Banana4471', 'Banana7118', 'GoBananas', 'Banana8260', 'You', 'Banana8812', 'Banana9930', 'Banana7702', 'Banana6120'];
  const pts = [42, 31, 25, 22, 19, 16, 14, 12, 11, 10, 9, 8, 8, 7, 5, 3, 2, 1];
  const board = names.map((name, i) => ({ rank: i + 1, name, points: pts[i], you: name === 'You', locked: i < 10 }));
  return {
    enabled: true, startAtIso: RACE_DEFAULT_START_ISO, endAtIso: RACE_DEFAULT_END_ISO, draftAtIso: RACE_DEFAULT_DRAFT_ISO,
    topN: 10, frozen: false, nowIso: new Date().toISOString(),
    seats: { byTier: { jackhof: { open: 35, leagues: 5 }, jackpot: { open: 14, leagues: 2 }, hof: { open: 38, leagues: 5 } }, total: 87 },
    board,
    you: { rank: 14, points: 7, toCutoff: 4, inTopN: false },
    totals: { players: 18, points: pts.reduce((a, b) => a + b, 0) },
    results: null,
  };
}
