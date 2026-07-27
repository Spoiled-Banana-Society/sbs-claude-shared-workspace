'use client';

/**
 * React Query hooks for the User Lookup admin view.
 *
 * - useUserLookup(wallet)  — the consolidated per-wallet endpoint
 * - useAddUserNote()       — append a note to a wallet's shared notebook
 * - useDeleteUserNote()    — remove a note by id
 *
 * Auth: every call goes through the standard Privy bearer-token flow
 * via `useAdminAuthHeaders`. Mutations invalidate the lookup query so
 * the page refreshes after add/delete without a manual reload.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthHeaders } from './useAdminApi';

export interface UserLookupNote {
  id: string;
  wallet: string;
  text: string;
  createdBy: string;
  createdAt: string | null;
}

export interface UserLookupPushDevice {
  playerId: string;
  deviceType: number | null;
  deviceTypeName: string;
  os: string | null;
  model: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  notificationTypes: number | null;
  invalidIdentifier: boolean;
  tags: Record<string, string>;
}

export interface UserLookupNotificationDeliveryChannel {
  channel: 'push' | 'email' | 'telegram' | 'discord';
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  recipients?: number;
  providerId?: string;
}

export interface UserLookupNotificationDelivery {
  walletAddress: string;
  event: 'draft.filled' | 'draft.your_turn';
  draftId: string;
  draftName?: string;
  pickNumber?: number;
  pickLengthSeconds?: number;
  outcome: 'sent' | 'muted' | 'deduped' | 'failed';
  channels?: UserLookupNotificationDeliveryChannel[];
  timestamp: string;
  /**
   * Real post-send OneSignal delivery stats for this push (fetched
   * lazily on read from /notifications/{id}). Undefined for non-push
   * rows or when OneSignal can't find the notification.
   *
   * - `successful` — devices the push reached
   * - `failed` — APNS / FCM rejected (dead tokens, etc.)
   * - `errored` — OneSignal-side errors
   * - `remaining` — still in flight (rare unless looked up immediately)
   */
  pushStats?: {
    successful: number;
    failed: number;
    errored: number;
    converted: number;
    remaining: number;
    completedAt: string | null;
  };
  /**
   * Real post-send Postmark delivery status, populated by the
   * /api/notifications/postmark-webhook receiver. Without it we only
   * know "Postmark accepted the message" (which lies during sandbox
   * mode or when SPF/DKIM is misconfigured). With it the admin row
   * shows whether the email actually landed in the user's inbox,
   * bounced, or was marked spam.
   */
  emailDelivery?: {
    status: 'delivered' | 'bounced' | 'spam' | 'other';
    recordType?: string;
    receivedAt?: string;
    recipient?: string;
    bounceType?: string;
    bounceDescription?: string;
    complaintType?: string;
  };
}

export interface UserLookupIdentity {
  walletAddress: string;
  username: string | null;
  displayName: string | null;
  /** PFP image URL pulled from the Go owner API. Null when not set. */
  avatar: string | null;
  email: string | null;
  blueCheckVerified: boolean;
  banned: boolean;
  kycStatus: string | null;
  kycTier: number | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  balance: {
    freeDrafts: number;
    draftPasses: number;
    wheelSpins: number;
    jackpotEntries: number;
    hofEntries: number;
    cardPurchaseCount: number;
    cardFeeCreditCents: number;
  };
  /** First-purchase / wheel promo gating flags — for verifying flow state. */
  promoState?: {
    firstPurchaseBonusGranted: boolean;
    firstPurchasePromoUnlocked: boolean;
    hasSpunWheel: boolean;
  };
  /** Money sourced from the Go owner endpoint (separate from passes/entries
   *  which mirror in Firestore). credits = $-denominated prize money the
   *  user has not yet withdrawn. */
  account: {
    availableCreditUsd: number;
    availableEthCredit: number;
    pendingCreditUsd: number;
    numWithdrawalsLifetime: number;
  };
  /** If the Go owner profile fetch failed, this carries the reason so
   *  the admin UI can surface "Owner fetch: timeout after 15s" instead
   *  of silently showing no PFP / no name. Null when the fetch
   *  succeeded with full data. */
  ownerFetchDiagnostic: string | null;
}

export interface UserLookupResponse {
  ok: true;
  wallet: string;
  walletShort: string;
  userExists: boolean;
  requestId?: string;
  healthSummary: {
    status: 'ok' | 'warning' | 'critical';
    issues: { level: 'critical' | 'warning'; text: string }[];
  };
  identity: UserLookupIdentity | { ok: false; reason: string } | null;
  notes: UserLookupNote[] | { ok: false; reason: string };
  notifications: {
    prefs:
      | {
          walletAddress: string;
          channels: Record<string, boolean>;
          events: Record<string, boolean>;
          email: string | null;
          telegramChatId: string | null;
          discordId: string | null;
          updatedAt: string | null;
        }
      | { ok: false; reason: string };
    push:
      | {
          configured: boolean;
          totalPlayersInApp: number;
          devices: UserLookupPushDevice[];
        }
      | null
      | { ok: false; reason: string };
    /**
     * Last 25 notification delivery attempts for this wallet —
     * sourced from `v2_notification_deliveries`. Each row captures the
     * event, draftId, outcome (sent / muted / deduped / failed), and
     * per-channel results. Used to answer "did this user actually get
     * the alert and which channels fired."
     */
    recentDeliveries:
      | UserLookupNotificationDelivery[]
      | { ok: false; reason: string };
  };
  kyc: Record<string, unknown>[] | { ok: false; reason: string };
  payments: {
    onramps: Record<string, unknown>[] | { ok: false; reason: string };
    /** Chain-verified card deposits (Add Funds) — card_fee_credits markers
     *  with source:'deposit'. Plain USDC sends from self-custody wallets are
     *  not recorded server-side and can't appear here. */
    deposits: Record<string, unknown>[] | { ok: false; reason: string };
    offramps: Record<string, unknown>[] | { ok: false; reason: string };
    withdrawals: Record<string, unknown>[] | { ok: false; reason: string };
  };
  drafts: Record<string, unknown>[] | { ok: false; reason: string };
  errors: Record<string, unknown>[] | { ok: false; reason: string };
  audit: Record<string, unknown>[] | { ok: false; reason: string };
  activity: Record<string, unknown>[] | { ok: false; reason: string };
  /**
   * Canonical promo state for this user — sourced from atomic
   * claimCount on the user's promos subcollection (NOT from activity
   * events, which drop claims). See lib/admin/metricSources.ts.
   */
  promoState:
    | {
        byType: Record<string, number>;
        totalClaims: number;
        startedTypes: string[];
        completedTypes: string[];
        pendingTypes: string[];
      }
    | { ok: false; reason: string };
  /**
   * Full per-user teams + leagues + standings from the Go drafts API
   * (`/league/all/{wallet}/draftTokenLeaderboard/...`). Null when the
   * fetch failed (timeout, Go API down, network) — UI degrades cleanly.
   * Each entry: which league, level (Pro/HOF/JP), current rank +
   * scores, prize info, full roster of picks.
   */
  teams:
    | {
        draftId: string;
        leagueNumber: number | null;
        leagueLevel: string;
        draftSpeed: string | null;
        status: string;
        seasonScore: number;
        weeklyScore: number;
        seasonRank: number | null;
        totalEntrants: number | null;
        prizePool: number | null;
        prizeWon: number | null;
        roster: { team: string; position: string; pickNum: number }[];
      }[]
    | null;
}

// Type guard — most sections return either the array/object or an
// `{ ok: false, reason }` shape. Keeps the consumer code clean.
export function isSectionFail<T>(v: T | { ok: false; reason: string } | null | undefined):
  v is { ok: false; reason: string } {
  return typeof v === 'object' && v !== null && 'ok' in v && (v as { ok: false }).ok === false;
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function useUserLookup(wallet: string | null, enabled = true) {
  const getHeaders = useAdminAuthHeaders();
  return useQuery<UserLookupResponse, Error>({
    queryKey: ['admin', 'user-lookup', wallet?.toLowerCase() ?? ''],
    enabled: enabled && !!wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet ?? ''),
    queryFn: async () => {
      const headers = await getHeaders();
      return jsonFetch<UserLookupResponse>(
        `/api/admin/user-lookup?wallet=${encodeURIComponent((wallet ?? '').toLowerCase())}`,
        { headers },
      );
    },
    staleTime: 15_000,
  });
}

interface AddNoteInput {
  wallet: string;
  text: string;
}
interface AddNoteResponse {
  ok: true;
  note: UserLookupNote;
  requestId?: string;
}
export function useAddUserNote() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<AddNoteResponse, Error, AddNoteInput>({
    mutationFn: async ({ wallet, text }) => {
      const headers = await getHeaders();
      return jsonFetch<AddNoteResponse>('/api/admin/user-notes', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: wallet.toLowerCase(), text }),
      });
    },
    onSuccess: (_, { wallet }) => {
      qc.invalidateQueries({
        queryKey: ['admin', 'user-lookup', wallet.toLowerCase()],
      });
    },
  });
}

interface DeleteNoteInput {
  id: string;
  wallet: string;
}
export function useDeleteUserNote() {
  const getHeaders = useAdminAuthHeaders();
  const qc = useQueryClient();
  return useMutation<{ ok: true; id: string }, Error, DeleteNoteInput>({
    mutationFn: async ({ id }) => {
      const headers = await getHeaders();
      return jsonFetch<{ ok: true; id: string }>(
        `/api/admin/user-notes/${encodeURIComponent(id)}`,
        { method: 'DELETE', headers },
      );
    },
    onSuccess: (_, { wallet }) => {
      qc.invalidateQueries({
        queryKey: ['admin', 'user-lookup', wallet.toLowerCase()],
      });
    },
  });
}
