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
    // Position comes from the playerId FIRST — it's the actual drafted player
    // ("DAL-WR2" → "WR2"), same source the final NFT card parses. The passed
    // `position` is the engine's ROSTER-SLOT label (e.g. a WR2 pick sitting in
    // your first WR slot reads "WR1"), so preferring it made the generating
    // screen drop every "2" (DAL WR2 → DAL WR1) until the real card loaded and
    // corrected it. playerId wins; `position` is only a fallback for a malformed id.
    pos: posFromId || position || '',
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

/**
 * Resolve the "Team #" — the BBB4 NFT token id — from an owner draft token,
 * the SAME way the desktop roster page does it (app/draft-results), so the
 * generating screen, roster, and card all show the identical number.
 *
 * Source of truth, in order:
 *  1. `realTokenId` — the real on-chain token id (preferred once minted).
 *  2. `cardId` — `staging-X-N` style ids keep just the numeric suffix.
 * Legacy ms-timestamp ids (>100k) are rejected → '' (showing a 13-digit
 * number is worse than showing nothing). Never parses an image URL — that
 * was the bug: a pre-reveal pass URL has no token id, so the card lost TEAM #.
 */
export function teamNoFromToken(token: { realTokenId?: string | null; cardId?: string | null } | null | undefined): string {
  if (!token) return '';
  const rtid = token.realTokenId != null ? String(token.realTokenId) : '';
  if (/^\d+$/.test(rtid)) {
    const n = Number(rtid);
    if (Number.isFinite(n) && n > 0 && n <= 100_000) return String(n);
  }
  const cardId = token.cardId != null ? String(token.cardId) : '';
  if (!cardId) return '';
  const candidate = cardId.includes('-') ? (cardId.split('-').pop() ?? '') : cardId;
  if (!candidate || !/^\d+$/.test(candidate)) return '';
  const n = Number(candidate);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return '';
  return String(n);
}
