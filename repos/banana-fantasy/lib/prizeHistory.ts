// Canonical prize-history merge for one user: Go-API wins (when the
// endpoint exists) + synthetic prizes + local withdrawals, with status
// overlays applied. Extracted from /api/prizes/history so server code
// (withdraw-all) can call it directly instead of making an
// unauthenticated HTTP self-call to its own route.
//
// MONEY SEMANTICS: every source failure throws ApiError(503) — never a
// silent empty list. An empty list renders as "$0.00, win drafts to get
// started", indistinguishable from a real zero balance. The ONE soft
// path is the Go API returning 404: that endpoint doesn't exist today
// (verified 2026-06-09 against owner/owner.go) and prize records live
// entirely in our Firestore, so 404 is the expected steady state.

import crypto from 'node:crypto';

import { ApiError } from '@/lib/api/errors';
import { getWithdrawalsByUser } from '@/lib/db';
import {
  applyOverlaysToWins,
  getPrizeOverlays,
  getSyntheticPrizesForUser,
} from '@/lib/prizeOverlay';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import type { PrizeHistoryItem, PrizeStatus, PrizeWin, PrizeWithdrawal, WithdrawalStatus } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_SBS_API_URL || '';

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch {
    // ignore JSON parsing errors
  }
  try {
    const text = await res.text();
    return text ? text : null;
  } catch {
    return null;
  }
}

function normalizePrizeStatus(value: unknown): PrizeStatus {
  if (value === 'paid' || value === 'processing' || value === 'forfeited' || value === 'pending') return value;
  return 'pending';
}

function normalizeWithdrawalStatus(value: unknown): WithdrawalStatus {
  if (value === 'pending' || value === 'processing' || value === 'completed' || value === 'failed') return value;
  return 'processing';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function pickArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const candidateKeys = ['prizes', 'wins', 'history', 'items', 'data'];
  for (const key of candidateKeys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

function normalizePrizeHistory(payload: unknown, userId: string) {
  const list = pickArray(payload);
  if (!list) return { items: null, hasWithdrawals: false };

  let hasWithdrawals = false;
  const items: PrizeHistoryItem[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const type = asString(record.type);

    const methodRaw = asString(record.method) || asString(record.withdrawalMethod);
    const isWithdrawal = type === 'withdrawal' || !!methodRaw;

    if (isWithdrawal) {
      hasWithdrawals = true;
      const amount = asNumber(record.amount) ?? 0;
      const method = methodRaw === 'usdc' || methodRaw === 'bank' ? methodRaw : 'bank';
      const status = normalizeWithdrawalStatus(record.status);
      const createdAt = asString(record.createdAt) || asString(record.date) || new Date().toISOString();

      const withdrawal: PrizeWithdrawal = {
        id: asString(record.id) || asString(record.withdrawalId) || crypto.randomUUID(),
        type: 'withdrawal',
        userId: asString(record.userId) || userId,
        draftId: asString(record.draftId) || asString(record.leagueId) || undefined,
        amount,
        method,
        status,
        createdAt,
        updatedAt: asString(record.updatedAt) || undefined,
      };
      items.push(withdrawal);
      continue;
    }

    const amount = asNumber(record.amount) ?? asNumber(record.prizeAmount) ?? 0;
    const status = normalizePrizeStatus(record.status);
    // Server returns "BBB #N"; in-app label is plain "League #N".
    const rawContestName = asString(record.contestName) || asString(record.displayName) || asString(record.leagueDisplayName) || 'Contest Prize';
    const contestName = rawContestName.replace(/^BBB\s*#/, 'League #');
    const win: PrizeHistoryItem = {
      id: asString(record.id) || asString(record.prizeId) || crypto.randomUUID(),
      type: 'win',
      contestName,
      amount,
      status,
      paidDate: asString(record.paidDate) || asString(record.paidAt) || undefined,
      forfeitReason: asString(record.forfeitReason) || undefined,
      draftId: asString(record.draftId) || asString(record.leagueId) || undefined,
      createdAt: asString(record.createdAt) || undefined,
    };
    items.push(win);
  }

  return { items, hasWithdrawals };
}

function getItemDate(item: PrizeHistoryItem): string | null {
  if (item.type === 'withdrawal') return item.createdAt || null;
  return item.paidDate || item.createdAt || null;
}

function failLoud(userId: string, stage: string, detail?: unknown): never {
  logger.error(LOG_SOURCES.prizes.FETCH_FAILED, {
    actor: userId,
    err: detail instanceof Error ? detail.message : detail != null ? String(detail) : undefined,
    context: { stage },
  });
  throw new ApiError(503, 'Unable to load prize history');
}

export async function getPrizeHistoryForUser(userId: string): Promise<PrizeHistoryItem[]> {
  let synthetic: PrizeWin[];
  let localWithdrawals: Awaited<ReturnType<typeof getWithdrawalsByUser>>;
  try {
    [synthetic, localWithdrawals] = await Promise.all([
      getSyntheticPrizesForUser(userId),
      getWithdrawalsByUser(userId),
    ]);
  } catch (err) {
    failLoud(userId, 'firestore_layers', err);
  }

  const buildResult = async (goApiItems: PrizeHistoryItem[] | null) => {
    const goApiHasWithdrawals = goApiItems?.some((i) => i.type === 'withdrawal') ?? false;
    const allItems: PrizeHistoryItem[] = [
      ...(goApiItems ?? []),
      ...synthetic,
    ];
    if (!goApiHasWithdrawals) allItems.push(...localWithdrawals);

    // Apply overlays (processing/paid) to wins.
    const wins = allItems.filter((i): i is PrizeWin => i.type === 'win');
    const overlayMap = await getPrizeOverlays(wins.map((w) => w.id));
    const winsWithOverlays = applyOverlaysToWins(wins, overlayMap);

    const final: PrizeHistoryItem[] = [
      ...winsWithOverlays,
      ...allItems.filter((i) => i.type !== 'win'),
    ];
    final.sort((a, b) => {
      const aDate = getItemDate(a);
      const bDate = getItemDate(b);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return bDate.localeCompare(aDate);
    });
    return final;
  };

  if (!API_BASE) {
    // No Go API configured — legit config choice, not a failure.
    return buildResult(null);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/owner/${userId}/prizes`, { next: { revalidate: 60 } });
  } catch (err) {
    failLoud(userId, 'go_api_unreachable', err);
  }

  if (res.status === 404) {
    // The Go API has no /owner/{id}/prizes endpoint today — expected
    // steady state, not a failure. If the endpoint ever ships, this
    // branch just stops being hit.
    return buildResult(null);
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    failLoud(userId, 'go_api_error', `${res.status} ${message ?? ''}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    failLoud(userId, 'go_api_bad_json');
  }

  const normalized = normalizePrizeHistory(data, userId);
  // items === null means the payload shape was unrecognized — wins could
  // be silently missing, so that's a failure too, not an empty history.
  if (normalized.items === null) failLoud(userId, 'go_api_unrecognized_shape');
  return buildResult(normalized.items);
}
