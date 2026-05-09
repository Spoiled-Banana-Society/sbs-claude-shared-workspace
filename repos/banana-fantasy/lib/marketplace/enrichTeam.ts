/**
 * Server-side enrichment helpers for marketplace NFTs.
 *
 * OpenSea NFT metadata isn't always refreshed promptly after a draft,
 * so the LEAGUE-NAME / RANK / roster traits on the NFT may be stale or
 * missing. Fall back to the SBS Go API (`/owner/{wallet}/draftToken/all`)
 * and inject synthetic traits so the existing trait-reading UI lights up.
 */

const DRAFTS_API_BASE = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

export interface NftTrait {
  trait_type: string;
  value: string | number;
}

interface RosterPlayer {
  team?: string;
  position?: string;
}

interface BackendToken {
  _cardId?: string | number;
  cardId?: string | number;
  _leagueDisplayName?: string;
  leagueDisplayName?: string;
  _level?: string;
  level?: string;
  _rank?: string | number;
  rank?: string | number;
  _seasonScore?: string | number;
  seasonScore?: string | number;
  _weekScore?: string | number;
  weekScore?: string | number;
  roster?: Record<string, RosterPlayer[] | undefined>;
}

const ROSTER_POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;

/**
 * Fetch all draft tokens for an owner and return a tokenId → token map.
 * Returns empty map on any failure.
 */
export async function fetchOwnerTokenMap(owner: string): Promise<Map<string, BackendToken>> {
  if (!owner) return new Map();
  try {
    const res = await fetch(`${DRAFTS_API_BASE}/owner/${owner.toLowerCase()}/draftToken/all`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return new Map();
    const data = await res.json();
    const tokens: BackendToken[] = [
      ...(Array.isArray(data?.active) ? data.active : []),
      ...(Array.isArray(data?.available) ? data.available : []),
    ];
    const map = new Map<string, BackendToken>();
    for (const t of tokens) {
      const cardId = String(t._cardId ?? t.cardId ?? '');
      if (cardId) map.set(cardId, t);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Build OpenSea-shaped traits from a backend token record.
 * Skips fields that are missing/empty so they don't overwrite real traits.
 */
export function syntheticTraitsFromBackend(t: BackendToken): NftTrait[] {
  const traits: NftTrait[] = [];

  const leagueName = t._leagueDisplayName ?? t.leagueDisplayName;
  if (leagueName) traits.push({ trait_type: 'LEAGUE-NAME', value: String(leagueName) });

  const level = t._level ?? t.level;
  if (level) traits.push({ trait_type: 'LEVEL', value: String(level) });

  const rank = t._rank ?? t.rank;
  if (rank != null && rank !== '') traits.push({ trait_type: 'RANK', value: String(rank) });

  const seasonScore = t._seasonScore ?? t.seasonScore;
  if (seasonScore != null && seasonScore !== '') {
    traits.push({ trait_type: 'SEASON-SCORE', value: String(seasonScore) });
  }

  const weekScore = t._weekScore ?? t.weekScore;
  if (weekScore != null && weekScore !== '') {
    traits.push({ trait_type: 'WEEK-SCORE', value: String(weekScore) });
  }

  if (t.roster) {
    for (const pos of ROSTER_POS_ORDER) {
      const players = t.roster[pos];
      if (!Array.isArray(players)) continue;
      players.forEach((p, i) => {
        const slot = `${pos}${i + 1}`;
        const team = p?.team ?? '';
        const position = p?.position ?? pos;
        if (team) traits.push({ trait_type: slot, value: `${team} ${position}` });
      });
    }
  }

  return traits;
}

/**
 * Merge synthetic backend traits into an existing OpenSea trait list.
 * Real OpenSea traits win on conflict — we only fill in what's missing.
 */
export function mergeTraits(existing: NftTrait[], extra: NftTrait[]): NftTrait[] {
  const have = new Set(existing.map(t => t.trait_type));
  return [...existing, ...extra.filter(t => !have.has(t.trait_type))];
}
