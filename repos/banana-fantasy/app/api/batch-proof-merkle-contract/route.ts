import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/batch-proof-merkle-contract
 * Public read of the deployed BBB4BatchProofMerkle contract address.
 * Used by the draft proof explainer modal to surface a Basescan link.
 * Returns { contractAddress: '0x...' | null }.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    if (!isFirestoreConfigured()) {
      return json({ contractAddress: null });
    }
    const db = getAdminFirestore();
    const snap = await db.collection('system_config').doc('batchProofMerkle').get();
    if (!snap.exists) {
      return json({ contractAddress: null });
    }
    const data = snap.data() as { contractAddress?: string } | undefined;
    return json({ contractAddress: data?.contractAddress ?? null });
  } catch (err) {
    logger.error('batch_proof_merkle_contract.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
