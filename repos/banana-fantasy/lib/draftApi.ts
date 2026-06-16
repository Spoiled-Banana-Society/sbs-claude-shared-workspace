// REST API service for the SBS drafts Go backend

import { authedAppFetch } from '@/lib/authedAppFetch';
import { createDraftsHttpClient } from '@/lib/draftsHttpClient';


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

async function authedBffJson<T>(
  path: string,
  getAccessToken: () => Promise<string | null>,
  init?: RequestInit,
): Promise<T> {
  const res = await authedAppFetch(path, getAccessToken, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `API error ${res.status} ${res.statusText}: ${text || 'No body'}`,
    );
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function draftsClient() {
  return createDraftsHttpClient();
}

// ==================== DRAFT STATE ====================

export async function getDraftInfo(draftId: string): Promise<DraftInfoResponse> {
  return draftsClient().get<DraftInfoResponse>(`/draft/${draftId}/state/info`);
}

export async function getDraftSummary(draftId: string): Promise<DraftSummary> {
  const res = await draftsClient().get<unknown>(`/draft/${draftId}/state/summary`);
  if (Array.isArray(res)) return res as DraftSummary;
  if (res && typeof res === 'object') {
    const obj = res as Partial<DraftSummaryEnvelope>;
    if (Array.isArray(obj.summary)) return obj.summary;
  }
  return [];
}

export async function getDraftRosters(draftId: string): Promise<RosterState> {
  return draftsClient().get<RosterState>(`/draft/${draftId}/state/rosters`);
}

// ==================== PLAYER STATE ====================

export async function getPlayerRankings(
  draftId: string,
  walletAddress: string
): Promise<PlayerDataResponse[]> {
  return draftsClient().get<PlayerDataResponse[]>(
    `/draft/${draftId}/playerState/${walletAddress}`,
  );
}

// ==================== QUEUE ====================

export async function getQueue(
  walletAddress: string,
  draftId: string,
  getAccessToken: () => Promise<string | null>,
): Promise<PlayerStateInfo[]> {
  return authedBffJson<PlayerStateInfo[]>(
    `/api/draft/${draftId}/queue`,
    getAccessToken,
  );
}

export async function updateQueue(
  walletAddress: string,
  draftId: string,
  queue: PlayerStateInfo[],
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  await authedBffJson<void>(`/api/draft/${draftId}/queue`, getAccessToken, {
    method: 'POST',
    body: JSON.stringify(queue),
  });
}

// ==================== SORT PREFERENCE ====================

export async function getSortPreference(
  walletAddress: string,
  draftId: string,
  getAccessToken: () => Promise<string | null>,
): Promise<string> {
  return authedBffJson<string>(`/api/draft/${draftId}/sort`, getAccessToken);
}

export async function updateSortPreference(
  walletAddress: string,
  draftId: string,
  sortBy: string,
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  await authedBffJson<void>(`/api/draft/${draftId}/sort`, getAccessToken, {
    method: 'PUT',
    body: JSON.stringify({ sortBy }),
  });
}

// ==================== TOKENS ====================

export async function getUserTokens(
  walletAddress: string
): Promise<UserTokens> {
  return draftsClient().get<UserTokens>(`/owner/${walletAddress}/draftToken/all`);
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
  getAccessToken: () => Promise<string | null>,
): Promise<DraftPreferences> {
  return authedBffJson<DraftPreferences>(
    `/api/draft/${draftId}/preferences`,
    getAccessToken,
  );
}

/**
 * Update user's auto-draft preference.
 */
export async function patchDraftPreferences(
  draftId: string,
  walletAddress: string,
  autoDraft: boolean,
  getAccessToken: () => Promise<string | null>,
): Promise<DraftPreferences> {
  return authedBffJson<DraftPreferences>(
    `/api/draft/${draftId}/preferences`,
    getAccessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ autoDraft }),
    },
  );
}

/**
 * Mint draft token(s) for the authenticated user (pre-join setup).
 */
export async function mintDraftToken(
  getAccessToken: () => Promise<string | null>,
  body: { minId: number; maxId: number } | { numberOfTokens: number },
): Promise<unknown> {
  return authedBffJson('/api/owner/mint', getAccessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
  getAccessToken: () => Promise<string | null>,
): Promise<unknown> {
  try {
    return await authedBffJson(`/api/draft/${draftId}/pick`, getAccessToken, {
      method: 'POST',
      body: JSON.stringify(pick),
    });
  } catch (err) {
    // Report failed pick submissions so admin sees them in real-time.
    // Anything blocking the user from advancing the draft is high
    // signal — clientErrors throttles per-source so retries don't spam.
    try {
      const { reportClientError } = await import('@/lib/clientErrors');
      reportClientError({
        source: 'draft.pick_submit_failed',
        message: `submitPickREST threw: ${err instanceof Error ? err.message : String(err)}`,
        route: 'draft-room',
        actor: walletAddress,
        context: { draftId, playerId: pick.playerId, position: pick.position },
      });
    } catch { /* swallow */ }
    throw err;
  }
}
