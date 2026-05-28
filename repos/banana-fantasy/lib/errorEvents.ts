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
 * Persist an error event to v2_error_events. Returns a Promise the caller
 * MUST await before responding, otherwise on Vercel serverless the function
 * instance gets reaped before the Firestore write completes and the write
 * silently drops — that's the bug that hollowed out v2_error_events for two
 * days, including all of today's draft.airplane.trace diagnostics.
 *
 * Never throws — internal errors are caught and logged via console so
 * caller's response flow isn't affected. Returns false on failure so the
 * caller can surface that in their own logger if they care.
 */
export async function logErrorEvent(
  record: Omit<ErrorEventRecord, 'timestamp'>,
): Promise<boolean> {
  if (!isFirestoreConfigured()) return false;
  try {
    const db = getAdminFirestore();
    const doc: ErrorEventRecord = {
      ...record,
      timestamp: new Date().toISOString(),
    };
    await db.collection(COLLECTION).add(doc);
    return true;
  } catch (err) {
    // Last-chance visibility — at minimum the Vercel runtime log captures this
    // so we never end up silently dropping events again.
    console.error('[errorEvents] Firestore write failed', err);
    return false;
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
