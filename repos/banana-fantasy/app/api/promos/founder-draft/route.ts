import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { recordFounderDraftJoin, markFounderDraft } from '@/lib/db';
import { isFounderDraft, EMPTY_SCHEDULE, type FounderSchedule } from '@/lib/founderDraft';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

// Hardcoded staging — same pattern as /api/spectate/draft-state.
const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

function getServerDraftsApiUrl(): string {
  return (process.env.STAGING_DRAFTS_API_URL || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

interface DraftInfoResponse {
  draftId: string;
  draftStartTime: number;
  draftOrder: { ownerId: string; tokenId: string }[];
}

async function fetchDraftInfo(draftId: string): Promise<DraftInfoResponse | null> {
  try {
    const url = `${getServerDraftsApiUrl()}/draft/${encodeURIComponent(draftId)}/state/info`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as DraftInfoResponse;
  } catch {
    return null;
  }
}

async function fetchSchedule(): Promise<FounderSchedule> {
  if (!isFirestoreConfigured()) return EMPTY_SCHEDULE;
  try {
    const db = getAdminFirestore();
    const snap = await db.collection('founderSchedule').doc('next').get();
    if (!snap.exists) return EMPTY_SCHEDULE;
    const data = snap.data() as Partial<FounderSchedule> | undefined;
    return {
      at: typeof data?.at === 'string' ? data.at : '',
      dayLabel: typeof data?.dayLabel === 'string' ? data.dayLabel : '',
      founderWallet: typeof data?.founderWallet === 'string' ? data.founderWallet.toLowerCase() : '',
      windowMinutes: Number.isFinite(data?.windowMinutes) ? Number(data!.windowMinutes) : 10,
      active: data?.active === true,
    };
  } catch {
    return EMPTY_SCHEDULE;
  }
}

/**
 * POST /api/promos/founder-draft
 * Body: { draftId }
 *
 * Caller is authenticated via Privy. Server validates:
 *  1. The draft is a Founder Draft (schedule active + within window + founder wallet in draftOrder).
 *  2. The caller's wallet is also in the draftOrder (no crediting non-participants).
 * Then credits the founder-draft promo. Idempotent via draftId dedupe in
 * recordFounderDraftJoin.
 *
 * Note: every drafter in a Founder Draft gets credited (unlike JP, which
 * picks 1 of 10). The frontend POSTs once per drafter when their copy of
 * the draft room sees the draft fill.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  let actorWallet: string | undefined;
  try {
    const { walletAddress } = await getPrivyUser(req);
    actorWallet = walletAddress ?? undefined;
    if (!walletAddress) throw new ApiError(401, 'Authenticated wallet address missing from token');

    const body = await parseBody(req);
    const draftId = requireString(body.draftId, 'draftId');

    const [info, schedule] = await Promise.all([
      fetchDraftInfo(draftId),
      fetchSchedule(),
    ]);

    if (!info) throw new ApiError(404, 'draft not found');
    if (!isFounderDraft(info.draftStartTime, info.draftOrder, schedule)) {
      throw new ApiError(400, 'draft is not a Founder Draft');
    }

    const callerInDraft = info.draftOrder.some(
      o => (o?.ownerId || '').toLowerCase() === walletAddress.toLowerCase(),
    );
    if (!callerInDraft) {
      throw new ApiError(403, 'caller is not in this draft');
    }

    // Persist the founder-draft flag for this draftId BEFORE crediting.
    // Once persisted, the FounderPill renders for this draft forever, even
    // if the schedule changes later. Idempotent — first writer wins.
    await markFounderDraft(draftId, {
      founderWallet: schedule.founderWallet,
      scheduleAt: schedule.at,
    });
    const promo = await recordFounderDraftJoin(walletAddress, draftId);
    return json({ promo }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error(LOG_SOURCES.promo.FOUNDER_DRAFT_FAILED, { err, actor: actorWallet });
    return jsonError('Internal Server Error', 500);
  }
}
