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
  };
  kyc: Record<string, unknown>[] | { ok: false; reason: string };
  payments: {
    onramps: Record<string, unknown>[] | { ok: false; reason: string };
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
