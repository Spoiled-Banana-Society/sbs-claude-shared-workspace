/**
 * Admin user notes — shared notebook attached to a wallet.
 *
 * Visible to ALL admins (it's institutional memory: "this user already
 * tried fix X", "whale, escalate", "asked about offramp fees", etc.).
 * Stored as standalone docs in `adminUserNotes/{noteId}` so adds and
 * deletes don't rewrite the whole user document.
 *
 * GET  /api/admin/user-notes?wallet=…       List notes for a wallet, newest first.
 * POST /api/admin/user-notes  { wallet, text }   Append a note (stamps author + timestamp).
 *
 * DELETE per-id handler lives in ./[id]/route.ts.
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

const COLLECTION = 'adminUserNotes';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_TEXT_LEN = 2000;
const LIST_LIMIT = 50;

function normalizeWallet(raw: string): string {
  return raw.trim().toLowerCase();
}

interface NoteDoc {
  id: string;
  wallet: string;
  text: string;
  createdBy: string;
  createdAt: string | null;
}

function serializeNote(id: string, data: FirebaseFirestore.DocumentData): NoteDoc {
  const ts = data?.createdAt;
  const createdAt =
    ts && typeof ts.toDate === 'function' ? (ts.toDate() as Date).toISOString() : null;
  return {
    id,
    wallet: String(data?.wallet ?? ''),
    text: String(data?.text ?? ''),
    createdBy: String(data?.createdBy ?? ''),
    createdAt,
  };
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const url = new URL(req.url);
    const wallet = normalizeWallet(url.searchParams.get('wallet') ?? '');
    if (!WALLET_REGEX.test(wallet)) {
      throw new ApiError(400, 'wallet param required (40-hex with 0x prefix)');
    }

    const db = getAdminFirestore();
    const snap = await db
      .collection(COLLECTION)
      .where('wallet', '==', wallet)
      .orderBy('createdAt', 'desc')
      .limit(LIST_LIMIT)
      .get();

    const notes = snap.docs.map((d) => serializeNote(d.id, d.data()));
    return json({ ok: true, wallet, notes, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.user_notes.list_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/user-notes',
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
    const wallet = normalizeWallet(requireString(body.wallet, 'wallet'));
    if (!WALLET_REGEX.test(wallet)) throw new ApiError(400, 'wallet must be 40-hex');

    const text = requireString(body.text, 'text');
    if (text.length > MAX_TEXT_LEN) {
      throw new ApiError(400, `text exceeds ${MAX_TEXT_LEN} chars`);
    }

    const db = getAdminFirestore();
    const docRef = db.collection(COLLECTION).doc();
    await docRef.set({
      wallet,
      text,
      createdBy: actorWallet,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Read back the just-created doc so the response includes the resolved
    // serverTimestamp — saves the client a re-fetch right after add.
    const fresh = await docRef.get();
    const note = serializeNote(docRef.id, fresh.data() ?? {});

    return json({ ok: true, note, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.user_notes.create_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/user-notes',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
