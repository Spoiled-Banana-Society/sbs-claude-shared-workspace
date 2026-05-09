/**
 * SBS-first team data lookup for marketplace.
 *
 * Our backend is the source of truth for team metadata (league name, rank,
 * roster, scores). OpenSea is only authoritative for ownership and the
 * listing orderbook. This module reconciles tokenId → team data via:
 *
 *   1. Manual override:   Firestore `nft_league_map/{tokenId}` (admin-set,
 *                         used when an explicit override is needed).
 *   2. cardId match:      Go API `/owner/{wallet}/draftToken/all`, where
 *                         the cardId is *deterministically* derived from
 *                         the on-chain tokenId — either as an exact match
 *                         (production) or as `<10-digit unix-seconds mint
 *                         timestamp><tokenId>` (staging encoding).
 *
 * No heuristics, no guessing. If the Go API has no record matching the
 * tokenId via these encodings, the marketplace shows "Draft Pass #N" —
 * which is honest: the NFT exists on-chain but hasn't been linked to a
 * league.
 *
 * Output is OpenSea-shaped synthetic traits the existing trait-reading
 * UI picks up automatically (LEAGUE-NAME, LEVEL, RANK, SEASON-SCORE,
 * WEEK-SCORE, plus QB1/RB1/WR1/... roster slots).
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const DRAFTS_API_BASE = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

const NFT_LEAGUE_MAP_COLLECTION = 'nft_league_map';

export interface NftTrait {
  trait_type: string;
  value: string | number;
}

interface RosterPlayer {
  team?: string;
  position?: string;
  displayName?: string;
}

interface BackendDraftToken {
  _cardId?: string | number;
  _leagueId?: string;
  _leagueDisplayName?: string;
  _level?: string;
  _rank?: string | number;
  _seasonScore?: string | number;
  _weekScore?: string | number;
  roster?: Record<string, RosterPlayer[] | null | undefined>;
}

export interface TeamData {
  leagueId: string;
  leagueDisplayName: string;
  level: string;
  rank: string;
  seasonScore: string;
  weekScore: string;
  roster: RosterPlayer[];
  source: 'cardid_match' | 'firestore_map';
}

const ROSTER_POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST'] as const;

/**
 * Does this Go-API cardId correspond to the given on-chain tokenId?
 *
 * Two encodings supported:
 *   1. Exact match: `_cardId === tokenId` (production — the on-chain
 *      tokenId is stored verbatim as the cardId).
 *   2. Staging encoding: `<10-digit unix-seconds mint timestamp><tokenId>`.
 *      The Go API's mint helper concatenates a per-batch timestamp prefix
 *      with the on-chain tokenId, e.g. `1776734420` + `292` = `1776734420292`.
 *      This deterministically links cardId → tokenId without any heuristic.
 */
function cardIdMatchesTokenId(cardId: string, tokenId: string): boolean {
  if (!cardId || !tokenId) return false;
  if (cardId === tokenId) return true;
  if (cardId.length !== 10 + tokenId.length) return false;
  if (!cardId.endsWith(tokenId)) return false;
  return /^\d{10}$/.test(cardId.slice(0, 10));
}

/**
 * Fetch a single draft token from Go API for the given on-chain tokenId.
 * Returns null if the Go API has no draft record for this NFT — happens
 * for newly minted passes that haven't entered a draft yet.
 */
async function findTokenByCardIdMatch(owner: string, tokenId: string): Promise<BackendDraftToken | null> {
  if (!owner) return null;
  try {
    const res = await fetch(`${DRAFTS_API_BASE}/owner/${owner.toLowerCase()}/draftToken/all`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tokens: BackendDraftToken[] = [
      ...(Array.isArray(data?.active) ? data.active : []),
      ...(Array.isArray(data?.available) ? data.available : []),
    ];
    return tokens.find(t => cardIdMatchesTokenId(String(t._cardId ?? ''), tokenId)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a draft token by leagueId — used after the Firestore mapping
 * resolves the tokenId to a leagueId, when we need the full record but
 * don't necessarily know the current owner.
 */
async function findTokenByLeagueId(owner: string | null, leagueId: string): Promise<BackendDraftToken | null> {
  if (!owner) return null;
  try {
    const res = await fetch(`${DRAFTS_API_BASE}/owner/${owner.toLowerCase()}/draftToken/all`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tokens: BackendDraftToken[] = [
      ...(Array.isArray(data?.active) ? data.active : []),
      ...(Array.isArray(data?.available) ? data.available : []),
    ];
    return tokens.find(t => String(t._leagueId ?? '') === leagueId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the manual `nft_league_map/{tokenId}` override from Firestore.
 * Returns null if Firestore isn't configured, the doc is missing, or it
 * doesn't carry a leagueId.
 */
async function readNftLeagueMap(tokenId: string): Promise<{ leagueId: string; ownerAtMap?: string } | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    const snap = await db.collection(NFT_LEAGUE_MAP_COLLECTION).doc(String(tokenId)).get();
    if (!snap.exists) return null;
    const leagueId = snap.get('leagueId') as string | undefined;
    if (!leagueId) return null;
    return { leagueId, ownerAtMap: snap.get('ownerAtMap') as string | undefined };
  } catch {
    return null;
  }
}

function backendTokenToTeamData(t: BackendDraftToken, source: TeamData['source']): TeamData | null {
  const leagueId = String(t._leagueId ?? '');
  const leagueDisplayName = String(t._leagueDisplayName ?? '');
  if (!leagueDisplayName && !leagueId) return null;

  const roster: RosterPlayer[] = [];
  if (t.roster) {
    for (const pos of ROSTER_POS_ORDER) {
      const players = t.roster[pos];
      if (Array.isArray(players)) {
        for (const p of players) {
          if (p?.team) roster.push({ team: p.team, position: p.position ?? pos, displayName: p.displayName });
        }
      }
    }
  }

  return {
    leagueId,
    leagueDisplayName,
    level: String(t._level ?? 'Pro'),
    rank: t._rank != null ? String(t._rank) : '',
    seasonScore: t._seasonScore != null ? String(t._seasonScore) : '',
    weekScore: t._weekScore != null ? String(t._weekScore) : '',
    roster,
    source,
  };
}

/**
 * Resolve team data for a single tokenId. `owner` is the current on-chain
 * owner (used to query their draftToken list). Returns null if no team
 * data is linked yet.
 */
export async function getTeamForToken(tokenId: string, owner: string | null): Promise<TeamData | null> {
  // 1. Manual Firestore override always wins (admin-set)
  const mapped = await readNftLeagueMap(tokenId);
  if (mapped) {
    const lookupOwner = mapped.ownerAtMap || owner;
    const token = await findTokenByLeagueId(lookupOwner ?? null, mapped.leagueId);
    if (token) {
      const data = backendTokenToTeamData(token, 'firestore_map');
      if (data) return data;
    }
    // We know the leagueId but couldn't find the full record. Return minimal
    // data so the UI still gets a name.
    return {
      leagueId: mapped.leagueId,
      leagueDisplayName: '',
      level: 'Pro',
      rank: '',
      seasonScore: '',
      weekScore: '',
      roster: [],
      source: 'firestore_map',
    };
  }

  // 2. cardId match (production path)
  if (owner) {
    const token = await findTokenByCardIdMatch(owner, tokenId);
    if (token) {
      const data = backendTokenToTeamData(token, 'cardid_match');
      if (data) return data;
    }
  }

  return null;
}

/**
 * Bulk resolve team data for a list of (tokenId, owner) pairs. Groups by
 * owner so we hit `/owner/{wallet}/draftToken/all` at most once per owner.
 */
export async function getTeamsForTokens(
  pairs: Array<{ tokenId: string; owner: string | null }>,
): Promise<Map<string, TeamData>> {
  const result = new Map<string, TeamData>();

  // Pre-fetch all manual mappings in parallel
  const mappings = await Promise.all(
    pairs.map(async (p) => ({ tokenId: p.tokenId, mapping: await readNftLeagueMap(p.tokenId) })),
  );
  const mappingByToken = new Map(mappings.map(m => [m.tokenId, m.mapping]));

  // Group remaining (no manual mapping) by owner for one fetch each
  const ownersToTokens = new Map<string, string[]>();
  for (const p of pairs) {
    if (mappingByToken.get(p.tokenId)) continue;
    if (!p.owner) continue;
    const lower = p.owner.toLowerCase();
    if (!ownersToTokens.has(lower)) ownersToTokens.set(lower, []);
    ownersToTokens.get(lower)!.push(p.tokenId);
  }

  const ownerTokenLists = await Promise.all(
    [...ownersToTokens.entries()].map(async ([owner, tokenIds]) => {
      try {
        const res = await fetch(`${DRAFTS_API_BASE}/owner/${owner}/draftToken/all`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return { owner, tokenIds, tokens: [] as BackendDraftToken[] };
        const data = await res.json();
        const tokens: BackendDraftToken[] = [
          ...(Array.isArray(data?.active) ? data.active : []),
          ...(Array.isArray(data?.available) ? data.available : []),
        ];
        return { owner, tokenIds, tokens };
      } catch {
        return { owner, tokenIds, tokens: [] as BackendDraftToken[] };
      }
    }),
  );

  // cardId-match path
  for (const { tokenIds, tokens } of ownerTokenLists) {
    for (const tokenId of tokenIds) {
      const found = tokens.find(t => cardIdMatchesTokenId(String(t._cardId ?? ''), tokenId));
      if (!found) continue;
      const data = backendTokenToTeamData(found, 'cardid_match');
      if (data) result.set(tokenId, data);
    }
  }

  // Firestore-map path
  await Promise.all(
    pairs.map(async (p) => {
      const mapping = mappingByToken.get(p.tokenId);
      if (!mapping) return;
      const lookupOwner = mapping.ownerAtMap || p.owner;
      const token = lookupOwner ? await findTokenByLeagueId(lookupOwner, mapping.leagueId) : null;
      if (token) {
        const data = backendTokenToTeamData(token, 'firestore_map');
        if (data) { result.set(p.tokenId, data); return; }
      }
      result.set(p.tokenId, {
        leagueId: mapping.leagueId,
        leagueDisplayName: '',
        level: 'Pro',
        rank: '',
        seasonScore: '',
        weekScore: '',
        roster: [],
        source: 'firestore_map',
      });
    }),
  );

  return result;
}

/**
 * Convert TeamData to OpenSea-shaped traits so existing trait-reading UI
 * lights up. Skips empty fields so we don't overwrite real OpenSea traits.
 */
export function teamDataToTraits(team: TeamData): NftTrait[] {
  const traits: NftTrait[] = [];
  if (team.leagueDisplayName) traits.push({ trait_type: 'LEAGUE-NAME', value: team.leagueDisplayName });
  if (team.level) traits.push({ trait_type: 'LEVEL', value: team.level });
  if (team.rank) traits.push({ trait_type: 'RANK', value: team.rank });
  if (team.seasonScore) traits.push({ trait_type: 'SEASON-SCORE', value: team.seasonScore });
  if (team.weekScore) traits.push({ trait_type: 'WEEK-SCORE', value: team.weekScore });

  // Roster slots — mirror the convention used in opensea.ts (QB1, RB1, WR1, ...)
  const slotCounts: Record<string, number> = {};
  for (const p of team.roster) {
    const pos = p.position ?? 'X';
    slotCounts[pos] = (slotCounts[pos] ?? 0) + 1;
    const slot = `${pos}${slotCounts[pos]}`;
    traits.push({ trait_type: slot, value: `${p.team ?? ''} ${p.position ?? ''}`.trim() });
  }

  return traits;
}

/**
 * Merge synthetic team traits into an existing OpenSea trait list.
 * Real OpenSea traits win on conflict — synthetic only fills gaps.
 */
export function mergeTraits(existing: NftTrait[], synthetic: NftTrait[]): NftTrait[] {
  const have = new Set(existing.map(t => t.trait_type));
  return [...existing, ...synthetic.filter(t => !have.has(t.trait_type))];
}
