import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { runInBackground } from '@/lib/serverBackground';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { isFounderDraftMarked, markFounderDraft, recordFounderDraftJoin, unlockBadge } from '@/lib/db';
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
 * idempotent — re-credits are no-ops via the founderHistory dedupe, so
 * we always re-run the loop instead of gating on a `creditedAt` flag.
 * That keeps things self-healing if any individual write failed.
 */
async function creditAllDrafters(
  draftId: string,
  draftOrder: { ownerId: string }[],
): Promise<{ humans: string[]; results: Array<{ wallet: string; ok: boolean; reason?: string }> }> {
  const out = {
    humans: [] as string[],
    results: [] as Array<{ wallet: string; ok: boolean; reason?: string }>,
  };
  if (!isFirestoreConfigured()) return out;
  const db = getAdminFirestore();
  const ref = db.collection('founderDrafts').doc(draftId);
  const snap = await ref.get();
  if (!snap.exists) return out;

  const humans = draftOrder
    .map(o => (o?.ownerId || '').toLowerCase())
    .filter(o => o && !o.startsWith('bot-'));
  out.humans = humans;

  for (const wallet of humans) {
    try {
      const promo = await recordFounderDraftJoin(wallet, draftId);
      // Founders League badge — playing in a founder draft earns it. Idempotent
      // + fires the bell/toast on first unlock. waitUntil-backed so the unlock
      // survives the response without blocking the founder-promo credit.
      runInBackground('founders-badge', unlockBadge(wallet, 'founders-league', { draftId }));
      out.results.push({
        wallet,
        ok: !!promo,
        reason: promo ? undefined : 'recordFounderDraftJoin returned null',
      });
    } catch (err) {
      logger.warn('founder-drafts.credit.failed', { wallet, draftId, err });
      out.results.push({
        wallet,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await ref.set({ creditedAt: new Date().toISOString() }, { merge: true });
  return out;
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
      const info = await fetchDraftInfo(draftId);
      let credit;
      if (info?.draftOrder) {
        credit = await creditAllDrafters(draftId, info.draftOrder);
      }
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
    const credit = await creditAllDrafters(draftId, info.draftOrder);
    return json({ isFounder: true, source: 'auto-promoted', ...(debug ? { credit } : {}) }, 200);
  } catch (err) {
    if (debug) {
      return json({ isFounder: false, error: err instanceof Error ? err.message : String(err) }, 200);
    }
    return json({ isFounder: false }, 200);
  }
}
