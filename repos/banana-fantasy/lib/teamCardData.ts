// Builds TeamCardObsidian player rows from draft data.
// Joins a drafted playerId with ALL_POSITIONS for bye/ADP, so the
// generating screen shows the same bye/ADP the roster + NFT use.

import { ALL_POSITIONS } from '@/data/nfl-players';
import type { CardPlayer } from '@/components/draft/TeamCardObsidian';

const byId = new Map(ALL_POSITIONS.map((p) => [p.playerId, p]));

/** One drafted pick → a card row. `pick` is the overall draft pick number. */
export function toCardPlayer(playerId: string, position: string, pick: number | string): CardPlayer {
  const meta = byId.get(playerId);
  const [team, posFromId] = playerId.split('-');
  return {
    team: team || '',
    pos: position || posFromId || '',
    bye: meta?.byeWeek ?? '-',
    adp: meta?.adp ?? '-',
    pick: pick ?? '-',
  };
}

export interface RawPick {
  playerId: string;
  position: string;
  pick: number | string;
}

/** Map a list of drafted picks to card rows, in pick order. */
export function toCardPlayers(picks: RawPick[]): CardPlayer[] {
  return picks.map((p) => toCardPlayer(p.playerId, p.position, p.pick));
}
