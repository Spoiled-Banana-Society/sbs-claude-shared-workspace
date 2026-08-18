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
import { assertClientCanDraft } from '@/lib/draftBlock';

function draftsApi() {
  return createHttpClient({
    baseUrl: getDraftsApiUrl(),
  });
}

export type DraftSpeed = 'fast' | 'slow';

export type LeaderboardOrderBy = string;

/**
 * Join a draft (fast or slow).
 *
 * Backend endpoint: `POST /league/{speed}/owner/{walletAddress}`
 *
 * IMPORTANT (fairness): the client MUST NOT be able to choose the draft TYPE
 * (Jackpot/HOF/Pro). Type is decided solely by the backend's provably-fair
 * guaranteed-distribution logic. A previous "promo draft type" feature let the
 * client pass `draftType` in this body to force a Jackpot/HOF outcome — that
 * was a rigged-outcome vector and has been removed everywhere. Do not add a
 * draftType/promoType argument back to this call.
 */
export async function joinDraft(
  walletAddress: string,
  speed: DraftSpeed,
  numLeaguesToJoin: number = 1,
  passType?: 'paid' | 'free',
): Promise<DraftRoom> {
  assertClientCanDraft(); // admin drafting block — never reaches Go
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

  return mapJoinResponse(res, speed);
}

/**
 * Join a password-gated PRIVATE league (ticket-3338 groups). Same Go seat
 * path as the public join — the only differences are the endpoint (the
 * password rides the body) and that the backend picks the league (the
 * group's currently-filling draft) instead of the walk-forward matchmaker.
 * Response shape matches the public join (array with the seated card), so
 * the same mapping applies.
 */
export async function joinPrivateDraft(
  walletAddress: string,
  privateLeagueId: string,
  password: string,
  speed: DraftSpeed,
  passType?: 'paid' | 'free',
): Promise<DraftRoom> {
  assertClientCanDraft(); // admin drafting block — never reaches Go
  const wallet = normalizeWalletAddress(walletAddress);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let res: unknown;
  try {
    res = await draftsApi().post<unknown>(
      `/league/private/${encodeURIComponent(privateLeagueId)}/join/${wallet}`,
      {
        password,
        passType: passType || 'paid',
        // Honored by 'both'-lane leagues; single-lane leagues ignore it.
        speed,
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

  return mapJoinResponse(res, speed);
}

export interface PrivateLeagueBatch {
  batch: number;
  commitHash: string;
  createdAt: string;
  revealed: boolean;
  saltHex?: string;
  jackpotPosition?: number;
  hofPositions?: number[];
}

export interface PrivateLeagueDraftRow {
  draftId: string;
  displayName: string;
  level: string;
  numPlayers: number;
  filled: boolean;
  draftType?: DraftSpeed;
}

export interface PrivateLeagueInfo {
  id: string;
  name: string;
  /** 'fast' | 'slow' | 'both' — 'both' = a fast lane and a slow lane side by side. */
  draftType: DraftSpeed | 'both';
  /** Lanes offered, in display order (older backends omit → derive from draftType). */
  lanes?: DraftSpeed[];
  draftsFilled: number;
  /** Fast lane's filling draft (legacy field); use currentDrafts for every lane. */
  currentDraft?: PrivateLeagueDraftRow;
  currentDrafts?: Partial<Record<DraftSpeed, PrivateLeagueDraftRow | null>>;
  drafts: PrivateLeagueDraftRow[];
  batches: PrivateLeagueBatch[];
  batchSize: number;
  jackpotPer100: number;
  hofPer100: number;
}

/**
 * Password-gated league page payload. Throws ApiError with status 403 on a
 * wrong password, 404 on an unknown league id.
 */
export async function getPrivateLeagueInfo(
  privateLeagueId: string,
  password: string,
  signal?: AbortSignal,
): Promise<PrivateLeagueInfo> {
  return draftsApi().post<PrivateLeagueInfo>(
    `/league/private/${encodeURIComponent(privateLeagueId)}/info`,
    { password },
    { signal },
  );
}

/** Shared response mapping for the public and private join endpoints. */
function mapJoinResponse(res: unknown, speed: DraftSpeed): DraftRoom {
  // API returns an array of joined cards — unwrap first element
  const raw = Array.isArray(res) ? res[0] : res;
  const obj: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  // Best-effort mapping to the UI's `DraftRoom` type.
  // Expected fields vary; commonly includes `draftId` and/or `leagueId`.
  // A successful join ALWAYS carries one of these id fields. If none is present
  // the response is malformed/failed — throw instead of fabricating a fake id
  // (the old `${Date.now()}` fallback spawned a phantom draft and could waste a
  // pass). This only affects the broken-response case; a real join is unchanged.
  const resolvedId = obj._leagueId ?? obj.draftId ?? obj.draftName ?? obj.leagueId ?? obj.id;
  if (resolvedId === undefined || resolvedId === null || resolvedId === '') {
    throw new Error('Join did not return a draft — please try again.');
  }
  const draftId: string = String(resolvedId);

  const maxPlayers: number = Number(obj.maxPlayers ?? obj.maxDrafters ?? 10) || 10;
  const players: number = Number(obj.players ?? obj.numPlayers ?? 1) || 1;
  // Server returns "BBB #N"; user-facing label is plain "League #N".
  // "BBB" is internal jargon for Banana Best Ball — confusing in the UI,
  // and stripping it doesn't collide with the BBB pass NFTs because those
  // are now labeled "Team #N" (the on-chain tokenId), not "BBB #N".
  const rawName: string = String(obj._leagueDisplayName ?? obj.displayName ?? obj.leagueDisplayName ?? 'Draft');
  const contestName = rawName.replace(/^BBB\s*#/, 'League #');
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
/**
 * A batch draft that has FILLED but whose slot machine hasn't landed yet.
 * The dashboard adds its JP/HOF deduction BACK until `atMs`, so a Jackpot/HOF
 * never shows as hit before its slot reveal — refresh-proof, since this is
 * recomputed server-side from shared state on every (re)connect.
 */
export interface PendingReveal {
  atMs: number;   // absolute epoch ms (server clock) when this draft's slot reveals
  jp: number;     // 1 if this filled draft is the Jackpot, else 0
  hof: number;    // 1 if this filled draft is a HOF, else 0
}

export interface BatchProgress {
  current: number;
  total: number;
  // EVENTUAL (all-filled) counts. The dashboard re-derives the "as revealed
  // right now" view by adding back the deductions of any pendingReveals whose
  // atMs is still in the future.
  jackpotRemaining: number;
  hofRemaining: number;
  batchStart: number;
  filledLeaguesCount: number;
  // Reveal-time gating (optional; absent on the plain REST endpoint / old data).
  pendingReveals?: PendingReveal[];
  serverNowMs?: number;   // server clock at send time, for client skew correction
  // Rolling reset windows (post-cutover). Present only once the tracker doc
  // carries RollingStartDraft and that draft has been reached — its presence
  // is what flips the header to the dual-counter UI. Absent → legacy batches.
  lanes?: import('@/lib/rollingLanes').RollingLanes;
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
