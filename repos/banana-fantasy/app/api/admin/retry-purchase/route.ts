import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { verifyPurchase } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

const PURCHASES_COLLECTION = 'v2_purchases';

/**
 * Admin-only: retry verification for a pending purchase identified by txHash.
 * Useful when the original verify ran under old (stricter) rules and left the
 * purchase stuck in 'pending' even though the on-chain mint succeeded.
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const body = await parseBody(req);
    const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new ApiError(400, 'Invalid txHash');
    }

    const db = getAdminFirestore();
    // Find the most recent pending purchase with this txHash, OR any pending
    // purchase for the wallet if body.walletAddress is provided.
    let purchaseId: string | null = null;
    const byTxSnap = await db
      .collection(PURCHASES_COLLECTION)
      .where('txHash', '==', txHash)
      .limit(1)
      .get();
    if (!byTxSnap.empty) {
      purchaseId = byTxSnap.docs[0].id;
    } else if (typeof body.walletAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.walletAddress)) {
      const wallet = body.walletAddress.toLowerCase();
      const pendingSnap = await db
        .collection(PURCHASES_COLLECTION)
        .where('userId', '==', wallet)
        .where('status', '==', 'pending')
        .limit(5)
        .get();
      if (!pendingSnap.empty) {
        purchaseId = pendingSnap.docs[0].id;
      }
    }

    if (!purchaseId) throw new ApiError(404, 'No matching purchase found');

    const result = await verifyPurchase(purchaseId, txHash);
    logger.info('admin.retry_purchase.ok', { requestId, purchaseId, txHash });
    return json({ success: true, purchaseId, result, requestId });
  } catch (err) {
    logger.error('admin.retry_purchase.failed', { requestId, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
