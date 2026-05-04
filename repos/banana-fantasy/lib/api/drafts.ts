/**
 * Draft state API calls.
 */

import type { DraftRoom, League, Player, TeamPosition } from '@/types';
import { createHttpClient, normalizeWalletAddress } from './client';
import { mapDraftTokenToLeague, type ApiDraftToken } from './owner';
import { getDraftsApiUrl } from '@/lib/staging';

function draftsApi() {
  return createHttpClient({
    baseUrl: getDraftsApiUrl(),
  });
}

/** Backend draft info from `GET /draft/{draftId}/state/info`. */
export interface ApiDraftInfo {
  draftId: string;
  displayName?: string;
  draftStartTime?: number;
  currentPickEndTime?: number;
  currentDrafter?: string;
  pickNumber?: number;
  roundNum?: number;
  pickInRound?: number;
  pickLength?: number;
  draftOrder?: Array<{ ownerId: string; tokenId: string }>;
  [k: string]: unknown;
}

/** Backend pick from `GET /draft/{draftId}/state/summary`. */
export interface ApiDraftPick {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress?: string;
  pickNum?: number;
  round?: number;
  [k: string]: unknown;
}

/**
 * Convert backend draft info → UI `DraftRoom`.
 *
 * This is best-effort: the current UI expects contest metadata that isn't
 * represented by the drafts API yet.
 */
export function mapDraftInfoToDraftRoom(info: ApiDraftInfo, opts?: { walletAddress?: string }): DraftRoom {
  const now = Date.now();

  const infoObj = info as Record<string, unknown>;
  const draftId = info.draftId || String(infoObj.id ?? '');
  const contestName = info.displayName || draftId || 'Draft';

  const maxPlayers = info.draftOrder?.length || 10;
  const draftSpeed = (info.pickLength || 30) > 60 ? 'slow' : 'fast';

  const wallet = opts?.walletAddress ? normalizeWalletAddress(opts.walletAddress) : undefined;
  const currentDrafter = info.currentDrafter ? normalizeWalletAddress(info.currentDrafter) : undefined;

  let status: DraftRoom['status'] = 'drafting';
  if (info.draftStartTime && now < info.draftStartTime) status = 'ready';

  const timeRemainingMs =
    status === 'ready'
      ? (info.draftStartTime || now) - now
      : (info.currentPickEndTime || now) - now;

  const timeRemaining = Math.max(0, Math.floor(timeRemainingMs / 1000));

  return {
    id: String(draftId),
    contestId: '',
    contestName,
    players: maxPlayers,
    maxPlayers,
    status,
    type: 'regular',
    entryFee: 0,
    draftSpeed,
    isOnClock: !!wallet && !!currentDrafter && wallet === currentDrafter,
    timeRemaining,
    // picksAway is UI-only and depends on knowing the user's seat in draft order.
  };
}

/**
 * Fetch draft info.
 */
export async function getDraftInfo(draftId: string): Promise<ApiDraftInfo> {
  return draftsApi().get<ApiDraftInfo>(`/draft/${draftId}/state/info`);
}

/**
 * Fetch draft info and map to UI `DraftRoom`.
 */
export async function getDraftRoom(draftId: string, walletAddress?: string): Promise<DraftRoom> {
  const info = await getDraftInfo(draftId);
  return mapDraftInfoToDraftRoom(info, { walletAddress });
}

/**
 * Fetch draft summary (all picks).
 */
export async function getDraftSummary(draftId: string): Promise<ApiDraftPick[]> {
  const res = await draftsApi().get<unknown>(`/draft/${draftId}/state/summary`);

  const normalizePick = (raw: unknown): ApiDraftPick | null => {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;

    // Legacy shape: { playerInfo: {...}, pfpInfo: {...} }
    if (obj.playerInfo && typeof obj.playerInfo === 'object') {
      const pi = obj.playerInfo as Record<string, unknown>;
      const playerId = String(pi.playerId ?? '');
      if (!playerId) return null;
      return {
        playerId,
        displayName: String(pi.displayName ?? ''),
        team: String(pi.team ?? ''),
        position: String(pi.position ?? ''),
        ownerAddress: typeof pi.ownerAddress === 'string' ? pi.ownerAddress : '',
        pickNum: typeof pi.pickNum === 'number' ? pi.pickNum : Number(pi.pickNum ?? 0),
        round: typeof pi.round === 'number' ? pi.round : Number(pi.round ?? 0),
      };
    }

    // Flat shape
    if (typeof obj.playerId === 'string' && obj.playerId) {
      return {
        playerId: obj.playerId,
        displayName: String(obj.displayName ?? ''),
        team: String(obj.team ?? ''),
        position: String(obj.position ?? ''),
        ownerAddress: typeof obj.ownerAddress === 'string' ? obj.ownerAddress : '',
        pickNum: typeof obj.pickNum === 'number' ? obj.pickNum : Number(obj.pickNum ?? 0),
        round: typeof obj.round === 'number' ? obj.round : Number(obj.round ?? 0),
      };
    }

    return null;
  };

  const normalizeList = (list: unknown[]): ApiDraftPick[] =>
    list
      .map(normalizePick)
      .filter((p): p is ApiDraftPick => !!p)
      .filter((p) => !!p.playerId);

  if (Array.isArray(res)) return normalizeList(res);

  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>;
    if (Array.isArray(obj.picks)) return normalizeList(obj.picks as unknown[]);
    if (Array.isArray(obj.summary)) return normalizeList(obj.summary as unknown[]);
  }

  return [];
}

/**
 * Fetch draft summary and map to UI `Player[]`.
 *
 * Note: UI `Player` does not include pick metadata (round, pick number). If you
 * need that, use `getDraftSummary()` instead.
 */
export async function getDraftPickedPlayers(draftId: string): Promise<Player[]> {
  const picks = await getDraftSummary(draftId);
  return picks.map((p) => ({
    id: p.playerId,
    name: p.displayName,
    team: p.team,
    position: p.position,
    seasonPoints: 0,
    weeklyPoints: 0,
    projectedPoints: 0,
    byeWeek: 0,
  }));
}

/**
 * Fetch draft rosters (all teams).
 */
export async function getDraftRosters(draftId: string): Promise<ApiDraftToken[]> {
  const res = await draftsApi().get<unknown>(`/draft/${draftId}/state/rosters`);
  if (Array.isArray(res)) return res as ApiDraftToken[];

  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>;
    const rosters = obj.rosters;
    if (Array.isArray(rosters)) return rosters as ApiDraftToken[];

    // Some backends return a map keyed by tokenId.
    return Object.values(obj) as ApiDraftToken[];
  }

  return [];
}

/**
 * Fetch draft rosters and map to UI `League[]`.
 */
export async function getDraftLeagues(draftId: string): Promise<League[]> {
  const rosters = await getDraftRosters(draftId);
  return rosters.map(mapDraftTokenToLeague);
}

/**
 * Fetch per-player state (rankings/queue) for a draft.
 *
 * Backend endpoint: `GET /draft/{draftId}/playerState/{walletAddress}`
 */
export async function getDraftPlayerStateRaw(draftId: string, walletAddress: string): Promise<unknown> {
  const wallet = normalizeWalletAddress(walletAddress);
  return draftsApi().get<unknown>(`/draft/${draftId}/playerState/${wallet}`);
}

/**
 * Fetch a player's draft state and map it to UI `TeamPosition[]`.
 *
 * The backend commonly returns an ordered list of `playerId`s (e.g. `BUF-QB`).
 * The UI `TeamPosition` type is richer than what the API provides, so this
 * mapping fills unknown values with defaults.
 */
export async function getDraftPlayerRankings(draftId: string, walletAddress: string): Promise<TeamPosition[]> {
  const raw = await getDraftPlayerStateRaw(draftId, walletAddress);

  let ids: string[] = [];
  if (Array.isArray(raw)) {
    ids = raw.map((v) => String(v));
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const rankings = obj.rankings;
    const players = obj.players;
    if (Array.isArray(rankings)) ids = rankings.map((v) => String(v));
    else if (Array.isArray(players)) ids = players.map((v) => String(v));
  }

  return ids.map((playerId, idx) => {
    const [team, position] = String(playerId).split('-');
    return {
      id: String(idx + 1),
      team: team || '',
      position: position || '',
      currentPlayer: '',
      seasonPoints: 0,
      weeklyPoints: 0,
      projectedPoints: 0,
      byeWeek: 0,
      adp: idx + 1,
      adpChange: 0,
      depthChart: [],
    };
  });
}
