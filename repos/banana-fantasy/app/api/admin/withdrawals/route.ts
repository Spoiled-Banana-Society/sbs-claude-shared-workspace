import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { type Timestamp } from 'firebase-admin/firestore';

import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

type FirestoreTimestamp = Timestamp | { toDate: () => Date };

function toIsoDate(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as FirestoreTimestamp).toDate === 'function') {
    const date = (value as FirestoreTimestamp).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);

    const db = getAdminFirestore();
    const snap = await db.collection('withdrawalRequests').orderBy('createdAt', 'desc').get();

    const withdrawals = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: typeof data.userId === 'string' ? data.userId : '',
        walletAddress: typeof data.walletAddress === 'string' ? data.walletAddress : '',
        amount: toNumber(data.amount),
        status: typeof data.status === 'string' ? data.status : 'pending',
        createdAt: toIsoDate(data.createdAt),
        blueCheckVerified: toBoolean(data.blueCheckVerified ?? data.isBlueCheckVerified),
      };
    });

    return json(withdrawals, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/withdrawals] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
