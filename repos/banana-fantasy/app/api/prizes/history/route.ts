import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import crypto from 'node:crypto';

import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';
import { getWithdrawalsByUser } from '@/lib/db';
import {
  applyOverlaysToWins,
  getPrizeOverlays,
  getSyntheticPrizesForUser,
} from '@/lib/prizeOverlay';
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

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;
  const userId = getSearchParam(req, 'userId');
  if (!userId) return jsonError('Missing query param: userId', 400);

  // This endpoint returns MONEY. Every source failure below is a hard 503,
  // never a silent empty list — an empty list renders as "$0.00, win drafts
  // to get started", which is indistinguishable from a real zero balance and
  // would terrify a user whose winnings are actually fine. Correctness over
  // availability: the frontend shows "unable to load, refresh" on 503.
  let synthetic: PrizeWin[];
  let localWithdrawals: Awaited<ReturnType<typeof getWithdrawalsByUser>>;
  try {
    [synthetic, localWithdrawals] = await Promise.all([
      getSyntheticPrizesForUser(userId),
      getWithdrawalsByUser(userId),
    ]);
  } catch (err) {
    logger.error(LOG_SOURCES.prizes.FETCH_FAILED, {
      actor: userId,
      err: err instanceof Error ? err.message : String(err),
      context: { stage: 'firestore_layers' },
    });
    return jsonError('Unable to load prize history', 503);
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

  const failLoud = (stage: string, detail?: unknown) => {
    logger.error(LOG_SOURCES.prizes.FETCH_FAILED, {
      actor: userId,
      err: detail instanceof Error ? detail.message : detail != null ? String(detail) : undefined,
      context: { stage },
    });
    return jsonError('Unable to load prize history', 503);
  };

  try {
    if (!API_BASE) {
      // No Go API configured — legit config choice, not a failure.
      // Surface synthetic + local-only.
      return json(await buildResult(null), 200);
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/owner/${userId}/prizes`, { next: { revalidate: 60 } });
    } catch (err) {
      return failLoud('go_api_unreachable', err);
    }

    if (res.status === 404) {
      // The Go API has no /owner/{id}/prizes endpoint today (verified
      // 2026-06-09: it's not in owner/owner.go) — prize records live
      // entirely in our Firestore (synthetic_prizes + withdrawals).
      // 404 is the expected steady state, not a failure. If the endpoint
      // ever ships, this branch just stops being hit.
      return json(await buildResult(null), 200);
    }

    if (!res.ok) {
      const message = await readErrorMessage(res);
      return failLoud('go_api_error', `${res.status} ${message ?? ''}`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return failLoud('go_api_bad_json');
    }

    const normalized = normalizePrizeHistory(data, userId);
    // items === null means the payload shape was unrecognized — wins could
    // be silently missing, so that's a failure too, not an empty history.
    if (normalized.items === null) return failLoud('go_api_unrecognized_shape');
    return json(await buildResult(normalized.items), 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return failLoud('unexpected', err);
  }
}
