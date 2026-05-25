/**
 * POST /api/admin/founder-drafts/grant-spins
 *   body: { draftId: string }
 *
 * Bulk-grants +1 wheel spin to every NON-founder participant of a
 * confirmed founder draft. Idempotent — sets bulkSpinGrantedAt on the
 * founder-draft doc so calling twice is a no-op (returns the existing
 * grant info).
 *
 * Boris's spec: "we can agree that this was the founder draft → these
 * were the wallets → now send them all spins." This is the manual
 * one-click version. The next iteration (separate task) wires it to a
 * weekly cron that auto-runs against any unprocessed founder drafts.
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { FieldValue } from 'firebase-admin/firestore';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { buildActivityEventDoc, addActivityEventToTx } from '@/lib/activityEvents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FOUNDER_DRAFTS_COLLECTION = 'founderDrafts';
const USERS_COLLECTION = 'v2_users';
const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

function goApiBase(): string {
  return (process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
    || process.env.STAGING_DRAFTS_API_URL
    || process.env.NEXT_PUBLIC_SBS_API_URL
    || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

async function fetchDraftParticipants(draftId: string): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${goApiBase()}/draft/${encodeURIComponent(draftId)}/state/info`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { draftOrder?: { ownerId?: string }[] };
    return (data.draftOrder ?? [])
      .map((o) => (o.ownerId ?? '').toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
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
    const draftId = requireString(body.draftId, 'draftId');

    const db = getAdminFirestore();
    const founderDraftRef = db.collection(FOUNDER_DRAFTS_COLLECTION).doc(draftId);
    const founderDraftSnap = await founderDraftRef.get();
    if (!founderDraftSnap.exists) {
      throw new ApiError(404, `No founder-draft record for ${draftId}`);
    }
    const founderDraftData = founderDraftSnap.data() ?? {};
    const founderWallet = String(founderDraftData.founderWallet ?? '').toLowerCase();

    // Idempotency — if already bulk-spun, return the previous result
    // without crediting again.
    if (founderDraftData.bulkSpinGrantedAt) {
      logger.info('admin.founder_drafts.grant_spins_noop', {
        actor: actorWallet,
        route: 'admin/founder-drafts/grant-spins',
        context: { draftId, alreadyGrantedAt: String(founderDraftData.bulkSpinGrantedAt) },
      });
      return json({
        ok: true,
        skipped: 'already_granted',
        grantedAt: String(founderDraftData.bulkSpinGrantedAt),
        grantedBy: String(founderDraftData.bulkSpinGrantedBy ?? ''),
        grantedToCount: Number(founderDraftData.bulkSpinGrantedCount ?? 0),
        requestId,
      });
    }

    // Resolve participants live from Go API — same source as the
    // existing /api/promos/founder-draft validator uses.
    const participants = await fetchDraftParticipants(draftId);
    if (participants.length === 0) {
      throw new ApiError(502, 'Could not fetch draft participants from Go API');
    }
    const recipients = participants.filter((p) => p !== founderWallet);

    // Credit each non-founder participant +1 wheel spin atomically.
    // FieldValue.increment is safe to call on a missing field (treats
    // as 0). Each user gets one transaction so the write is small and
    // we can record per-user activity events.
    const results: { wallet: string; ok: boolean; error?: string }[] = [];
    for (const wallet of recipients) {
      try {
        await db.runTransaction(async (tx) => {
          const userRef = db.collection(USERS_COLLECTION).doc(wallet);
          tx.set(userRef, { wheelSpins: FieldValue.increment(1) }, { merge: true });

          // Activity event — shows up in the user's profile feed +
          // admin Live Activity as 'pass_granted' style. We use
          // promo_claimed with metadata.promoType = 'founder-draft'
          // so it joins the existing promo claim stream and Boris
          // can see "X claimed founder-draft" in the dashboard
          // promos box.
          const evt = await buildActivityEventDoc({
            type: 'promo_claimed',
            userId: wallet,
            quantity: 1,
            metadata: {
              promoType: 'founder-draft',
              source: 'admin-bulk-grant',
              draftId,
              spinsAdded: 1,
              grantedBy: actorWallet,
            },
          });
          if (evt) addActivityEventToTx(tx, evt);
        });
        results.push({ wallet, ok: true });
      } catch (err) {
        results.push({
          wallet,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const grantedCount = results.filter((r) => r.ok).length;
    const failedCount = results.length - grantedCount;

    // Mark the founder draft as bulk-spun so we don't double-grant.
    await founderDraftRef.set({
      bulkSpinGrantedAt: FieldValue.serverTimestamp(),
      bulkSpinGrantedBy: actorWallet,
      bulkSpinGrantedCount: grantedCount,
      bulkSpinFailedCount: failedCount,
    }, { merge: true });

    await logAdminAction({
      requestId,
      actor: actorWallet,
      action: 'admin-bulk-grant',
      target: `founder-draft:${draftId}`,
      after: {
        kind: 'founder-draft-spin-grant',
        draftId,
        founderWallet,
        recipients: results.length,
        grantedCount,
        failedCount,
      },
    });

    logger.info('admin.founder_drafts.grant_spins_ok', {
      actor: actorWallet,
      route: 'admin/founder-drafts/grant-spins',
      context: { draftId, grantedCount, failedCount },
    });

    return json({
      ok: failedCount === 0,
      draftId,
      grantedCount,
      failedCount,
      results,
      requestId,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.founder_drafts.grant_spins_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/founder-drafts/grant-spins',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
