import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export type AdminAction =
  | 'grant-drafts'
  | 'ban-user'
  | 'unban-user'
  | 'approve-withdrawal'
  | 'deny-withdrawal'
  | 'mark-paid-withdrawal'
  | 'grant-prize'
  | 'set-entries'
  | 'create-promo'
  | 'reset-queue'
  | 'zero-free-drafts'
  | 'kyc-verify'
  | 'kyc-revoke'
  | 'reset-user'
  | 'revoke-7702'
  | 'deploy-batch-proof'
  | 'transfer-batchproof-ownership'
  | 'recover-draft-card'
  | 'deploy-wheel-proof'
  | 'wheel-period-open'
  | 'wheel-period-finalize'
  | 'wheel-period-reveal';

export interface AdminActionRecord {
  actor: string;          // wallet address of admin who performed action
  action: AdminAction;
  target: string;         // wallet / doc id affected
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId: string;
  timestamp: string;      // ISO
}

const COLLECTION = 'v2_admin_actions';

export async function logAdminAction(record: Omit<AdminActionRecord, 'timestamp'>): Promise<void> {
  if (!isFirestoreConfigured()) {
    logger.warn('admin.audit.skipped', { reason: 'firestore_not_configured', ...record });
    return;
  }
  try {
    const db = getAdminFirestore();
    const doc: AdminActionRecord = {
      ...record,
      actor: record.actor.toLowerCase(),
      target: record.target.toLowerCase(),
      timestamp: new Date().toISOString(),
    };
    await db.collection(COLLECTION).add(doc);
    logger.info('admin.audit.logged', {
      action: doc.action,
      actor: doc.actor,
      target: doc.target,
      requestId: doc.requestId,
    });
  } catch (err) {
    // Never fail the parent request because audit writing failed.
    logger.error('admin.audit.write_failed', { err, ...record });
  }
}

export async function fetchRecentAdminActions(limit = 50): Promise<AdminActionRecord[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .orderBy('timestamp', 'desc')
    .limit(Math.min(limit, 500))
    .get();
  return snap.docs.map((d) => d.data() as AdminActionRecord);
}
