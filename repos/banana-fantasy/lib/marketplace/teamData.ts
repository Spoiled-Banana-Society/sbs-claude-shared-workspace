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
const TEAM_NICKNAMES_COLLECTION = 'userTeamNicknames';

/**
 * Read a user's per-league nickname (if any) from Firestore. The owner
 * sets this via /api/owner/team-nicknames; once set, it's the team's
 * canonical name everywhere on our site.
 */
async function readOwnerNicknames(owner: string): Promise<Record<string, string>> {
  if (!isFirestoreConfigured() || !owner) return {};
  try {
    const db = getAdminFirestore();
    const snap = await db.collection(TEAM_NICKNAMES_COLLECTION).doc(owner.toLowerCase()).get();
    if (!snap.exists) return {};
    const data = snap.data();
    return (data?.nicknames as Record<string, string> | undefined) ?? {};
  } catch {
    return {};
  }
}

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
  _imageUrl?: string;
  roster?: Record<string, RosterPlayer[] | null | undefined>;
}

export interface TeamData {
  leagueId: string;
  leagueDisplayName: string;
  level: string;
  rank: string;
  seasonScore: string;
  weekScore: string;
  imageUrl: string;
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
 * Returns null if Firestore isn't configured, the doc is missing, doesn't
 * carry a leagueId, or was written by the (now-deprecated) heuristic
 * auto-sync — those entries are stale and ignored.
 */
async function readNftLeagueMap(tokenId: string): Promise<{ leagueId: string; ownerAtMap?: string } | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    const snap = await db.collection(NFT_LEAGUE_MAP_COLLECTION).doc(String(tokenId)).get();
    if (!snap.exists) return null;
    const leagueId = snap.get('leagueId') as string | undefined;
    if (!leagueId) return null;
    const mappedBy = snap.get('mappedBy') as string | undefined;
    if (mappedBy === 'auto-sync') return null;
    return { leagueId, ownerAtMap: snap.get('ownerAtMap') as string | undefined };
  } catch {
    return null;
  }
}

function backendTokenToTeamData(t: BackendDraftToken, source: TeamData['source']): TeamData | null {
  const leagueId = String(t._leagueId ?? '');
  // Server returns "BBB #N"; user-facing label is "BBB League #N" to avoid
  // collision with the BBB pass NFTs (e.g. "BBB Draft Pass #743").
  const rawDisplayName = String(t._leagueDisplayName ?? '');
  const leagueDisplayName = rawDisplayName.replace(/^BBB\s*#/, 'BBB League #');
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

  // Skip the default placeholder image — that's just the pre-draft token
  // graphic, not the actual team card. Empty string lets the UI fall back
  // to OpenSea's image (which is also typically the same placeholder, but
  // we don't want to falsely advertise this as the real card).
  const rawImage = String(t._imageUrl ?? '');
  const imageUrl = rawImage.includes('draft-token-image-default') ? '' : rawImage;

  return {
    leagueId,
    leagueDisplayName,
    level: String(t._level ?? 'Pro'),
    rank: t._rank != null ? String(t._rank) : '',
    seasonScore: t._seasonScore != null ? String(t._seasonScore) : '',
    weekScore: t._weekScore != null ? String(t._weekScore) : '',
    imageUrl,
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
  // Pre-load owner's custom team nicknames (one lookup, applied to whichever
  // path resolves the team below).
  const nicknames = owner ? await readOwnerNicknames(owner) : {};
  const applyNickname = (data: TeamData): TeamData => {
    const nickname = nicknames[data.leagueId];
    return nickname ? { ...data, leagueDisplayName: nickname } : data;
  };

  // 1. Deterministic cardId match — this is the ground truth from the
  //    Go API and always wins. Either exact (production) or staging-encoded.
  if (owner) {
    const token = await findTokenByCardIdMatch(owner, tokenId);
    if (token) {
      const data = backendTokenToTeamData(token, 'cardid_match');
      if (data) return applyNickname(data);
    }
  }

  // 2. Manual Firestore override — used only when the deterministic match
  //    can't find a record (e.g. NFT was traded and the new owner hasn't
  //    yet had their draft list refreshed, or staging-only edge cases).
  const mapped = await readNftLeagueMap(tokenId);
  if (mapped) {
    const lookupOwner = mapped.ownerAtMap || owner;
    const token = await findTokenByLeagueId(lookupOwner ?? null, mapped.leagueId);
    if (token) {
      const data = backendTokenToTeamData(token, 'firestore_map');
      if (data) return applyNickname(data);
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

  // 1. Group all (tokenId, owner) by owner so we hit /draftToken/all once
  //    per owner, then run the deterministic cardId match.
  const ownersToTokens = new Map<string, string[]>();
  for (const p of pairs) {
    if (!p.owner) continue;
    const lower = p.owner.toLowerCase();
    if (!ownersToTokens.has(lower)) ownersToTokens.set(lower, []);
    ownersToTokens.get(lower)!.push(p.tokenId);
  }

  const ownerTokenLists = await Promise.all(
    [...ownersToTokens.entries()].map(async ([owner, tokenIds]) => {
      try {
        const [res, nicknames] = await Promise.all([
          fetch(`${DRAFTS_API_BASE}/owner/${owner}/draftToken/all`, { signal: AbortSignal.timeout(3000) }),
          readOwnerNicknames(owner),
        ]);
        if (!res.ok) return { owner, tokenIds, tokens: [] as BackendDraftToken[], nicknames };
        const data = await res.json();
        const tokens: BackendDraftToken[] = [
          ...(Array.isArray(data?.active) ? data.active : []),
          ...(Array.isArray(data?.available) ? data.available : []),
        ];
        return { owner, tokenIds, tokens, nicknames };
      } catch {
        return { owner, tokenIds, tokens: [] as BackendDraftToken[], nicknames: {} as Record<string, string> };
      }
    }),
  );

  for (const { tokenIds, tokens, nicknames } of ownerTokenLists) {
    for (const tokenId of tokenIds) {
      const found = tokens.find(t => cardIdMatchesTokenId(String(t._cardId ?? ''), tokenId));
      if (!found) continue;
      const data = backendTokenToTeamData(found, 'cardid_match');
      if (!data) continue;
      const nickname = nicknames[data.leagueId];
      result.set(tokenId, nickname ? { ...data, leagueDisplayName: nickname } : data);
    }
  }

  // 2. Firestore manual override — only fills in tokens the cardId match
  //    couldn't resolve. Stale auto-sync entries are filtered out by
  //    readNftLeagueMap.
  const stillMissing = pairs.filter(p => !result.has(p.tokenId));
  await Promise.all(
    stillMissing.map(async (p) => {
      const mapping = await readNftLeagueMap(p.tokenId);
      if (!mapping) return;
      const lookupOwner = mapping.ownerAtMap || p.owner;
      if (!lookupOwner) return;
      const [token, nicknames] = await Promise.all([
        findTokenByLeagueId(lookupOwner, mapping.leagueId),
        readOwnerNicknames(lookupOwner),
      ]);
      if (!token) return;
      const data = backendTokenToTeamData(token, 'firestore_map');
      if (!data) return;
      const nickname = nicknames[data.leagueId];
      result.set(p.tokenId, nickname ? { ...data, leagueDisplayName: nickname } : data);
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
