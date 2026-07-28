'use client';

import { useCallback, useMemo } from 'react';
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
  /** Server-assigned unique default-handle number ("Banana"+bananaNumber). */
  bananaNumber?: number | null;
  email: string | null;
  createdAt: string | null;
  isReturningPlayer: boolean;
  returningVia: string | null;
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
  // Client abort budget. Defaults to 20s — right for the dashboard's fast
  // read calls. Slow on-chain writes (grant-drafts mints an NFT on Base and
  // waits up to 60s for the receipt) pass a longer budget so the button waits
  // for the mint instead of falsely erroring at 20s while the server finishes.
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      throw new AdminApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 504);
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

export type DraftHealth = 'completed' | 'drafting' | 'filling' | 'frozen' | 'unknown';

export interface ManageDraftRow {
  id: string;
  displayName: string | null;
  status: string | null;
  draftType: string | null;
  numPlayers: number;
  maxPlayers: number;
  owners: string[];
  startDate: string | null;
  endDate: string | null;
  isLocked: boolean;
  health: DraftHealth;
  pickNumber: number | null;
  roundNum: number | null;
  stalledMinutes: number | null;
}

interface ManageDraftsResponse {
  drafts: ManageDraftRow[];
  summary: { total: number; returned: number };
  requestId?: string;
}

export function useAdminDraftsManage(
  enabled: boolean,
  filters: { wallet?: string; status?: string; query?: string } = {},
) {
  const getHeaders = useAdminAuthHeaders();
  const params = new URLSearchParams();
  if (filters.wallet) params.set('wallet', filters.wallet);
  if (filters.status) params.set('status', filters.status);
  if (filters.query) params.set('query', filters.query);
  return useQuery<ManageDraftsResponse>({
    queryKey: ['admin', 'drafts', 'manage', filters],
    enabled,
    queryFn: () =>
      adminFetch<ManageDraftsResponse>(
        `/api/admin/drafts/manage?${params.toString()}`,
        getHeaders,
      ),
    placeholderData: keepPreviousData,
  });
}

interface DeleteDraftWithRefundResponse {
  slotId: string;
  cardsTotal: number;
  refundedCount: number;
  failedLeaves: Array<{ ownerId: string; tokenId: string; status: number; error?: string }>;
  leaveResults: Array<{ ownerId: string; tokenId: string; status: number; ok: boolean; error?: string }>;
  requestId?: string;
}

export function useDeleteDraftWithRefund() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<DeleteDraftWithRefundResponse, AdminApiError, { slotId: string }>({
    mutationFn: async ({ slotId }) =>
      adminFetch<DeleteDraftWithRefundResponse>(
        `/api/admin/drafts/manage/${encodeURIComponent(slotId)}`,
        getHeaders,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'drafts', 'manage'] });
      qc.invalidateQueries({ queryKey: ['admin', 'drafts'] });
    },
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
  users: {
    total: number;
    newToday: number;
    newThisWeek: number;
    verified: number;
    xLinked: number;
    byWalletType: {
      privy_embedded: number;
      privy_external: number;
      external_connect: number;
      unknown: number;
    };
  };
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
  wheelPrizeBreakdown: Record<string, { today: number; total: number }>;
  totalFreeDraftsFromWheel: number;
  freeDraftsFromWheelToday: number;
  totalRevenueUsd: number;
  revenueTodayUsd: number;
  draftersWithoutPromos: number;
  draftsEnteredToday: number;
  draftsEnteredTotal: number;
  reservedDrafts: { jackpot: number; hof: number };
  wheelDrafts: {
    jackpot: { filling: number; drafting: number; completed: number; total: number };
    hof: { filling: number; drafting: number; completed: number; total: number };
  };
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
    // Manual refresh ONLY — each uncached /api/admin/metrics hit reads up to
    // ~300K Firestore docs, and the old 10s auto-poll was the main driver of
    // the $1K July 2026 GCP bill. Fetches once on dashboard open; after that
    // only the Refresh buttons (which call refetch()) hit the endpoint.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export interface TreasurySnapshot {
  opsWallet: string;
  treasury: string;
  contractUsdc: string;
  opsUsdc: string;
  treasuryUsdc: string;
  owedReserve: string;
}

// On-chain read (3 RPC balance calls) — poll gently, unlike the 10s metrics.
export function useTreasurySnapshot(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<TreasurySnapshot>({
    queryKey: ['admin', 'treasury-snapshot'],
    enabled,
    queryFn: () => adminFetch<TreasurySnapshot>('/api/admin/withdraw-contract-usdc', getHeaders),
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
    staleTime: 240_000,
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

export interface ResolvedErrorEntry {
  at: string | null;
  byWallet: string;
  note?: string;
}

/**
 * Returns the admin-curated map of "resolved" error groups — group keys
 * an admin has explicitly marked as fixed. The Logs UI drops these out
 * of the active feed and chip counts; a "Show resolved" toggle reveals
 * them again so they can be re-opened if the issue actually recurred.
 */
export function useResolvedErrors(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<{ resolved: Record<string, ResolvedErrorEntry> }>({
    queryKey: ['admin', 'resolved-errors'],
    enabled,
    queryFn: () =>
      adminFetch<{ resolved: Record<string, ResolvedErrorEntry> }>('/api/admin/error-resolved', getHeaders),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export interface PromoProgressResponse {
  ok: boolean;
  perType: Record<string, { started: number; completed: number; pending: number; conversionRate: number }>;
  pendingTotal: number;
  stalePending: Array<{
    wallet: string;
    promoId: string;
    promoType: string;
    progress: number;
    progressMax: number;
    hoursStale: number | null;
  }>;
  scannedDocs: number;
  warning?: string;
}

/**
 * Aggregates "in-progress multi-step promos" across every user. Powers
 * the dashboard's promo-progress card + the per-user lookup section.
 * Polls less aggressively than headline metrics because the underlying
 * collectionGroup scan is more expensive.
 */
export function usePromoProgress(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<PromoProgressResponse>({
    queryKey: ['admin', 'promo-progress'],
    enabled,
    queryFn: () => adminFetch<PromoProgressResponse>('/api/admin/promo-progress', getHeaders),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export interface HeaviestUserEntry {
  userId: string;
  username: string | null;
  spendUsd: number;
  passesBought: number;
  promosClaimed: number;
  spinsWon: number;
  freeDraftsWon: number;
  lastActivityIso: string;
}

export interface HeaviestUsersResponse {
  ok: boolean;
  scannedDocs: number;
  uniqueUsers: number;
  topSpend: HeaviestUserEntry[];
  topPromos: HeaviestUserEntry[];
  topSpins: HeaviestUserEntry[];
  topFreeDrafts: HeaviestUserEntry[];
}

export interface AggregateUser {
  wallet: string;
  username: string | null;
  /** PFP image URL (GCS-derived, browser onError handles 404 fallback). */
  avatar: string | null;
  /** displayName the user chose on their profile page. Falls back through
   *  username → short wallet in the UI. */
  displayName: string | null;
  walletType: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  balances: {
    freeDrafts: number;
    draftPasses: number;
    wheelSpins: number;
    jackpotEntries: number;
    hofEntries: number;
    cardPurchaseCount: number;
  };
  activity: {
    draftsEntered: number;
    draftsLeft: number;
    draftsWon: number;
    draftWinningsUsd: number;
    passesBought: number;
    spendUsd: number;
    passesGranted: number;
    spinsWon: number;
    freeDraftsWon: number;
    promosClaimed: number;
    cashoutsCompleted: number;
    cashoutsUsd: number;
  };
  promos: {
    startedTypes: string[];
    completedTypes: string[];
    pendingTypes: string[];
    hasStartedAny: boolean;
    hasCompletedAny: boolean;
  };
}

export function useUsersAggregate(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<{ ok: boolean; users: AggregateUser[] }>({
    queryKey: ['admin', 'users-aggregate'],
    enabled,
    queryFn: () => adminFetch<{ ok: boolean; users: AggregateUser[] }>('/api/admin/users-aggregate', getHeaders),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useHeaviestUsers(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<HeaviestUsersResponse>({
    queryKey: ['admin', 'heaviest-users'],
    enabled,
    queryFn: () => adminFetch<HeaviestUsersResponse>('/api/admin/heaviest-users', getHeaders),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useMarkErrorResolved() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; resolved: boolean; groupKey: string },
    AdminApiError,
    { groupKey: string; resolved: boolean; note?: string }
  >({
    mutationFn: async ({ groupKey, resolved, note }) =>
      adminFetch<{ ok: boolean; resolved: boolean; groupKey: string }>(
        '/api/admin/error-resolved',
        getHeaders,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupKey, resolved, note }),
        },
      ),
    onSuccess: () => {
      // Refetch the resolved map so the UI updates immediately.
      qc.invalidateQueries({ queryKey: ['admin', 'resolved-errors'] });
    },
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
  // Resolved server-side from our own Crisp webhook log: the best display name
  // (falls back to nickname/email/Anonymous) and whether the LAST message was
  // from the user (so it still needs a reply). Optional for backward-compat.
  displayName?: string;
  needsReply?: boolean;
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
      }, 90_000), // wait for the on-chain mint (up to ~60s) instead of false-erroring at 20s
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

export interface MarkPaidBatchResult {
  paid: string[];
  unmatched: { key: string; wallet: string; expectedUsd: number; foundUsd: number }[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; error: string }[];
  txStatus: string;
  requestId?: string;
}

/**
 * Verified batch settlement: one Gnosis batch tx hash + the approved
 * withdrawal ids. Server proves each payout on-chain before marking
 * paid; unverified ones stay approved and come back as `unmatched`.
 */
export function useMarkPaidBatch() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<MarkPaidBatchResult, AdminApiError, { txHash: string; withdrawalIds: string[] }>({
    mutationFn: ({ txHash, withdrawalIds }) =>
      adminFetch<MarkPaidBatchResult>(
        '/api/admin/withdrawals/mark-paid-batch',
        getHeaders,
        {
          method: 'POST',
          body: JSON.stringify({ txHash, withdrawalIds }),
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
  /** 'promos' = balance-safe (clears only promo-gating flags). Omit for full reset. */
  scope?: 'all' | 'promos';
}
export interface ResetUserResponse {
  success: boolean;
  userId: string;
  scope?: 'all' | 'promos';
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
      // Promo-scope reset leaves balances intact — don't zero them in the cache.
      if (data.scope !== 'promos') {
        qc.setQueriesData<AdminUsersResponse>({ queryKey: ['admin', 'users'] }, (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            users: prev.users.map((u) =>
              u.id === data.userId ? { ...u, freeDrafts: 0, wheelSpins: 0 } : u,
            ),
          };
        });
      }
      qc.invalidateQueries({ queryKey: ['admin', 'recent-actions'] });
      qc.invalidateQueries({ queryKey: ['admin', 'user-lookup'] });
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

/* ────────── BBB3 holders (returning-user cross-check) ────────── */

export interface Bbb3HolderRow {
  wallet: string;
  hasAccount: boolean;
  username?: string | null;
  banned?: boolean;
  firstPurchaseBonusGranted?: boolean;
  source: 'snapshot' | 'allowlist';
}
export interface Bbb3HoldersResponse {
  contract: string;
  count: number;
  snapshotCount: number;
  allowlistCount: number;
  loggedIn: number;
  snapshotAt: string | null;
  holders: Bbb3HolderRow[];
}

export function useBbb3Holders(enabled: boolean) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<Bbb3HoldersResponse>({
    queryKey: ['admin', 'bbb3-holders'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => adminFetch<Bbb3HoldersResponse>('/api/admin/bbb3-holders', getHeaders),
  });
}

/**
 * Lowercased Set of every wallet treated as returning (BBB3 snapshot ∪ manual
 * allowlist). Used to label users New/Returning across the admin. Returns an
 * empty set until the snapshot loads.
 */
export function useReturningWalletSet(enabled: boolean): { set: Set<string>; loading: boolean } {
  const q = useBbb3Holders(enabled);
  const set = useMemo(
    () => new Set((q.data?.holders ?? []).map((h) => h.wallet.toLowerCase())),
    [q.data],
  );
  return { set, loading: q.isLoading };
}

export function useRefreshBbb3Holders() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<Bbb3HoldersResponse, AdminApiError, void>({
    mutationFn: () =>
      adminFetch<Bbb3HoldersResponse>('/api/admin/bbb3-holders', getHeaders, { method: 'POST' }),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'bbb3-holders'], data);
    },
  });
}

/* ────────── Simulate first-purchase unlock (testing) ────────── */

export function useSimulateUnlock() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<{ success: boolean; userId: string }, AdminApiError, { userId: string }>({
    mutationFn: (input) =>
      adminFetch<{ success: boolean; userId: string }>('/api/admin/simulate-unlock', getHeaders, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'user-lookup'] });
    },
  });
}

export { AdminApiError };
