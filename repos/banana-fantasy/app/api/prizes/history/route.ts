import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import crypto from 'node:crypto';

import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { mockPrizeHistory } from '@/lib/mock/prizes';
import { getWithdrawalsByUser } from '@/lib/db';
import type { PrizeHistoryItem, PrizeStatus, PrizeWithdrawal, WithdrawalStatus } from '@/types';

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
    const contestName = asString(record.contestName) || asString(record.displayName) || asString(record.leagueDisplayName) || 'Contest Prize';
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

function buildFallbackHistory(userId: string): PrizeHistoryItem[] {
  return mockPrizeHistory.map((item) => {
    if (item.type !== 'withdrawal') return item;
    return { ...item, userId };
  });
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;
  const userId = getSearchParam(req, 'userId');
  if (!userId) return jsonError('Missing query param: userId', 400);

  const fallback = buildFallbackHistory(userId);

  try {
    if (!API_BASE) {
      return json(fallback, 200);
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/owner/${userId}/prizes`, { next: { revalidate: 60 } });
    } catch (err) {
      console.error('Prize history backend fetch failed:', err);
      return json(fallback, 200);
    }

    if (!res.ok) {
      const message = await readErrorMessage(res);
      console.error(`Prize history API error: ${res.status}`, message);
      return json(fallback, 200);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      console.error('Invalid prize history response from backend');
      return json(fallback, 200);
    }

    const normalized = normalizePrizeHistory(data, userId);
    if (!normalized.items) return json(fallback, 200);

    const merged: PrizeHistoryItem[] = [...normalized.items];
    if (!normalized.hasWithdrawals) {
      const localWithdrawals = await getWithdrawalsByUser(userId);
      merged.push(...localWithdrawals);
    }

    merged.sort((a, b) => {
      const aDate = getItemDate(a);
      const bDate = getItemDate(b);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return bDate.localeCompare(aDate);
    });

    return json(merged, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Prize history fetch failed:', err);
    return json(fallback, 200);
  }
}
