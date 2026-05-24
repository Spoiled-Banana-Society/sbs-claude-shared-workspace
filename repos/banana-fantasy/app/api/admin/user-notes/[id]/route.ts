/**
 * DELETE /api/admin/user-notes/{id}
 *
 * Any admin can delete any note — the shared notebook model means the
 * team trusts each other to curate; an audit-log entry would be overkill
 * for a freeform notes field. Deletes are hard (no soft-delete) because
 * we already prune the list to 50 in the GET handler.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

export const dynamic = 'force-dynamic';

const COLLECTION = 'adminUserNotes';
const NOTE_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = (admin.walletAddress ?? admin.userId ?? '').toLowerCase();

    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const id = (params?.id ?? '').trim();
    if (!NOTE_ID_REGEX.test(id)) throw new ApiError(400, 'invalid note id');

    const db = getAdminFirestore();
    const docRef = db.collection(COLLECTION).doc(id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError(404, 'note not found');

    await docRef.delete();
    return json({ ok: true, id, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.user_notes.delete_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/user-notes/[id]',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
