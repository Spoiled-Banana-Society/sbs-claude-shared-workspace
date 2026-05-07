import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isFounderDraftMarked, markFounderDraft, recordFounderDraftJoin } from '@/lib/db';
import { isFounderDraft, EMPTY_SCHEDULE, type FounderSchedule } from '@/lib/founderDraft';
import { logger } from '@/lib/logger';

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
 * Credit every human drafter in a Founder Draft. Bot owners (ids that
 * start with "bot-") are skipped. Each call to recordFounderDraftJoin is
 * idempotent — re-credits are no-ops via the founderHistory dedupe.
 *
 * Marks `creditedAt` on the founderDrafts doc so subsequent check calls
 * don't redo the per-drafter Firestore writes; if the field is missing,
 * the credit loop runs even when the draft is already marked Founder
 * (this lets us self-heal old marker docs that pre-date this code).
 */
async function creditAllDraftersIfNeeded(
  draftId: string,
  draftOrder: { ownerId: string }[],
): Promise<void> {
  if (!isFirestoreConfigured()) return;
  const db = getAdminFirestore();
  const ref = db.collection('founderDrafts').doc(draftId);
  const snap = await ref.get();
  if (!snap.exists) return; // marker not written yet — caller should mark first
  const data = snap.data() || {};
  if (data.creditedAt) return; // already credited, idempotent skip

  const humans = draftOrder
    .map(o => (o?.ownerId || '').toLowerCase())
    .filter(o => o && !o.startsWith('bot-'));

  for (const wallet of humans) {
    try {
      await recordFounderDraftJoin(wallet, draftId);
    } catch (err) {
      logger.warn('founder-drafts.credit.failed', { wallet, draftId, err });
      // continue — partial credit is better than none
    }
  }

  await ref.set({ creditedAt: new Date().toISOString() }, { merge: true });
}

/**
 * GET /api/founder-drafts/check?draftId=X
 *
 * Source-of-truth check for whether a draft is a Founder Draft. Reads from
 * the persistent `founderDrafts` collection — once a draft is marked, it
 * stays marked forever, even if the founder schedule changes later.
 *
 * For drafts not yet persisted, evaluates live eligibility (schedule
 * active + within window + founder wallet in draftOrder) and AUTO-PROMOTES
 * them to persistent if eligible. This means the moment any client renders
 * a FounderPill on a qualifying draft, it gets locked in permanently.
 *
 * On promotion (and on first observation of an already-persisted draft
 * that hasn't been credited yet), credits every human drafter's
 * founder-draft promo. This removes the dependency on each individual
 * drafter firing an authenticated POST from their own browser — which
 * could fail for transient Privy auth reasons and cause some drafters to
 * miss the credit entirely.
 *
 * Returns { isFounder: boolean }.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const draftId = getSearchParam(req, 'draftId');
  if (!draftId) return jsonError('draftId is required', 400);

  try {
    // 1. Persistent flag — most authoritative.
    if (await isFounderDraftMarked(draftId)) {
      // Self-heal: if the marker exists but credit hasn't fired (older
      // marker docs from before bulk-credit shipped), run the credit loop
      // now. The Go API draftOrder lookup is the source of truth for who
      // was in the draft.
      const info = await fetchDraftInfo(draftId);
      if (info?.draftOrder) {
        await creditAllDraftersIfNeeded(draftId, info.draftOrder);
      }
      return json({ isFounder: true, source: 'persisted' }, 200);
    }

    // 2. Not marked. Check live eligibility — if it qualifies under the
    //    current schedule, persist it now and return true.
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
    await creditAllDraftersIfNeeded(draftId, info.draftOrder);
    return json({ isFounder: true, source: 'auto-promoted' }, 200);
  } catch {
    return json({ isFounder: false }, 200);
  }
}
