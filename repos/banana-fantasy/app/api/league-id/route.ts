import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

/**
 * League number → draft id ("BBB #1208" → "2026-fast-draft-1072"). The league
 * number on the card is NOT the number in the draft id, so the leaderboard's
 * league lookup resolves it here (drafts.DisplayName equality, auto-indexed).
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  const raw = (getSearchParam(req, 'number') || '').trim();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return jsonError('Invalid league number', 400);
  if (!isFirestoreConfigured()) return jsonError('Not configured', 503);
  try {
    const db = getAdminFirestore();
    const snap = await db.collection('drafts').where('DisplayName', '==', `BBB #${n}`).limit(1).get();
    if (snap.empty) return jsonError('League not found', 404);
    const doc = snap.docs[0];
    return json({ draftId: doc.id, displayName: doc.get('DisplayName'), level: doc.get('Level') ?? null }, 200);
  } catch (err) {
    console.error('league-id lookup failed:', err);
    return jsonError('Lookup failed', 500);
  }
}
