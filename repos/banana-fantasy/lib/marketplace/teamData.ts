/**
 * SBS-first team data lookup for marketplace.
 *
 * Our backend is the source of truth for team metadata (league name, rank,
 * roster, scores). OpenSea is only authoritative for ownership and the
 * listing orderbook. This module reconciles tokenId → team data via:
 *
 *   1. Manual override:   Firestore  `nft_league_map/{tokenId}` (admin-set)
 *   2. cardId match:      Go API     `/owner/{wallet}/draftToken/all`,
 *                         match record where `_cardId === tokenId`
 *
 * Path 2 covers production where mint stores the on-chain tokenId as
 * `_cardId`. Path 1 is the escape hatch for cases where the IDs aren't
 * linked (staging admin mints, future trades that desync, etc.).
 *
 * Output is OpenSea-shaped synthetic traits the existing trait-reading
 * UI picks up automatically (LEAGUE-NAME, LEVEL, RANK, SEASON-SCORE,
 * WEEK-SCORE, plus QB1/RB1/WR1/... roster slots).
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT, COLLECTION_SLUG } from '@/lib/opensea';

const DRAFTS_API_BASE = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

const NFT_LEAGUE_MAP_COLLECTION = 'nft_league_map';

// Per-process dedup so we don't re-run auto-sync for the same owner on every
// route invocation. Resets on Vercel cold starts, which is fine — the worst
// case is one redundant sync per cold start.
const autoSyncedOwners = new Set<string>();

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
 * Fetch a single draft token from Go API by exact `_cardId === tokenId`.
 * Returns null if no match — common in staging where cardIds are timestamps.
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
    return tokens.find(t => String(t._cardId ?? '') === tokenId) ?? null;
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
 * Auto-pair an owner's unmapped NFTs with their unmapped active draft
 * tokens. Used when staging mints decouple `_cardId` from the on-chain
 * tokenId — without this, the marketplace would just show "Draft Pass #N"
 * for every NFT until an admin manually maps each one.
 *
 * Heuristic: tokenId asc → leagueId asc. Not provably correct (the join
 * order may not match the mint order), but produces a complete coverage
 * the user can correct via the admin tool if anything is wrong.
 *
 * Best-effort: silently bails on any error so it never blocks enrichment.
 */
async function autoSyncOwnerMappings(owner: string): Promise<void> {
  if (!owner) return;
  const lower = owner.toLowerCase();
  if (autoSyncedOwners.has(lower)) return;
  autoSyncedOwners.add(lower);

  if (!isFirestoreConfigured() || !OPENSEA_API_KEY) return;

  try {
    // 1. Fetch the owner's NFTs from OpenSea (by contract+owner).
    const nftRes = await fetch(
      `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/account/${lower}/nfts?collection=${COLLECTION_SLUG}&limit=200`,
      {
        headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!nftRes.ok) return;
    const nftData = await nftRes.json();
    const nfts: Array<{ identifier: string; contract?: string }> = (nftData.nfts ?? []).filter(
      (n: { contract?: string }) => !n.contract || n.contract.toLowerCase() === BBB4_CONTRACT.toLowerCase(),
    );
    const tokenIds = nfts
      .map(n => String(n.identifier))
      .filter(t => /^\d+$/.test(t))
      .sort((a, b) => Number(a) - Number(b));
    if (tokenIds.length === 0) return;

    // 2. Fetch the owner's active draft tokens from the Go API.
    const tokensRes = await fetch(`${DRAFTS_API_BASE}/owner/${lower}/draftToken/all`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!tokensRes.ok) return;
    const tokensJson = await tokensRes.json();
    const activeRaw: BackendDraftToken[] = Array.isArray(tokensJson?.active) ? tokensJson.active : [];
    // Only consider drafts that have actually completed/joined (have a league name).
    const activeWithLeague = activeRaw
      .filter(t => String(t._leagueDisplayName ?? '').trim() !== '' && String(t._leagueId ?? '').trim() !== '')
      // Sort by leagueId asc so pairing is stable across runs.
      .sort((a, b) => String(a._leagueId ?? '').localeCompare(String(b._leagueId ?? '')));
    if (activeWithLeague.length === 0) return;

    // 3. Read existing mappings for these tokenIds and figure out which
    //    leagueIds are already claimed by other tokens.
    const db = getAdminFirestore();
    const existing = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const snap = await db.collection(NFT_LEAGUE_MAP_COLLECTION).doc(tokenId).get();
        return { tokenId, leagueId: snap.exists ? (snap.get('leagueId') as string | undefined) : undefined };
      }),
    );
    const claimedLeagueIds = new Set(existing.map(e => e.leagueId).filter(Boolean) as string[]);
    const unmappedTokenIds = existing.filter(e => !e.leagueId).map(e => e.tokenId);
    const availableLeagues = activeWithLeague.filter(l => !claimedLeagueIds.has(String(l._leagueId)));

    if (unmappedTokenIds.length === 0 || availableLeagues.length === 0) return;

    // 4. Pair tokenId asc → leagueId asc and write the mappings.
    const writes = Math.min(unmappedTokenIds.length, availableLeagues.length);
    const batch = db.batch();
    for (let i = 0; i < writes; i++) {
      const tokenId = unmappedTokenIds[i];
      const league = availableLeagues[i];
      const ref = db.collection(NFT_LEAGUE_MAP_COLLECTION).doc(tokenId);
      batch.set(ref, {
        tokenId,
        leagueId: String(league._leagueId),
        ownerAtMap: lower,
        mappedAt: Date.now(),
        mappedBy: 'auto-sync',
      }, { merge: true });
    }
    await batch.commit();
  } catch {
    // Silent — auto-sync is best-effort. Admin tool covers manual override.
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
  // 0. First-touch auto-sync: pair owner's unmapped NFTs with their active
  //    drafts so subsequent lookups have something to read. No-op in prod
  //    (cardId match already works there) and on subsequent calls within
  //    the same Vercel instance.
  if (owner) await autoSyncOwnerMappings(owner);

  // 1. Manual Firestore override always wins (admin-set or auto-synced)
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

  // First-touch auto-sync per unique owner (deduped per process)
  const uniqueOwners = [...new Set(pairs.map(p => p.owner).filter(Boolean) as string[])];
  await Promise.all(uniqueOwners.map(o => autoSyncOwnerMappings(o)));

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
      const found = tokens.find(t => String(t._cardId ?? '') === tokenId);
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
