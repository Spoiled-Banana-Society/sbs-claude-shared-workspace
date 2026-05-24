/**
 * Admin error runbooks — per-source freeform notes ("when this fires, do X").
 *
 * Visible to ALL admins (institutional memory for the on-call playbook).
 * Each runbook is one document per error source — POST upserts the body,
 * GET reads it, no delete needed (just clear the text to wipe).
 *
 * GET  /api/admin/error-runbooks?source=…       Returns { text } (or empty).
 * POST /api/admin/error-runbooks { source, text }   Upserts the runbook.
 *
 * Phase 4 of the admin overhaul (May 2026). Pairs with the in-code
 * `explainError(source, msg)` mapping in lib/logSources.ts — that's the
 * default plain-English label for a source; the runbook is the editable
 * extension where admins capture things the code doesn't know.
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

const COLLECTION = 'adminErrorRunbooks';
const MAX_TEXT_LEN = 4000;
// Source keys are dotted identifiers (e.g. `notifications.push.zero_recipients`).
// Allow letters, digits, dot, dash, underscore, colon — nothing surprising
// enough to break Firestore doc-ID rules (slashes are forbidden by Firestore).
const SOURCE_REGEX = /^[a-zA-Z0-9._:-]{1,200}$/;

function docIdFromSource(source: string): string {
  // Firestore doc IDs cannot contain `/`. Sources never have one today,
  // but normalize defensively (replace any `/` with `_`) for forward-safety.
  return source.replace(/\//g, '_');
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const url = new URL(req.url);
    const source = (url.searchParams.get('source') ?? '').trim();
    if (!SOURCE_REGEX.test(source)) {
      throw new ApiError(400, 'source param required (alnum/dot/dash/underscore/colon)');
    }

    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).doc(docIdFromSource(source)).get();
    if (!snap.exists) {
      return json({ ok: true, source, text: '', requestId });
    }
    const data = snap.data() ?? {};
    return json({
      ok: true,
      source,
      text: String(data.text ?? ''),
      updatedBy: String(data.updatedBy ?? ''),
      requestId,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.error_runbooks.list_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/error-runbooks',
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
    const source = requireString(body.source, 'source');
    if (!SOURCE_REGEX.test(source)) {
      throw new ApiError(400, 'source must match [a-zA-Z0-9._:-]{1,200}');
    }
    const text = typeof body.text === 'string' ? body.text : '';
    if (text.length > MAX_TEXT_LEN) {
      throw new ApiError(400, `text exceeds ${MAX_TEXT_LEN} chars`);
    }

    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(docIdFromSource(source)).set(
      {
        source,
        text,
        updatedBy: actorWallet,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return json({ ok: true, source, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.error_runbooks.save_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/error-runbooks',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
