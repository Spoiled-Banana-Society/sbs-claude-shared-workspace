/**
 * League-related API calls:
 * - join/leave drafts
 * - leaderboards
 * - gameweek
 */

import type { DraftRoom, LeaderboardEntry } from '@/types';
import { ApiError, createHttpClient, normalizeWalletAddress } from './client';
import type { ApiDraftToken, ApiDraftTokenLevel } from './owner';
import { getDraftsApiUrl } from '@/lib/staging';

function draftsApi() {
  return createHttpClient({
    baseUrl: getDraftsApiUrl(),
  });
}

export type DraftSpeed = 'fast' | 'slow';
export type DraftPromoType = 'jackpot' | 'hof' | 'pro';

export type LeaderboardOrderBy = string;

/**
 * Join a draft (fast or slow).
 *
 * Backend endpoint: `POST /league/{draftType}/owner/{walletAddress}`
 */
export async function joinDraft(
  walletAddress: string,
  speed: DraftSpeed,
  numLeaguesToJoin: number = 1,
  draftType?: DraftPromoType,
  passType?: 'paid' | 'free',
): Promise<DraftRoom> {
  const wallet = normalizeWalletAddress(walletAddress);
  const controller = new AbortController();
  const timeoutMs = 20_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: unknown;
  try {
    res = await draftsApi().post<unknown>(
      `/league/${speed}/owner/${wallet}`,
      {
        numLeaguesToJoin,
        ...(draftType ? { draftType } : {}),
        passType: passType || 'paid',
      },
      { signal: controller.signal },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Join draft timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  // API returns an array of joined cards — unwrap first element
  const raw = Array.isArray(res) ? res[0] : res;
  const obj: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  // Best-effort mapping to the UI's `DraftRoom` type.
  // Expected fields vary; commonly includes `draftId` and/or `leagueId`.
  const draftId: string =
    String(obj._leagueId ?? obj.draftId ?? obj.draftName ?? obj.leagueId ?? obj.id ?? `${Date.now()}`);

  const maxPlayers: number = Number(obj.maxPlayers ?? obj.maxDrafters ?? 10) || 10;
  const players: number = Number(obj.players ?? obj.numPlayers ?? 1) || 1;
  const contestName: string = String(obj._leagueDisplayName ?? obj.displayName ?? obj.leagueDisplayName ?? 'Draft');
  const cardId: string = String(obj._cardId ?? obj.cardId ?? obj.tokenId ?? '');

  return {
    id: String(draftId),
    contestId: '',
    contestName,
    players,
    maxPlayers,
    status: 'filling',
    type: 'regular',
    entryFee: 0,
    draftSpeed: speed,
    cardId,
  };
}

/**
 * Leave a draft.
 *
 * Backend endpoint: `POST /league/{draftId}/actions/leave`
 */
export async function leaveDraft(draftId: string, walletAddress: string, tokenId?: string): Promise<void> {
  const wallet = normalizeWalletAddress(walletAddress);
  await draftsApi().post(`/league/${draftId}/actions/leave`, { ownerId: wallet, tokenId: tokenId || '' });
}

function mapLeaderboardTokenToEntry(
  token: ApiDraftToken,
  currentWallet?: string,
): LeaderboardEntry {
  const rank = token.rank ? Number.parseInt(token.rank, 10) : 0;
  const seasonScore = token.seasonScore ? Number(token.seasonScore) : 0;
  const weeklyScore = token.weekScore ? Number(token.weekScore) : 0;

  // Some responses include owner display name; if not, fall back to league display name.
  const tokenObj = token as Record<string, unknown>;
  const username =
    String(tokenObj.displayName ?? tokenObj.ownerDisplayName ?? token.leagueDisplayName ?? '—');

  return {
    rank: Number.isFinite(rank) ? rank : 0,
    username,
    teamName: token.leagueDisplayName || token.leagueId || token.cardId,
    seasonScore: Number.isFinite(seasonScore) ? seasonScore : 0,
    weeklyScore: Number.isFinite(weeklyScore) ? weeklyScore : 0,
    isCurrentUser: (() => {
      if (!currentWallet) return false;
      const ownerAddress = tokenObj.ownerAddress;
      return (
        typeof ownerAddress === 'string' &&
        normalizeWalletAddress(ownerAddress) === normalizeWalletAddress(currentWallet)
      );
    })(),
  };
}

/**
 * Fetch the current gameweek.
 */
export async function getCurrentGameweek(): Promise<number> {
  const res = await draftsApi().get<unknown>(`/league/getGameweek`);
  if (typeof res === 'number') return Number(res) || 0;
  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>;
    const gw = obj.gameweek ?? obj.currentGameweek;
    return Number(gw) || 0;
  }
  return 0;
}

/**
 * Fetch all leaderboards for an owner.
 *
 * Backend endpoint:
 * `GET /league/all/{walletAddress}/draftTokenLeaderboard/gameweek/{gameweek}/orderBy/{orderBy}/level/{level}`
 */
export async function getAllLeaderboards(
  walletAddress: string,
  gameweek: number,
  orderBy: LeaderboardOrderBy,
  level: ApiDraftTokenLevel | 'All' = 'All',
): Promise<LeaderboardEntry[]> {
  const wallet = normalizeWalletAddress(walletAddress);
  const lvl = level === 'All' ? 'All' : level;

  const tokens = await draftsApi().get<unknown>(
    `/league/all/${wallet}/draftTokenLeaderboard/gameweek/${gameweek}/orderBy/${orderBy}/level/${encodeURIComponent(
      lvl,
    )}`,
  );

  // The backend typically returns an array of draft tokens.
  let arr: ApiDraftToken[] = [];
  if (Array.isArray(tokens)) arr = tokens as ApiDraftToken[];
  else if (tokens && typeof tokens === 'object') {
    const data = (tokens as Record<string, unknown>).data;
    if (Array.isArray(data)) arr = data as ApiDraftToken[];
  }
  return arr.map((t) => mapLeaderboardTokenToEntry(t, walletAddress));
}

/**
 * Batch progress for the guaranteed distribution system.
 */
export interface BatchProgress {
  current: number;
  total: number;
  jackpotRemaining: number;
  hofRemaining: number;
  batchStart: number;
  filledLeaguesCount: number;
}

/**
 * Fetch the current batch progress for the guaranteed distribution indicator.
 *
 * Backend endpoint: `GET /league/batchProgress`
 */
export async function getBatchProgress(signal?: AbortSignal): Promise<BatchProgress> {
  const res = await draftsApi().get<BatchProgress>('/league/batchProgress', { signal });
  return res;
}

/**
 * Fetch a specific draft's leaderboard.
 *
 * Backend endpoint:
 * `GET /league/{walletAddress}/drafts/{draftId}/leaderboard/{orderBy}/gameweek/{gameweek}`
 */
export async function getLeagueLeaderboard(
  walletAddress: string,
  draftId: string,
  orderBy: LeaderboardOrderBy,
  gameweek: number,
): Promise<LeaderboardEntry[]> {
  const wallet = normalizeWalletAddress(walletAddress);

  const tokens = await draftsApi().get<unknown>(
    `/league/${wallet}/drafts/${draftId}/leaderboard/${orderBy}/gameweek/${gameweek}`,
  );

  let arr: ApiDraftToken[] = [];
  if (Array.isArray(tokens)) arr = tokens as ApiDraftToken[];
  else if (tokens && typeof tokens === 'object') {
    const data = (tokens as Record<string, unknown>).data;
    if (Array.isArray(data)) arr = data as ApiDraftToken[];
  }

  return arr.map((t) => mapLeaderboardTokenToEntry(t, walletAddress));
}

/**
 * Fill a staging league with bots.
 *
 * Backend endpoint: `POST /staging/fill-bots/{draftType}?count={count}`
 */
export async function stagingFillBots(speed: DraftSpeed, count: number = 9, leagueId?: string): Promise<unknown> {
  const query: Record<string, string | number> = { count };
  if (leagueId) query.leagueId = leagueId;
  return draftsApi().post<unknown>(`/staging/fill-bots/${speed}`, undefined, { query });
}

/**
 * Get the draft token level (Jackpot/Hall of Fame/Pro) for a specific league.
 *
 * Fetches user's draft tokens and finds the one matching the given league ID.
 */
export async function getDraftTokenLevel(
  walletAddress: string,
  leagueId: string,
): Promise<ApiDraftTokenLevel | null> {
  const { getOwnerDraftTokens } = await import('./owner');
  const tokens = await getOwnerDraftTokens(walletAddress);
  const match = tokens.find(t => t.leagueId === leagueId || t.cardId === leagueId);
  return match?.level ?? null;
}
