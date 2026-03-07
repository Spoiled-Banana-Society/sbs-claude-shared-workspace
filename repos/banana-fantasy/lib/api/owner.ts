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
  const blueCheckVerified =
    typeof owner.isBlueCheckVerified === 'boolean'
      ? owner.isBlueCheckVerified
      : typeof owner.IsBlueCheckVerified === 'boolean'
        ? owner.IsBlueCheckVerified
        : false;

  return {
    id: normalizeWalletAddress(walletAddress),
    username: owner.pfp?.displayName || fallbackUsernameFromWallet(walletAddress),
    walletAddress: normalizeWalletAddress(walletAddress),
    loginMethod: 'wallet',
    profilePicture: owner.pfp?.imageUrl,
    nflTeam: undefined,
    xHandle: undefined,
    // These counts should eventually come from draft tokens / promos.
    draftPasses: typeof owner.availableCredit === 'number' ? owner.availableCredit : 0,
    usdcBalance: 0, // Will be populated by on-chain read in useAuth
    freeDrafts: 0,
    wheelSpins: 0,
    jackpotEntries: 0,
    hofEntries: 0,
    isVerified: true,
    blueCheckEmail: typeof owner.blueCheckEmail === 'string' ? owner.blueCheckEmail : undefined,
    isBlueCheckVerified: blueCheckVerified,
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
        teamPosition: `${p.team} ${p.position}`,
        weeklyPoints: 0,
        seasonPoints: 0,
        projection: undefined,
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
    token.level === 'Jackpot' ? 'jackpot' : token.level === 'Hall of Fame' ? 'hof' : 'regular';

  const leagueRank = token.rank ? Number.parseInt(token.rank, 10) : 0;
  const seasonScore = token.seasonScore ? Number(token.seasonScore) : 0;
  const weeklyScore = token.weekScore ? Number(token.weekScore) : 0;

  return {
    id: token.leagueId || token.cardId,
    name: token.leagueDisplayName || `League ${token.leagueId || token.cardId}`,
    contestId: '',
    type: contestType,
    leagueRank: Number.isFinite(leagueRank) ? leagueRank : 0,
    weeklyRank: 0,
    weeklyScore: Number.isFinite(weeklyScore) ? weeklyScore : 0,
    seasonScore: Number.isFinite(seasonScore) ? seasonScore : 0,
    prizeIndicator: token.prizes?.USDC,
    status: token.leagueId ? 'active' : 'completed',
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
 * Also fetches draft token count so draftPasses reflects real available tokens.
 */
export async function getOwnerUser(walletAddress: string): Promise<User> {
  const [owner, tokens] = await Promise.all([
    getOwnerProfile(walletAddress),
    getOwnerDraftTokens(walletAddress).catch(() => [] as ApiDraftToken[]),
  ]);
  const availableTokens = tokens.filter(t => !t.leagueId);
  const user = mapOwnerProfileToUser(walletAddress, owner);
  user.draftPasses = availableTokens.length;
  user.freeDrafts = 0;
  return user;
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
  return tokens.map(mapDraftTokenToLeague);
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
