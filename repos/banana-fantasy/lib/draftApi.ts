// REST API service for the SBS drafts Go backend

import { getDraftsApiUrl } from '@/lib/staging';

const FALLBACK_URL =
  process.env.NEXT_PUBLIC_DRAFTS_API_URL ||
  'https://sbs-drafts-api-w5wydprnbq-uc.a.run.app';


// ==================== TYPES ====================

export interface DraftOrderEntry {
  ownerId: string;
  tokenId: string;
}

export interface AdpEntry {
  adp: number;
  byeWeek?: number;
  bye?: string;
  playerId: string;
}

export interface DraftInfoResponse {
  draftId: string;
  displayName: string;
  draftStartTime: number; // unix seconds
  pickLength: number;
  currentDrafter: string; // wallet address
  pickNumber: number;
  roundNum: number;
  pickInRound: number;
  currentPickEndTime?: number;
  draftOrder: DraftOrderEntry[];
  adp: AdpEntry[];
}

export interface PlayerStateInfo {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  ownerAddress: string;
  pickNum: number;
  round: number;
}

export interface StatsObject {
  playerId: string;
  averageScore: number;
  highestScore: number;
  top5Finishes: number;
  adp: number;
  byeWeek: number;
  playersFromTeam: string[];
}

export interface PlayerRanking {
  playerId: string;
  rank: number;
  score: number;
}

export interface PlayerDataResponse {
  playerId: string;
  playerStateInfo: PlayerStateInfo;
  stats: StatsObject;
  ranking: PlayerRanking;
}

export interface PfpInfo {
  imageUrl: string;
  nftContract: string;
  displayName: string;
}

export interface DraftSummaryItem {
  playerInfo: PlayerStateInfo;
  pfpInfo: PfpInfo;
}

export type DraftSummary = DraftSummaryItem[];

interface DraftSummaryEnvelope {
  summary: DraftSummary;
}

export type RosterState = Record<
  string,
  { QB: string[]; RB: string[]; WR: string[]; TE: string[]; DST: string[] }
>;

export interface UserTokens {
  available: unknown[];
  active: unknown[];
}

// ==================== HELPERS ====================

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getDraftsApiUrl() || FALLBACK_URL;
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `API error ${res.status} ${res.statusText}: ${text || 'No body'}`
    );
  }
  return res.json() as Promise<T>;
}

// ==================== DRAFT STATE ====================

export async function getDraftInfo(draftId: string): Promise<DraftInfoResponse> {
  return apiFetch<DraftInfoResponse>(`/draft/${draftId}/state/info`);
}

export async function getDraftSummary(draftId: string): Promise<DraftSummary> {
  const res = await apiFetch<unknown>(`/draft/${draftId}/state/summary`);
  if (Array.isArray(res)) return res as DraftSummary;
  if (res && typeof res === 'object') {
    const obj = res as Partial<DraftSummaryEnvelope>;
    if (Array.isArray(obj.summary)) return obj.summary;
  }
  return [];
}

export async function getDraftRosters(draftId: string): Promise<RosterState> {
  return apiFetch<RosterState>(`/draft/${draftId}/state/rosters`);
}

// ==================== PLAYER STATE ====================

export async function getPlayerRankings(
  draftId: string,
  walletAddress: string
): Promise<PlayerDataResponse[]> {
  return apiFetch<PlayerDataResponse[]>(
    `/draft/${draftId}/playerState/${walletAddress}`
  );
}

// ==================== QUEUE ====================

export async function getQueue(
  walletAddress: string,
  draftId: string
): Promise<PlayerStateInfo[]> {
  return apiFetch<PlayerStateInfo[]>(
    `/owner/${walletAddress}/drafts/${draftId}/state/queue`
  );
}

export async function updateQueue(
  walletAddress: string,
  draftId: string,
  queue: PlayerStateInfo[]
): Promise<void> {
  await apiFetch<void>(
    `/owner/${walletAddress}/drafts/${draftId}/state/queue`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queue),
    }
  );
}

// ==================== SORT PREFERENCE ====================

export async function getSortPreference(
  walletAddress: string,
  draftId: string
): Promise<string> {
  return apiFetch<string>(
    `/owner/${walletAddress}/drafts/${draftId}/state/sort`
  );
}

export async function updateSortPreference(
  walletAddress: string,
  draftId: string,
  sortBy: string
): Promise<void> {
  await apiFetch<void>(
    `/owner/${walletAddress}/drafts/${draftId}/state/sort/${sortBy}`,
    { method: 'PUT' }
  );
}

// ==================== TOKENS ====================

export async function getUserTokens(
  walletAddress: string
): Promise<UserTokens> {
  return apiFetch<UserTokens>(`/owner/${walletAddress}/draftToken/all`);
}

// ==================== LEAGUE ACTIONS ====================

export async function joinDraft(
  draftType: string,
  walletAddress: string,
  numLeagues: number
): Promise<void> {
  await apiFetch<void>(`/league/${draftType}/owner/${walletAddress}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numLeaguesToJoin: numLeagues }),
  });
}

export async function leaveDraft(
  draftId: string,
  ownerId: string,
  tokenId: string
): Promise<void> {
  await apiFetch<void>(`/league/${draftId}/actions/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId, tokenId }),
  });
}

// ==================== DRAFT ACTIONS (Firebase RTDB + Cloud Tasks migration) ====================

export interface DraftPreferences {
  sortBy: string;
  autoDraft: boolean;
  numPicksMissedConsecutive: number;
}

/**
 * Get user's draft preferences (auto-draft setting, sort order, missed picks count).
 */
export async function getDraftPreferences(
  draftId: string,
  walletAddress: string,
): Promise<DraftPreferences> {
  return apiFetch<DraftPreferences>(
    `/draft-actions/${draftId}/owner/${walletAddress}/preferences`,
  );
}

/**
 * Update user's auto-draft preference.
 */
export async function patchDraftPreferences(
  draftId: string,
  walletAddress: string,
  autoDraft: boolean,
): Promise<DraftPreferences> {
  return apiFetch<DraftPreferences>(
    `/draft-actions/${draftId}/owner/${walletAddress}/preferences`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoDraft }),
    },
  );
}

/**
 * Submit a pick via REST API (replaces WebSocket pick_received message).
 * The backend processes the pick, updates Firebase RTDB, and schedules
 * auto-draft via Cloud Tasks.
 */
export async function submitPickREST(
  draftId: string,
  walletAddress: string,
  pick: {
    playerId: string;
    displayName: string;
    team: string;
    position: string;
  },
): Promise<unknown> {
  return apiFetch<unknown>(
    `/draft-actions/${draftId}/owner/${walletAddress}/actions/pick`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pick),
    },
  );
}
