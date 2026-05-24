/**
 * Mark an error group as "resolved" so it stops counting in the chip
 * tallies + drops out of the active feed.
 *
 * GET  /api/admin/error-resolved             → { resolved: { [groupKey]: { at, byWallet, note? } } }
 *      Returns the full map (small — one doc per resolved group, bounded).
 *
 * POST /api/admin/error-resolved             body { groupKey, resolved: true|false, note? }
 *      Upserts or clears a resolution. `resolved:false` deletes the doc so
 *      the group reappears in the active feed.
 *
 * Phase 6.5 of the admin overhaul (May 2026). Pairs with the per-source
 * runbook editor: runbook = "how to handle this when it happens",
 * resolved-marker = "I confirmed this is fixed, stop showing it."
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { FieldValue } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

export const dynamic = 'force-dynamic';

const COLLECTION = 'adminResolvedErrors';
const MAX_NOTE_LEN = 500;
const LIST_LIMIT = 500;

// Group keys are produced client-side as `<normalized-source>|<normalized-message-prefix>`.
// They can contain almost any character; sanitize to a Firestore-safe doc id by
// hashing with a short hex digest. Stays stable and deterministic.
function hashGroupKey(groupKey: string): string {
  // FNV-1a 32-bit hash — collision-resistant enough for ~10k groups, no crypto cost.
  let h = 0x811c9dc5;
  for (let i = 0; i < groupKey.length; i += 1) {
    h ^= groupKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 8-hex doc id, zero-padded
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');
    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).limit(LIST_LIMIT).get();
    const resolved: Record<string, { at: string | null; byWallet: string; note?: string }> = {};
    for (const doc of snap.docs) {
      const d = doc.data() ?? {};
      const groupKey = String(d.groupKey ?? '');
      if (!groupKey) continue;
      const ts = d.at;
      const atIso =
        ts && typeof ts.toDate === 'function' ? (ts.toDate() as Date).toISOString() : null;
      resolved[groupKey] = {
        at: atIso,
        byWallet: String(d.byWallet ?? ''),
        ...(d.note ? { note: String(d.note) } : {}),
      };
    }
    return json({ ok: true, resolved, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.error_resolved.list_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/error-resolved',
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = (admin.walletAddress ?? admin.userId ?? '').toLowerCase();

    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const body = await parseBody(req);
    const groupKey = requireString(body.groupKey, 'groupKey');
    const resolved = body.resolved !== false; // default true; explicit false clears
    const note =
      typeof body.note === 'string' && body.note.trim()
        ? body.note.trim().slice(0, MAX_NOTE_LEN)
        : null;

    const db = getAdminFirestore();
    const ref = db.collection(COLLECTION).doc(hashGroupKey(groupKey));

    if (!resolved) {
      // Reopening — delete the doc so the group reappears in the feed.
      await ref.delete().catch(() => { /* ignore non-existent */ });
      logger.info('admin.error_resolved.reopened', {
        actor: actorWallet,
        route: 'admin/error-resolved',
        context: { groupKey },
      });
      return json({ ok: true, resolved: false, groupKey, requestId });
    }

    await ref.set(
      {
        groupKey,
        byWallet: actorWallet,
        at: FieldValue.serverTimestamp(),
        ...(note ? { note } : {}),
      },
      { merge: true },
    );
    logger.info('admin.error_resolved.marked', {
      actor: actorWallet,
      route: 'admin/error-resolved',
      context: { groupKey, hasNote: !!note },
    });
    return json({ ok: true, resolved: true, groupKey, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.error_resolved.save_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/error-resolved',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
