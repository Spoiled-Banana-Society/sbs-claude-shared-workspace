import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { type CollectionReference, type DocumentData } from 'firebase-admin/firestore';

import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function resolveUsersCollection(): Promise<CollectionReference<DocumentData>> {
  const db = getAdminFirestore();
  const usersRef = db.collection('users');
  const v2UsersRef = db.collection('v2_users');

  const [usersProbe, v2Probe] = await Promise.all([usersRef.limit(1).get(), v2UsersRef.limit(1).get()]);

  if (!usersProbe.empty) return usersRef;
  if (!v2Probe.empty) return v2UsersRef;
  return usersRef;
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);

    const db = getAdminFirestore();
    const usersCollection = await resolveUsersCollection();

    const [usersCountSnap, withdrawalsSnap, usersSnap] = await Promise.all([
      usersCollection.count().get(),
      db.collection('withdrawalRequests').get(),
      usersCollection.get(),
    ]);

    let pendingWithdrawals = 0;
    let totalWithdrawalAmount = 0;

    for (const doc of withdrawalsSnap.docs) {
      const data = doc.data();
      const status = typeof data.status === 'string' ? data.status : '';
      if (status === 'pending') pendingWithdrawals += 1;
      totalWithdrawalAmount += toNumber(data.amount);
    }

    let verifiedUsers = 0;
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      if (data.blueCheckVerified === true || data.isBlueCheckVerified === true) {
        verifiedUsers += 1;
      }
    }

    return json(
      {
        totalUsers: usersCountSnap.data().count,
        pendingWithdrawals,
        totalWithdrawalAmount,
        verifiedUsers,
      },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[admin/stats] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
