import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isFounderDraftMarked, markFounderDraft } from '@/lib/db';
import { creditFounderDraft } from '@/lib/founderGrant';
import { isFounderDraft, EMPTY_SCHEDULE, type FounderSchedule } from '@/lib/founderDraft';

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
 * GET /api/founder-drafts/check?draftId=X[&debug=1]
 *
 * Source-of-truth check for whether a draft is a Founder Draft. Reads from
 * the persistent `founderDrafts` collection — once a draft is marked, it
 * stays marked forever, even if the founder schedule changes later.
 *
 * For drafts not yet persisted, evaluates live eligibility (schedule
 * active + within window + founder wallet in draftOrder) and AUTO-PROMOTES
 * them to persistent if eligible.
 *
 * On every call to a marked draft, also credits every human drafter's
 * founder-draft promo. This removes the dependency on each individual
 * drafter firing an authenticated POST from their own browser — which
 * could fail for transient Privy auth reasons and cause some drafters to
 * miss the credit entirely. recordFounderDraftJoin is idempotent.
 *
 * `debug=1` returns the per-wallet credit results for diagnostics.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const draftId = getSearchParam(req, 'draftId');
  if (!draftId) return jsonError('draftId is required', 400);
  const debug = req.url.includes('debug=1');

  try {
    if (await isFounderDraftMarked(draftId)) {
      // Safety-net credit (idempotent, only acts once the draft is full). The
      // primary trigger is the on-fill POST /api/promos/founder-draft.
      const info = await fetchDraftInfo(draftId);
      const credit = info?.draftOrder ? await creditFounderDraft(draftId, info.draftOrder) : undefined;
      return json({ isFounder: true, source: 'persisted', ...(debug ? { credit } : {}) }, 200);
    }

    const [info, schedule] = await Promise.all([
      fetchDraftInfo(draftId),
      fetchSchedule(),
    ]);
    if (!info || !schedule.active) return json({ isFounder: false }, 200);
    if (!isFounderDraft(info.draftStartTime, info.draftOrder, schedule)) {
      return json({ isFounder: false }, 200);
    }

    await markFounderDraft(draftId, {
      founderWallet: schedule.founderWallet,
      scheduleAt: schedule.at,
    });
    const credit = await creditFounderDraft(draftId, info.draftOrder);
    return json({ isFounder: true, source: 'auto-promoted', ...(debug ? { credit } : {}) }, 200);
  } catch (err) {
    if (debug) {
      return json({ isFounder: false, error: err instanceof Error ? err.message : String(err) }, 200);
    }
    return json({ isFounder: false }, 200);
  }
}
