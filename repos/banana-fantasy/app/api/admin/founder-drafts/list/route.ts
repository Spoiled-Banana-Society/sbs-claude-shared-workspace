/**
 * GET /api/admin/founder-drafts/list
 *
 * Lists every confirmed founder draft (i.e. every doc in the
 * `founderDrafts` collection) along with the participants pulled live
 * from the Go drafts API, plus a 'bulkSpinGrantedAt' marker so the
 * admin UI can tell which drafts have already been bulk-spun and which
 * still need to be processed.
 *
 * Built May 2026 for Boris's founder-draft admin workflow:
 *   1. Boris/Richard time their draft entry to the scheduled slot.
 *   2. Whichever draft they land in becomes the founder draft.
 *   3. The 9 OTHER players in that draft each get +1 wheel spin as
 *      the "you happened to be in the founder draft" reward.
 *   4. This endpoint surfaces the data; a bulk-grant endpoint applies
 *      the reward (admin/founder-drafts/grant-spins).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     drafts: [
 *       {
 *         draftId,
 *         markedAt,
 *         founderWallet,
 *         scheduleAt,
 *         participants: [{ wallet, isFounder }],
 *         bulkSpinGrantedAt: string | null,
 *         bulkSpinGrantedBy: string | null,
 *       },
 *       ...
 *     ]
 *   }
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FOUNDER_DRAFTS_COLLECTION = 'founderDrafts';
const LIST_LIMIT = 50;

const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
function goApiBase(): string {
  return (process.env.STAGING_DRAFTS_API_URL
    || process.env.NEXT_PUBLIC_SBS_API_URL
    || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

interface DraftInfoResponse {
  draftId: string;
  draftStartTime: number;
  draftOrder?: { ownerId: string; tokenId?: string }[];
}

async function fetchDraftInfo(draftId: string): Promise<DraftInfoResponse | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(`${goApiBase()}/draft/${encodeURIComponent(draftId)}/state/info`, {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as DraftInfoResponse;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();
    const snap = await db.collection(FOUNDER_DRAFTS_COLLECTION).limit(LIST_LIMIT).get();

    // For each draft doc, fan out the Go-API participant fetch in
    // parallel. Bounded by LIST_LIMIT so it stays fast.
    const drafts = await Promise.all(snap.docs.map(async (doc) => {
      const data = doc.data() ?? {};
      const draftId = doc.id;
      const markedAtRaw = data.markedAt;
      const markedAt = markedAtRaw && typeof markedAtRaw.toDate === 'function'
        ? (markedAtRaw.toDate() as Date).toISOString()
        : (typeof markedAtRaw === 'string' ? markedAtRaw : null);
      const founderWallet = typeof data.founderWallet === 'string' ? data.founderWallet.toLowerCase() : null;
      const scheduleAt = typeof data.scheduleAt === 'string' ? data.scheduleAt : null;
      const bulkRaw = data.bulkSpinGrantedAt;
      const bulkSpinGrantedAt = bulkRaw && typeof bulkRaw.toDate === 'function'
        ? (bulkRaw.toDate() as Date).toISOString()
        : (typeof bulkRaw === 'string' ? bulkRaw : null);

      const info = await fetchDraftInfo(draftId);
      const participants = (info?.draftOrder ?? []).map((o) => ({
        wallet: (o.ownerId ?? '').toLowerCase(),
        isFounder: founderWallet ? (o.ownerId ?? '').toLowerCase() === founderWallet : false,
      })).filter((p) => p.wallet);

      return {
        draftId,
        markedAt,
        founderWallet,
        scheduleAt,
        participants,
        participantCount: participants.length,
        nonFounderCount: participants.filter((p) => !p.isFounder).length,
        bulkSpinGrantedAt,
        bulkSpinGrantedBy: typeof data.bulkSpinGrantedBy === 'string' ? data.bulkSpinGrantedBy : null,
      };
    }));

    // Newest first.
    drafts.sort((a, b) => (b.markedAt ?? '').localeCompare(a.markedAt ?? ''));

    logger.info('admin.founder_drafts.list_ok', {
      requestId,
      context: { count: drafts.length },
    });

    return json({ ok: true, drafts, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.founder_drafts.list_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/founder-drafts/list',
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
