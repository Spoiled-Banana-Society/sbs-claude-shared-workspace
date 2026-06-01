/**
 * Owner-related API calls.
 *
 * Endpoints documented in `API_INTEGRATION.md`.
 */

import type { League, RosterPlayer, User } from '@/types';
import { createHttpClient, normalizeWalletAddress } from './client';
import { getDraftsApiUrl } from '@/lib/staging';
import { bananaDefaultName } from '@/utils/helpers';

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

/**
 * The default display name shown when a user hasn't chosen one — an
 * on-brand `Banana #1234567` handle derived deterministically from the
 * wallet (7-digit space, ~9M values). Stable per user across devices
 * and sessions. See `bananaDefaultName` / `bananaNumberFromWallet` in
 * `utils/helpers.ts` for the hash + collision-math rationale.
 */
export function defaultDisplayName(walletAddress: string): string {
  return bananaDefaultName(normalizeWalletAddress(walletAddress));
}

/**
 * True when a stored display name isn't a real, user-chosen name —
 * empty, a leftover test placeholder, or any form of the wallet address
 * (raw, full, or truncated with a dot like `0x709.a4e9`). Exported so
 * useAuth can filter stale localStorage `savedProfile.username` values
 * from older code that wrote the truncated wallet there.
 */
export function isPlaceholderName(name: string | undefined | null, walletAddress: string): boolean {
  if (!name) return true;
  const t = name.trim();
  if (t === '') return true;
  if (['testname', 'testuser', 'test'].includes(t.toLowerCase())) return true;
  if (/^0x[0-9a-fA-F]{4,}/.test(t)) return true; // raw / partially-truncated wallet
  if (/^0x[0-9a-fA-F]+\.[0-9a-fA-F]+$/.test(t)) return true; // truncated `0x709.a4e9` form
  if (t.toLowerCase() === normalizeWalletAddress(walletAddress).toLowerCase()) return true;
  return false;
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
    username: isPlaceholderName(owner.pfp?.displayName, walletAddress)
      ? defaultDisplayName(walletAddress)
      : (owner.pfp as { displayName: string }).displayName,
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
    cardFeeCreditCents: 0,
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

  // League name = backend displayName ("BBB #N" → "League #N"), which uses
  // the GLOBAL FilledLeaguesCount that increments across both fast and slow
  // drafts. That's the number a user sees on the draft-results page header,
  // on their NFT in OpenSea, and in the 764/800 counter on /standings.
  //
  // The old workaround derived the number from the draftId trailing digits
  // (e.g. "2024-fast-draft-753" → "League #753"), but that's the per-type
  // counter — it diverges from the BBB # number as soon as any slow drafts
  // fill. Same draft labelled "League #764" on one page and "League #753"
  // on another. Fixed: trust the displayName. Verified May 14 2026: no
  // duplicate displayNames across recent drafts (the older race the
  // workaround feared was fixed by the txHash-as-doc-id work in Phase 15).
  const leagueId = token.leagueId || token.cardId;
  const rawDisplayName = (token.leagueDisplayName || '').trim();
  const name = rawDisplayName
    ? rawDisplayName.replace(/^BBB\s*#/, 'League #')
    : (() => {
        // Defensive fallback only — should never hit for a well-formed
        // backend response. Pull the number off the draftId if there's
        // truly no displayName.
        const num = leagueId.match(/(\d+)$/)?.[1];
        return num ? `League #${num}` : `League ${leagueId}`;
      })();

  // Real chronology comes from the timestamp embedded in cardId — modern
  // cards use a 13-digit Unix ms (e.g. "1777581797653" or
  // "staging-1772408844125-19"). Sorting by leagueId trailing digits is
  // unreliable on staging because the backend recycles ID ranges (a draft
  // with leagueId 1609 can be older than one with leagueId 737). Older
  // cards use 5-digit serials (e.g. "90099") with no timestamp — those
  // get an empty draftDate and the standings sort treats them as older
  // than any timestamped card, falling back to trailing-id ordering for
  // tie-breaking among themselves.
  const draftDate = (() => {
    const cardId = token.cardId || '';
    // Year 2001+ in ms = 13 digits starting with 1; year 2286 ends 13-digit
    // territory. Anything shorter than 12 digits isn't a real timestamp.
    const msMatch = cardId.match(/\d{12,13}/);
    if (msMatch) {
      const ms = Number(msMatch[0]);
      if (Number.isFinite(ms) && ms > 946684800000) return new Date(ms).toISOString();
    }
    return '';
  })();

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
    draftDate,
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
    user.cardFeeCreditCents = balance.cardFeeCreditCents;
    if (balance.nflTeam) user.nflTeam = balance.nflTeam;
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
  cardFeeCreditCents: number;
  nflTeam: string | null;
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
      cardFeeCreditCents: typeof data.cardFeeCreditCents === 'number' ? data.cardFeeCreditCents : 0,
      nflTeam: typeof data.nflTeam === 'string' ? data.nflTeam : null,
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

  // Status (completed vs active) is derived from the roster already present
  // on each token (mapDraftTokenToLeague: a full 15-pick roster = completed).
  // We intentionally do NOT call getDraftInfo per league here — that was an
  // N+1 (one extra API call per league, ~10 per page load) that Sentry flagged
  // on /exposure, and it only re-derived the same completed/active answer the
  // roster already gives us. One token fetch above is now the whole cost.
  return leagueTokens.map(mapDraftTokenToLeague);
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
