/**
 * Owner-related API calls.
 *
 * Endpoints documented in `API_INTEGRATION.md`.
 */

import type { League, RosterPlayer, User } from '@/types';
import { createHttpClient, normalizeWalletAddress } from './client';
import { getDraftsApiUrl } from '@/lib/staging';

function draftsApi() {
  return createHttpClient({
    baseUrl: getDraftsApiUrl(),
  });
}

/** Backend shape from `GET /owner/{walletAddress}`. */
export interface ApiOwnerProfile {
  availableCredit: number;
  /**
   * USDC credit available for purchases/entries.
   *
   * Note: some backend environments may still return `availableEthCredit`.
   */
  availableUsdcCredit?: number;
  /** @deprecated Kept for backwards compatibility with older backend payloads. */
  availableEthCredit?: number;
  leagues: Array<{ leagueId: string; cardId: string }>;
  pfp?: {
    imageUrl?: string;
    nftContract?: string;
    displayName?: string;
  };
  blueCheckEmail?: string;
  isBlueCheckVerified?: boolean;
  IsBlueCheckVerified?: boolean;
  [k: string]: unknown;
}

export type ApiDraftTokenLevel = 'Pro' | 'Hall of Fame' | 'Jackpot';

export interface ApiRosterPlayer {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress?: string;
  pickNum?: number;
  round?: number;
  scoreWeek?: number;
  scoreSeason?: number;
  isUsedInCardScore?: boolean;
  [k: string]: unknown;
}

/** Backend shape from `GET /owner/{walletAddress}/draftToken/all`. */
export interface ApiDraftToken {
  cardId: string;
  leagueId: string;
  leagueDisplayName?: string;
  roster?: {
    QB?: ApiRosterPlayer[];
    RB?: ApiRosterPlayer[];
    WR?: ApiRosterPlayer[];
    TE?: ApiRosterPlayer[];
    DST?: ApiRosterPlayer[];
    [k: string]: ApiRosterPlayer[] | undefined;
  };
  level: ApiDraftTokenLevel;
  rank?: string;
  seasonScore?: string;
  weekScore?: string;
  prizes?: { USDC?: number; [k: string]: unknown };
  passType?: string;
  [k: string]: unknown;
}

function fallbackUsernameFromWallet(walletAddress: string): string {
  const a = normalizeWalletAddress(walletAddress);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * Convert backend owner profile → UI `User` type.
 *
 * Note: SBS backend does not currently provide all `User` fields used by the UI.
 * Missing fields are filled with safe defaults.
 */
export function mapOwnerProfileToUser(walletAddress: string, owner: ApiOwnerProfile): User {
  return {
    id: normalizeWalletAddress(walletAddress),
    username: owner.pfp?.displayName || fallbackUsernameFromWallet(walletAddress),
    walletAddress: normalizeWalletAddress(walletAddress),
    loginMethod: 'wallet',
    profilePicture: owner.pfp?.imageUrl,
    nflTeam: undefined,
    xHandle: undefined,
    draftPasses: typeof owner.availableCredit === 'number' ? owner.availableCredit : 0,
    usdcBalance: 0,
    freeDrafts: 0,
    wheelSpins: 0,
    jackpotEntries: 0,
    hofEntries: 0,
    cardPurchaseCount: 0,
    isVerified: true,
    createdAt: new Date().toISOString(),
  };
}

function mapRosterToUiRoster(roster?: ApiDraftToken['roster']): RosterPlayer[] {
  const out: RosterPlayer[] = [];
  if (!roster) return out;

  const pushGroup = (slotPrefix: string, players: ApiRosterPlayer[] | undefined) => {
    if (!players?.length) return;
    players.forEach((p, idx) => {
      // Create stable-ish slot labels like QB, RB1/RB2, WR1/WR2/WR3, etc.
      const slot = idx === 0 ? slotPrefix : `${slotPrefix}${idx + 1}`;
      out.push({
        slot,
        teamPosition: `${p.team} ${p.position || slotPrefix}`,
        weeklyPoints: typeof p.scoreWeek === 'number' ? p.scoreWeek : 0,
        seasonPoints: typeof p.scoreSeason === 'number' ? p.scoreSeason : 0,
        isInLineup: Boolean(p.isUsedInCardScore),
        playerName: p.displayName || undefined,
      });
    });
  };

  pushGroup('QB', roster.QB);
  pushGroup('RB', roster.RB);
  pushGroup('WR', roster.WR);
  pushGroup('TE', roster.TE);
  pushGroup('DST', roster.DST);

  return out;
}

/**
 * Convert backend draft token → UI `League` type.
 *
 * This is a best-effort mapping for the current UI. Some fields have no
 * backend equivalent yet and are defaulted.
 */
export function mapDraftTokenToLeague(token: ApiDraftToken): League {
  const contestType =
    token.level === 'Jackpot' ? 'jackpot' : token.level === 'Hall of Fame' ? 'hof' : 'pro';

  const leagueRank = token.rank ? Number.parseInt(token.rank, 10) : 0;
  const seasonScore = token.seasonScore ? Number(token.seasonScore) : 0;
  const weeklyScore = token.weekScore ? Number(token.weekScore) : 0;

  // Derive league name from league ID (e.g. "2025-fast-draft-1201" → "League #1201")
  // The backend displayName field has a bug where multiple leagues get the same name,
  // so we use the league ID number as the source of truth.
  const leagueId = token.leagueId || token.cardId;
  const leagueNum = leagueId.match(/(\d+)$/)?.[1];
  const name = leagueNum ? `League #${leagueNum}` : (token.leagueDisplayName || `League ${leagueId}`);

  return {
    id: leagueId,
    name,
    contestId: '',
    type: contestType,
    leagueRank: Number.isFinite(leagueRank) ? leagueRank : 0,
    weeklyRank: 0,
    weeklyScore: Number.isFinite(weeklyScore) ? weeklyScore : 0,
    seasonScore: Number.isFinite(seasonScore) ? seasonScore : 0,
    prizeIndicator: token.prizes?.USDC,
    status: (() => {
      if (!token.leagueId) return 'completed';
      // A draft with a full 15-player roster is completed
      if (token.roster) {
        const count = (token.roster.QB?.length || 0) + (token.roster.RB?.length || 0)
          + (token.roster.WR?.length || 0) + (token.roster.TE?.length || 0) + (token.roster.DST?.length || 0);
        if (count >= 15) return 'completed';
      }
      return 'active';
    })(),
    roster: mapRosterToUiRoster(token.roster),
    draftDate: new Date().toISOString(),
  };
}

/**
 * Fetch owner profile.
 * @example
 *   const user = await getOwnerUser(wallet)
 */
export async function getOwnerProfile(walletAddress: string): Promise<ApiOwnerProfile> {
  const wallet = normalizeWalletAddress(walletAddress);
  return draftsApi().get<ApiOwnerProfile>(`/owner/${wallet}`);
}

/**
 * Fetch owner profile and map to UI `User`.
 *
 * `draftPasses` comes from `/api/owner/balance` (Firestore-backed) — the
 * single source of truth that the SSE stream also pushes from. Using the
 * Go API's "available tokens" count here would disagree with the SSE
 * value the moment a Firestore-only mint or use endpoint runs (staging
 * mints, draft entry's use-pass decrement, etc.), causing the header to
 * flicker between values across reload + SSE-connect events.
 *
 * Falls back to the Go API count only if the balance endpoint is
 * unreachable, so a transient outage still shows something reasonable.
 */
export async function getOwnerUser(walletAddress: string): Promise<User> {
  const [owner, balance] = await Promise.all([
    getOwnerProfile(walletAddress),
    fetchBalanceCounters(walletAddress),
  ]);
  const user = mapOwnerProfileToUser(walletAddress, owner);
  if (balance) {
    user.draftPasses = balance.draftPasses;
    user.freeDrafts = balance.freeDrafts;
    user.wheelSpins = balance.wheelSpins;
    user.jackpotEntries = balance.jackpotEntries;
    user.hofEntries = balance.hofEntries;
    user.cardPurchaseCount = balance.cardPurchaseCount;
  } else {
    // Balance endpoint unreachable — fall back to Go API token count for
    // draftPasses so the header isn't completely blank.
    const tokens = await getOwnerDraftTokens(walletAddress).catch(() => [] as ApiDraftToken[]);
    user.draftPasses = tokens.filter(t => !t.leagueId).length;
    user.freeDrafts = 0;
  }
  return user;
}

interface BalanceCounters {
  wheelSpins: number;
  freeDrafts: number;
  jackpotEntries: number;
  hofEntries: number;
  draftPasses: number;
  cardPurchaseCount: number;
}

async function fetchBalanceCounters(walletAddress: string): Promise<BalanceCounters | null> {
  try {
    const wallet = normalizeWalletAddress(walletAddress);
    const res = await fetch(`/api/owner/balance?userId=${encodeURIComponent(wallet)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BalanceCounters>;
    return {
      wheelSpins: typeof data.wheelSpins === 'number' ? data.wheelSpins : 0,
      freeDrafts: typeof data.freeDrafts === 'number' ? data.freeDrafts : 0,
      jackpotEntries: typeof data.jackpotEntries === 'number' ? data.jackpotEntries : 0,
      hofEntries: typeof data.hofEntries === 'number' ? data.hofEntries : 0,
      draftPasses: typeof data.draftPasses === 'number' ? data.draftPasses : 0,
      cardPurchaseCount: typeof data.cardPurchaseCount === 'number' ? data.cardPurchaseCount : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch draft tokens (draft passes) for an owner.
 *
 * Backend returns `{ available: [...], active: [...] }` with underscore-prefixed
 * fields (`_cardId`, `_leagueId`, `_level`, etc.). This function flattens both
 * arrays and normalizes field names to match the `ApiDraftToken` interface.
 */
export async function getOwnerDraftTokens(walletAddress: string): Promise<ApiDraftToken[]> {
  const wallet = normalizeWalletAddress(walletAddress);
  const raw: unknown = await draftsApi().get<unknown>(`/owner/${wallet}/draftToken/all`);

  // Flatten { available, active } → single array
  let rawTokens: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    rawTokens = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const available = Array.isArray(obj.available) ? obj.available : [];
    const active = Array.isArray(obj.active) ? obj.active : [];
    rawTokens = [...active, ...available];
  }

  // Normalize underscore-prefixed fields → ApiDraftToken shape
  return rawTokens.map((t): ApiDraftToken => ({
    cardId: String(t._cardId ?? t.cardId ?? ''),
    leagueId: String(t._leagueId ?? t.leagueId ?? ''),
    leagueDisplayName: String(t._leagueDisplayName ?? t.leagueDisplayName ?? ''),
    level: (t._level ?? t.level ?? 'Pro') as ApiDraftTokenLevel,
    rank: t._rank != null ? String(t._rank) : t.rank != null ? String(t.rank) : undefined,
    seasonScore: t._seasonScore != null ? String(t._seasonScore) : t.seasonScore != null ? String(t.seasonScore) : undefined,
    weekScore: t._weekScore != null ? String(t._weekScore) : t.weekScore != null ? String(t.weekScore) : undefined,
    roster: (t.roster ?? undefined) as ApiDraftToken['roster'],
    prizes: (t.prizes ?? undefined) as ApiDraftToken['prizes'],
    ...t, // Preserve any extra fields
  }));
}

/**
 * Fetch draft tokens and map them to UI `League[]`.
 *
 * This is useful for pages that show a user's active leagues/teams.
 */
export async function getOwnerLeaguesFromDraftTokens(walletAddress: string): Promise<League[]> {
  const tokens = await getOwnerDraftTokens(walletAddress);
  // Only map tokens that are in a league — available/unused tokens are not leagues
  // Deduplicate by leagueId — multiple tokens can be linked to the same league
  const seen = new Set<string>();
  const leagueTokens = tokens.filter(t => {
    if (!t.leagueId || seen.has(t.leagueId)) return false;
    seen.add(t.leagueId);
    return true;
  });

  // Check draft completion status for each league via draft info API
  const leagues = await Promise.all(
    leagueTokens.map(async (token) => {
      const league = mapDraftTokenToLeague(token);
      // Check if the draft is actually complete (all 150 picks made)
      try {
        const { getDraftInfo } = await import('@/lib/draftApi');
        const info = await getDraftInfo(token.leagueId);
        league.status = info.pickNumber >= 150 ? 'completed' : 'active';
      } catch {
        // If draft info unavailable, fall back to roster-based detection
      }
      return league;
    })
  );

  return leagues;
}

/**
 * Update owner's display name.
 */
export async function updateOwnerDisplayName(walletAddress: string, displayName: string): Promise<void> {
  const wallet = normalizeWalletAddress(walletAddress);
  await draftsApi().post(`/owner/${wallet}/update/displayName`, { displayName });
}

/**
 * Update owner's profile picture (PFP) image URL.
 */
export async function updateOwnerPfpImage(walletAddress: string, imageUrl: string): Promise<void> {
  const wallet = normalizeWalletAddress(walletAddress);
  await draftsApi().post(`/owner/${wallet}/update/pfpImage`, { imageUrl });
}

/**
 * Mint new draft tokens (draft passes).
 *
 * Note: request body may vary between environments; adjust as backend finalizes.
 */
export async function mintOwnerDraftTokens(walletAddress: string, quantity: number): Promise<unknown> {
  const wallet = normalizeWalletAddress(walletAddress);
  return draftsApi().post(`/owner/${wallet}/draftToken/mint`, { numberOfTokens: quantity });
}
