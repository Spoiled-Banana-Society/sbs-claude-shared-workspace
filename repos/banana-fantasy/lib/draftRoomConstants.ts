// Draft room shared constants

// Re-export player data from dedicated data file
export { ALL_POSITIONS } from '@/data/nfl-players';
export type { PlayerData } from '@/data/nfl-players';

// 'jackhof' = Jackpot + HOF landed on the SAME draft (rolling-windows system,
// ~1 in 800) — dual-type, both perks. Server-sent only; never generated locally.
export type DraftType = 'jackpot' | 'hof' | 'pro' | 'jackhof';
export type RoomPhase = 'filling' | 'pre-spin' | 'spinning' | 'result' | 'countdown' | 'drafting' | 'completed' | 'loading';

// ==================== POSITION COLORS ====================
export const POSITION_COLORS: Record<string, string> = {
  QB: '#FF474C',   // red
  RB: '#3c9120',   // green
  WR: '#cb6ce6',   // purple
  TE: '#326cf8',   // blue
  DST: '#DF893E',  // orange
};

// ==================== HELPERS ====================

/** Extracts base position from playerId: "KC-QB" → "QB", "DAL-WR1" → "WR" */
export function positionFromPlayerId(id: string): string {
  const pos = id.split('-')[1] || '';
  return pos.replace(/[0-9]/g, '');
}

/** Extracts the TIERED slot position: "DAL-WR1" → "WR1", "KC-QB" → "QB".
 *  Used by the auto-draft caps, which limit each tier (WR1/WR2/RB1/RB2)
 *  separately rather than lumping all WRs/RBs together. */
export function slotFromPlayerId(id: string): string {
  return id.split('-')[1] || '';
}

/** Returns hex color for a position (handles WR1/WR2 → WR, RB1/RB2 → RB) */
export function getPositionColorHex(pos: string): string {
  const base = pos.replace(/[0-9]/g, '');
  return POSITION_COLORS[base] || '#888888';
}

// ==================== DRAFT PLAYERS ====================
export const DRAFT_PLAYERS = [
  { id: '1', name: 'You', displayName: 'You', isYou: true, avatar: '🍌' },
  { id: '2', name: 'GridironKing', displayName: 'GridironKing', isYou: false, avatar: '🍌' },
  { id: '3', name: 'TouchdownTitan', displayName: 'TD Titan', isYou: false, avatar: '🍌' },
  { id: '4', name: 'Diamond', displayName: 'Diamond', isYou: false, avatar: '🍌' },
  { id: '5', name: 'MoonBoi', displayName: 'MoonBoi', isYou: false, avatar: '🍌' },
  { id: '6', name: 'BlitzMaster', displayName: 'BlitzMaster', isYou: false, avatar: '🍌' },
  { id: '7', name: 'EndZoneKing', displayName: 'EndZoneKing', isYou: false, avatar: '🍌' },
  { id: '8', name: 'Holder', displayName: 'Holder', isYou: false, avatar: '🍌' },
  { id: '9', name: 'Gridiron', displayName: 'Gridiron', isYou: false, avatar: '🍌' },
  { id: '10', name: 'DraftKing', displayName: 'DraftKing', isYou: false, avatar: '🍌' },
];

export const DRAFT_TYPES = {
  jackpot: { label: 'JACKPOT', color: '#ef4444', bgClass: 'bg-red-600' },
  hof: { label: 'HALL OF FAME', color: '#D4AF37', bgClass: 'bg-yellow-600' },
  pro: { label: 'PRO', color: '#a855f7', bgClass: 'bg-purple-600' },
  jackhof: { label: 'JACKHOF', color: '#ef4444', bgClass: 'bg-red-600' },
};

export const TOTAL_ROUNDS = 15;
export const TOTAL_PICKS = TOTAL_ROUNDS * 10; // 150

// ==================== POSITION PILL STYLES ====================
export const POSITION_PILL_STYLES: Record<string, string> = {
  QB: 'bg-[#FF474C]/20 text-[#FF474C]',
  RB: 'bg-[#3c9120]/20 text-[#3c9120]',
  WR: 'bg-[#cb6ce6]/20 text-[#cb6ce6]',
  TE: 'bg-[#326cf8]/20 text-[#326cf8]',
  DST: 'bg-[#DF893E]/20 text-[#DF893E]',
};

// ==================== TAILWIND-COMPATIBLE POSITION COLORS ====================
export function getPositionColor(pos: string) {
  const base = pos.replace(/[0-9]/g, '');
  switch (base) {
    case 'QB': return { bg: 'bg-[#FF474C]', text: 'text-[#FF474C]', light: 'bg-[#FF474C]/20' };
    case 'RB': return { bg: 'bg-[#3c9120]', text: 'text-[#3c9120]', light: 'bg-[#3c9120]/20' };
    case 'WR': return { bg: 'bg-[#cb6ce6]', text: 'text-[#cb6ce6]', light: 'bg-[#cb6ce6]/20' };
    case 'TE': return { bg: 'bg-[#326cf8]', text: 'text-[#326cf8]', light: 'bg-[#326cf8]/20' };
    case 'DST': return { bg: 'bg-[#DF893E]', text: 'text-[#DF893E]', light: 'bg-[#DF893E]/20' };
    default: return { bg: 'bg-gray-500', text: 'text-gray-400', light: 'bg-gray-500/20' };
  }
}

// ==================== SLOT MACHINE HELPERS ====================
// The reveal must look IDENTICAL for every member of a given draft. The draft
// type itself comes from the server (consistent), but the slot symbols used to
// be rolled with Math.random() in each browser — so for a Pro draft one person
// saw "🍌 JP HOF" and another saw "JP JP 🍌". Seeding every roll from the
// shared draftId makes the whole reveal deterministic and identical for all
// participants, while still looking random and varying from draft to draft.
//
// This PRNG is COSMETIC ONLY — it has no fairness/security role (the real,
// provably-fair draft type is decided server-side via Chainlink VRF).
function hashStringToSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One shared mixed combo per Pro spin. Computed on reel 0 and read by reels
// 1 & 2 so the three independent generateReelItemsForReel calls stay in sync.
// (Only used on the legacy no-seed path; the seeded path derives it directly.)
let _proLandingCombo: DraftType[] = ['pro', 'jackpot', 'hof'];

function makeProLandingCombo(rand: () => number, allowJackhof: boolean): DraftType[] {
  // Rolling era (>= 201): no banana anywhere — a Pro spin lands a mixed
  // no-match combo of the three WIN symbols (Richard 2026-07-20). Pre-201
  // keeps the original pool where 'pro' renders as 🍌.
  const pool: DraftType[] = allowJackhof
    ? ['jackpot', 'hof', 'jackhof']
    : ['pro', 'jackpot', 'hof'];
  let combo: DraftType[];
  do {
    combo = [0, 1, 2].map(() => pool[Math.floor(rand() * pool.length)]);
  } while (combo[0] === combo[1] && combo[1] === combo[2]); // never 3-of-a-kind
  return combo;
}

export function generateReelItemsForReel(
  resultType: DraftType,
  reelIndex: number,
  totalItems: number = 50,
  // The shared draft id. When provided, the entire reel is derived
  // deterministically so every participant sees the same symbols. Omitted →
  // falls back to Math.random (preserves old behavior for any other caller).
  seed?: string,
  // JackHOF filler is gated to the rolling-windows era (league # >= 201) —
  // Richard 2026-07-21: no JackHOF sightings in reels before draft 201.
  allowJackhof: boolean = false,
): DraftType[] {
  // Per-reel filler stream: seeded by (draft, reel) so the three reels look
  // independent from each other but are identical across every participant.
  const fillerRand = seed
    ? mulberry32(hashStringToSeed(`${seed}:reel:${reelIndex}`))
    : Math.random;

  const items: DraftType[] = [];
  for (let i = 0; i < totalItems; i++) {
    const rand = fillerRand();
    if (allowJackhof) {
      // Rolling era (>= 201): banana is OUT of the reels entirely (Richard
      // 2026-07-20). Only the three win symbols spin — JackHOF stays the
      // rare tease, Jackpot/HOF split the rest.
      if (rand < 0.10) items.push('jackhof');
      else if (rand < 0.55) items.push('jackpot');
      else items.push('hof');
    } else {
      // Pre-201 path consumes the SAME rand and keeps the ORIGINAL 15/20/65
      // split, so pre-201 reels are byte-identical to what shipped before.
      if (rand < 0.15) items.push('jackpot');
      else if (rand < 0.35) items.push('hof');
      else items.push('pro');
    }
  }
  const landingIndex = totalItems - 8;
  if (resultType === 'pro') {
    // Pro = no 3-of-a-kind match. Show a mixed combo (never a triple, so it
    // can't look like a win). With a seed, derive it from the SHARED draft id
    // (same for all three reels, order-independent) so every participant lands
    // on the identical symbols. Without a seed, keep the legacy shared-module
    // behavior (combo computed on reel 0, read by reels 1 & 2).
    if (seed) {
      const combo = makeProLandingCombo(mulberry32(hashStringToSeed(`${seed}:combo`)), allowJackhof);
      items[landingIndex] = combo[reelIndex] ?? (allowJackhof ? 'jackpot' : 'pro');
    } else {
      if (reelIndex === 0) _proLandingCombo = makeProLandingCombo(Math.random, allowJackhof);
      items[landingIndex] = _proLandingCombo[reelIndex] ?? (allowJackhof ? 'jackpot' : 'pro');
    }
  } else {
    items[landingIndex] = resultType;
  }
  return items;
}

export function generateReelResults(): DraftType[] {
  const results: DraftType[] = [];
  for (let i = 0; i < 3; i++) {
    const rand = Math.random();
    if (rand < 0.01) results.push('jackpot');
    else if (rand < 0.06) results.push('hof');
    else results.push('pro');
  }
  // Ensure at least one non-pro symbol for visual interest
  if (results.every(r => r === 'pro')) {
    const randomIndex = Math.floor(Math.random() * 3);
    (results as DraftType[])[randomIndex] = Math.random() < 0.17 ? 'jackpot' : 'hof';
  }
  return results;
}

// ==================== DRAFT PICK INTERFACE ====================
export interface DraftPick {
  pickNumber: number;
  round: number;
  pickInRound: number;
  ownerName: string;
  ownerIndex: number;
  playerId: string;
  position: string;
  team: string;
}

// Legacy Pick interface for slot machine overlay compatibility
export interface Pick {
  round: number;
  pickInRound: number;
  overallPick: number;
  playerId: string;
  selection: { id: string; team: string; position: string; adp: number };
}

// ==================== ROSTER TYPE ====================
export interface PositionRoster {
  QB: string[];
  RB: string[];
  WR: string[];
  TE: string[];
  DST: string[];
}
