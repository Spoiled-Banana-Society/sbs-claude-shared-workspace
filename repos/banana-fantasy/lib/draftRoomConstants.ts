// Draft room shared constants

// Re-export player data from dedicated data file
export { ALL_POSITIONS } from '@/data/nfl-players';
export type { PlayerData } from '@/data/nfl-players';

export type DraftType = 'jackpot' | 'hof' | 'pro';
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
export function generateReelItemsForReel(resultType: DraftType, reelIndex: number, totalItems: number = 50): DraftType[] {
  const items: DraftType[] = [];
  for (let i = 0; i < totalItems; i++) {
    const rand = Math.random();
    if (rand < 0.15) items.push('jackpot');
    else if (rand < 0.35) items.push('hof');
    else items.push('pro');
  }
  const landingIndex = totalItems - 8;
  if (resultType === 'pro') {
    // Pro = no 3-of-a-kind match. Show a mixed combo so it doesn't look like a win.
    const proLandings: DraftType[] = ['pro', 'jackpot', 'hof'];
    items[landingIndex] = proLandings[reelIndex];
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
