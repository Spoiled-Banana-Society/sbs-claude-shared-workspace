import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

export interface ErrorEventRecord {
  source: string;        // e.g. 'admin.grant_drafts.failed'
  route?: string;        // e.g. '/api/admin/grant-drafts'
  message: string;
  stack?: string;
  requestId?: string;
  actor?: string;
  context?: Record<string, unknown>;
  sessionId?: string;    // debug session — links to v2_debug_events trace
  timestamp: string;     // ISO
}

const COLLECTION = 'v2_error_events';

/**
 * Fire-and-forget error event write. Never throws — silently drops if Firestore
 * is unreachable so the caller's error handling isn't disrupted by our logging.
 */
export function logErrorEvent(record: Omit<ErrorEventRecord, 'timestamp'>): void {
  if (!isFirestoreConfigured()) return;
  try {
    const db = getAdminFirestore();
    const doc: ErrorEventRecord = {
      ...record,
      timestamp: new Date().toISOString(),
    };
    // Intentional fire-and-forget — we don't await
    void db.collection(COLLECTION).add(doc).catch(() => {
      /* swallow */
    });
  } catch {
    /* swallow */
  }
}

export async function fetchRecentErrors(limit = 100): Promise<ErrorEventRecord[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .orderBy('timestamp', 'desc')
    .limit(Math.min(limit, 500))
    .get();
  return snap.docs.map((d) => d.data() as ErrorEventRecord);
}
