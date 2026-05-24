'use client';

import { useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';

/* ────────── Types ────────── */

export interface AdminStats {
  totalUsers: number;
  pendingWithdrawals: number;
  totalWithdrawalAmount: number;
  verifiedUsers: number;
}

export interface AdminUser {
  id: string;
  walletAddress: string;
  username: string | null;
  email: string | null;
  createdAt: string | null;
  blueCheckVerified: boolean;
  banned: boolean;
  freeDrafts: number;
  paidDrafts: number;
  wheelSpins: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  requestId?: string;
}

export interface AdminWithdrawalItem {
  id: string;
  userId: string;
  walletAddress: string;
  amount: number;
  status: string;
  createdAt: string | null;
  blueCheckVerified: boolean;
}

export interface AdminDraftItem {
  id: string;
  name: string;
  status: string;
  playerCount: number;
  maxPlayers: number;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  entryFee: number;
}

export interface AdminDraftsResponse {
  drafts: AdminDraftItem[];
  summary: { active: number; completed: number; pending: number; total: number };
  requestId?: string;
}

export interface AdminPromoItem {
  id: string;
  code: string;
  discountPercent: number;
  maxUses: number | null;
  currentUses: number;
  active: boolean;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface AdminAuditEntry {
  actor: string;
  action: string;
  target: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId: string;
  timestamp: string;
}

export interface UserEventEntry {
  userId: string;
  eventType: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

/* ────────── Auth headers hook ────────── */

export function useAdminAuthHeaders() {
  const privy = usePrivy();
  return useCallback(async (): Promise<HeadersInit> => {
    const token = await privy.getAccessToken();
    if (!token) throw new Error('Your session expired — please log out and log back in to continue.');
    return { Authorization: `Bearer ${token}` };
  }, [privy]);
}

/* ────────── Core fetcher ────────── */

class AdminApiError extends Error {
  status: number;
  requestId?: string;
  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function adminFetch<T>(
  url: string,
  getHeaders: () => Promise<HeadersInit>,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const headers = await getHeaders();
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
      signal: controller.signal,
    });

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* non-json */
    }

    const requestId = (payload as { requestId?: string } | null)?.requestId;
    if (!res.ok) {
      const msg = (payload as { error?: string } | null)?.error || res.statusText || 'Request failed';
      throw new AdminApiError(msg, res.status, requestId);
    }
    return payload as T;
  } catch (err) {
    if (err instanceof AdminApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AdminApiError('Request timed out after 20s', 504);
    }
    throw new AdminApiError((err as Error).message || 'Network error', 0);
  } finally {
    clearTimeout(timeout);
  }
}

/* ────────── Queries ────────── */

export function useAdminStats(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    enabled,
    queryFn: () => adminFetch<AdminStats>('/api/admin/stats', getHeaders),
  });
}

export function useAdminUsers(enabled: boolean, offset: number, limit: number, q: string) {
  const getHeaders = useAdminAuthHeaders();
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  if (q.trim()) params.set('q', q.trim());
  return useQuery<AdminUsersResponse>({
    queryKey: ['admin', 'users', { offset, limit, q: q.trim() }],
    enabled,
    queryFn: () => adminFetch<AdminUsersResponse>(`/api/admin/users?${params}`, getHeaders),
    placeholderData: keepPreviousData,
  });
}

export function useAdminDrafts(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<AdminDraftsResponse>({
    queryKey: ['admin', 'drafts'],
    enabled,
    queryFn: () => adminFetch<AdminDraftsResponse>('/api/admin/drafts', getHeaders),
  });
}

export interface ReconcilePassesResponse {
  success: boolean;
  wallet: string;
  beforeCounter: number;
  afterCounter: number;
  onChainCount: number;
  ownedTokenIds: string[];
  registeredWithGoApi: number;
  removedFromGoApi: number;
  requestId?: string;
}
export function useReconcilePasses() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<ReconcilePassesResponse, AdminApiError, { wallet: string }>({
    mutationFn: ({ wallet }) =>
      adminFetch<ReconcilePassesResponse>('/api/admin/reconcile-passes', getHeaders, {
        method: 'POST',
        body: JSON.stringify({ wallet }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
}

export interface ZeroFreeDraftsResponse {
  success: boolean;
  zeroedUsers: number;
  totalFreeDraftsCleared: number;
  requestId?: string;
}
export function useZeroFreeDrafts() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<ZeroFreeDraftsResponse, AdminApiError, void>({
    mutationFn: () =>
      adminFetch<ZeroFreeDraftsResponse>('/api/admin/zero-free-drafts', getHeaders, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
}

export interface AdminAuditRecord {
  actor: string;
  action: string;
  target: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId: string;
  timestamp: string;
}
export interface AdminAuditResponse {
  records: AdminAuditRecord[];
  requestId?: string;
}
export function useAdminAudit(enabled: boolean, limit = 100, action = '') {
  const getHeaders = useAdminAuthHeaders();
  const params = new URLSearchParams({ limit: String(limit) });
  if (action) params.set('action', action);
  return useQuery<AdminAuditResponse>({
    queryKey: ['admin', 'audit', { limit, action }],
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    queryFn: () => adminFetch<AdminAuditResponse>(`/api/admin/audit?${params}`, getHeaders),
  });
}

export function useAdminWithdrawals(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<AdminWithdrawalItem[]>({
    queryKey: ['admin', 'withdrawals'],
    enabled,
    queryFn: () => adminFetch<AdminWithdrawalItem[]>('/api/admin/withdrawals', getHeaders),
  });
}

export function useAdminPromos(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<{ promos: AdminPromoItem[] }>({
    queryKey: ['admin', 'promos'],
    enabled,
    queryFn: () => adminFetch<{ promos: AdminPromoItem[] }>('/api/admin/promos', getHeaders),
  });
}

export function useRecentAdminActions(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<{ actions: AdminAuditEntry[]; requestId?: string }>({
    queryKey: ['admin', 'recent-actions'],
    enabled,
    queryFn: () =>
      adminFetch<{ actions: AdminAuditEntry[]; requestId?: string }>('/api/admin/recent-actions?limit=100', getHeaders),
  });
}

export function useRecentUserEvents(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<{ events: UserEventEntry[]; requestId?: string }>({
    queryKey: ['admin', 'user-events'],
    enabled,
    queryFn: () =>
      adminFetch<{ events: UserEventEntry[]; requestId?: string }>('/api/admin/user-events?limit=100', getHeaders),
  });
}

export interface MetricsResponse {
  users: { total: number; newToday: number; newThisWeek: number; verified: number; xLinked: number };
  engagement: { signupsToday: number; signupsThisWeek: number; loginsToday: number; loginsThisWeek: number };
  wheel: { totalSpins: number; spinsToday: number; jackpotHits: number; hofHits: number; draftPassAwards: number; draftPassesAwardedTotal: number };
  promos: { sharesVerifiedTotal: number; sharesVerifiedToday: number; sharesEarnedCredit: number; promoClaimsToday: number };
  referrals: { totalCodes: number };
  withdrawals: { pending: number; approved: number; denied: number; totalVolume: number };
  drafts: { queued: number; jackpotQueueSize: number; hofQueueSize: number };
  lifetime: {
    signups: number;
    logins: number;
    wheelSpins: number;
    passesPurchased: number;
    promosClaimed: number;
    jackpotWins: number;
    hofWins: number;
    withdrawalsPaidVolume: number;
    draftsCompleted: number;
  };
  promoBreakdown: Record<string, { claimsToday: number; claimsTotal: number }>;
  generatedAt: string;
  requestId?: string;
  cached?: boolean;
}

export function useAdminMetrics(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<MetricsResponse>({
    queryKey: ['admin', 'metrics'],
    enabled,
    queryFn: () => adminFetch<MetricsResponse>('/api/admin/metrics', getHeaders),
    refetchInterval: 10_000, // live-polling every 10 seconds
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export interface ErrorEventEntry {
  source: string;
  route?: string;
  message: string;
  stack?: string;
  requestId?: string;
  actor?: string;
  context?: Record<string, unknown>;
  sessionId?: string;
  timestamp: string;
}

export function useRecentErrors(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<{ errors: ErrorEventEntry[]; requestId?: string }>({
    queryKey: ['admin', 'errors'],
    enabled,
    queryFn: () =>
      adminFetch<{ errors: ErrorEventEntry[]; requestId?: string }>('/api/admin/error-events?limit=100', getHeaders),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Returns a function that downloads an error + its full debug-session
 * trace as a JSON file (for handing to a developer). Raw fetch — not
 * adminFetch — because the response is a file, not JSON.
 */
export function useExportErrorSession() {
  const getHeaders = useAdminAuthHeaders();
  return useCallback(
    async (sessionId: string): Promise<void> => {
      const headers = await getHeaders();
      const res = await fetch(`/api/admin/error-export?sessionId=${encodeURIComponent(sessionId)}`, {
        headers,
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((body as { error?: string })?.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `sbs-error-${sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [getHeaders],
  );
}

export interface SentryIssueEntry {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  level: string;
  permalink: string;
  status: string;
}

export type KycAttemptStatus =
  | 'approved'
  | 'didit_declined'
  | 'name_mismatch'
  | 'dob_mismatch'
  | 'blocked'
  | 'error'
  | 'invalid_input';

export interface KycAttemptEntry {
  id: string;
  userId: string;
  walletAddress?: string;
  timestamp: string;
  status: KycAttemptStatus;
  formData: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    country: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  didit?: {
    requestId?: string;
    status?: string;
    extractedFirstName?: string;
    extractedLastName?: string;
    extractedDob?: string;
    documentType?: string;
    documentNumber?: string;
    warnings?: string[];
  };
  blockCode?: string;
  blockReason?: string;
  errorMessage?: string;
  identityHash?: string;
  imageSizeKb?: number;
  durationMs?: number;
}

export function useKycAttempts(enabled: boolean, status: KycAttemptStatus | '' = '', limit = 100) {
  const getHeaders = useAdminAuthHeaders();
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  qs.set('limit', String(limit));
  return useQuery<{ attempts: KycAttemptEntry[]; count: number }>({
    queryKey: ['admin', 'kyc-attempts', status, limit],
    enabled,
    queryFn: () =>
      adminFetch<{ attempts: KycAttemptEntry[]; count: number }>(
        `/api/admin/kyc-attempts?${qs.toString()}`,
        getHeaders,
      ),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export type OfframpAttemptStatus =
  | 'session_created'
  | 'tx_pending'
  | 'tx_completed'
  | 'tx_failed'
  | 'abandoned';

export type OfframpSource = 'coinbase_offramp' | 'direct_usdc' | 'direct_bank';

export interface OfframpAttemptEntry {
  id: string;
  userId: string;
  walletAddress?: string;
  source: OfframpSource;
  partnerUserId?: string;
  timestamp: string;
  updatedAt: string;
  status: OfframpAttemptStatus;
  amount?: number;
  paymentMethod?: string;
  draftId?: string;
  coinbaseTxId?: string;
  coinbaseTxStatus?: string;
  txDetectedAt?: string;
  txCompletedAt?: string;
  coinbaseSellUsdc?: number;
  coinbaseTotalUsd?: number;
  coinbaseFeeUsd?: number;
  coinbaseExchangeRate?: number;
  errorMessage?: string;
  withdrawalId?: string;
}

export function useOfframpAttempts(
  enabled: boolean,
  status: OfframpAttemptStatus | '' = '',
  limit = 100,
) {
  const getHeaders = useAdminAuthHeaders();
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  qs.set('limit', String(limit));
  return useQuery<{ attempts: OfframpAttemptEntry[]; count: number }>({
    queryKey: ['admin', 'offramp-attempts', status, limit],
    enabled,
    queryFn: () =>
      adminFetch<{ attempts: OfframpAttemptEntry[]; count: number }>(
        `/api/admin/offramp-attempts?${qs.toString()}`,
        getHeaders,
      ),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export type OnrampAttemptStatus =
  | 'session_created'
  | 'tx_pending'
  | 'tx_completed'
  | 'tx_failed'
  | 'abandoned';

export type OnrampProvider = 'coinbase' | 'moonpay';

export interface OnrampAttemptEntry {
  id: string;
  userId: string;
  walletAddress?: string;
  provider: OnrampProvider;
  partnerUserId?: string;
  timestamp: string;
  updatedAt: string;
  status: OnrampAttemptStatus;
  amount?: number;
  paymentMethod?: string;
  coinbaseTxId?: string;
  coinbaseTxStatus?: string;
  failureReason?: string;
  failureMessage?: string;
  nextAvailableAt?: string;
  txDetectedAt?: string;
  txCompletedAt?: string;
  mintTxHash?: string;
  passQuantity?: number;
  errorMessage?: string;
}

export function useOnrampAttempts(
  enabled: boolean,
  status: OnrampAttemptStatus | '' = '',
  limit = 100,
) {
  const getHeaders = useAdminAuthHeaders();
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  qs.set('limit', String(limit));
  return useQuery<{ attempts: OnrampAttemptEntry[]; count: number }>({
    queryKey: ['admin', 'onramp-attempts', status, limit],
    enabled,
    queryFn: () =>
      adminFetch<{ attempts: OnrampAttemptEntry[]; count: number }>(
        `/api/admin/onramp-attempts?${qs.toString()}`,
        getHeaders,
      ),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useSentryIssues(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<{ issues: SentryIssueEntry[]; configured: boolean; requestId?: string }>({
    queryKey: ['admin', 'sentry-issues'],
    enabled,
    queryFn: () =>
      adminFetch<{ issues: SentryIssueEntry[]; configured: boolean; requestId?: string }>(
        '/api/admin/sentry-issues?limit=25&statsPeriod=24h',
        getHeaders,
      ),
    // 60s when tab visible; paused when tab inactive (refetchIntervalInBackground:false).
    // The notification badge already pings every 30s for new-error counts so
    // you don't miss spikes — the page itself doesn't need a tighter cadence.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export interface CrispConversationEntry {
  session_id: string;
  nickname: string | null;
  email: string | null;
  avatar: string | null;
  state: 'pending' | 'unresolved' | 'resolved';
  unread: { operator?: number; visitor?: number } | number;
  last_message: string | null;
  updated_at: number;
  created_at: number;
  waiting_since?: number;
  url: string;
}

export interface SupportResponse {
  conversations: CrispConversationEntry[];
  configured: boolean;
  inboxUrl: string;
  requestId?: string;
}

export function useSupportInbox(enabled: boolean, filter: 'all' | 'unread' | 'open') {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<SupportResponse>({
    queryKey: ['admin', 'support', filter],
    enabled,
    queryFn: () =>
      adminFetch<SupportResponse>(`/api/admin/support?filter=${filter}`, getHeaders),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
}

/* ────────── Mutations ────────── */

export interface GrantDraftsInput {
  identifier: string;
  count: number;
}
export interface GrantDraftsResponse {
  success: boolean;
  userId: string;
  walletAddress: string | null;
  username: string | null;
  granted: number;
  freeDrafts: number;
  mintOnChain?: boolean;
  txHash?: string;
  tokenIds?: string[];
  requestId?: string;
}

export function useGrantDrafts() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<GrantDraftsResponse, AdminApiError, GrantDraftsInput>({
    mutationFn: (input) =>
      adminFetch<GrantDraftsResponse>('/api/admin/grant-drafts', getHeaders, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      // Optimistically patch the cached users rows if we know the target
      qc.setQueriesData<AdminUsersResponse>({ queryKey: ['admin', 'users'] }, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) =>
            u.id === data.userId ? { ...u, freeDrafts: data.freeDrafts } : u,
          ),
        };
      });
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
    },
  });
}

export interface BanUserInput {
  userId: string;
  banned: boolean;
}
export function useBanUser() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<AdminUser & { requestId?: string }, AdminApiError, BanUserInput>({
    mutationFn: ({ userId, banned }) =>
      adminFetch<AdminUser & { requestId?: string }>(`/api/admin/users/${encodeURIComponent(userId)}`, getHeaders, {
        method: 'PUT',
        body: JSON.stringify({ banned }),
      }),
    onSuccess: (data) => {
      qc.setQueriesData<AdminUsersResponse>({ queryKey: ['admin', 'users'] }, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) => (u.id === data.id ? { ...u, banned: data.banned } : u)),
        };
      });
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
    },
  });
}

export interface WithdrawalStatusInput {
  id: string;
  status: 'approved' | 'denied' | 'paid';
  txHash?: string;
}
export function useUpdateWithdrawalStatus() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<AdminWithdrawalItem & { requestId?: string }, AdminApiError, WithdrawalStatusInput>({
    mutationFn: ({ id, status, txHash }) =>
      adminFetch<AdminWithdrawalItem & { requestId?: string }>(
        `/api/admin/withdrawals/${encodeURIComponent(id)}`,
        getHeaders,
        {
          method: 'PUT',
          body: JSON.stringify({ status, ...(txHash ? { txHash } : {}) }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
      qc.invalidateQueries({ queryKey: ['admin', 'offramp-attempts'] });
    },
  });
}

export interface KycVerifyInput {
  userId: string;
  tier?: 'tier1' | 'tier2';
  verified?: boolean;
}
export interface KycVerifyResponse {
  success: boolean;
  userId: string;
  tier: 'tier1' | 'tier2';
  verified: boolean;
  requestId?: string;
}
export function useMarkKycVerified() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<KycVerifyResponse, AdminApiError, KycVerifyInput>({
    mutationFn: (input) =>
      adminFetch<KycVerifyResponse>('/api/admin/kyc-verify', getHeaders, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
    },
  });
}

export interface GrantPrizeInput {
  walletAddress: string;
  amount: number;
  contestName?: string;
  draftId?: string;
  note?: string;
}
export interface GrantPrizeResponse {
  prize: {
    id: string;
    userId: string;
    amount: number;
    contestName: string;
    status: string;
    createdAt: string;
  };
  requestId?: string;
}
export function useGrantPrize() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<GrantPrizeResponse, AdminApiError, GrantPrizeInput>({
    mutationFn: (input) =>
      adminFetch<GrantPrizeResponse>('/api/admin/grant-prize', getHeaders, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
    },
  });
}

export interface ResetUserInput {
  userId: string;
}
export interface ResetUserResponse {
  success: boolean;
  userId: string;
  before: Record<string, number>;
  requestId?: string;
}
export function useResetUser() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<ResetUserResponse, AdminApiError, ResetUserInput>({
    mutationFn: (input) =>
      adminFetch<ResetUserResponse>('/api/admin/reset-user', getHeaders, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      qc.setQueriesData<AdminUsersResponse>({ queryKey: ['admin', 'users'] }, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) =>
            u.id === data.userId ? { ...u, freeDrafts: 0, wheelSpins: 0 } : u,
          ),
        };
      });
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
    },
  });
}

export interface RecoverDraftCardInput {
  draftId: string;
  walletAddress: string;
}
export interface RecoverDraftCardResponse {
  ok: boolean;
  draftId: string;
  walletAddress: string;
  requestId?: string;
}
export function useRecoverDraftCard() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<RecoverDraftCardResponse, AdminApiError, RecoverDraftCardInput>({
    mutationFn: (input) =>
      adminFetch<RecoverDraftCardResponse>('/api/admin/recover-draft-card', getHeaders, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
    },
  });
}

export { AdminApiError };
