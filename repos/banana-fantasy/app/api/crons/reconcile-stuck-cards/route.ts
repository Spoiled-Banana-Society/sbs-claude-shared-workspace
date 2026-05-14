import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily Vercel cron that scans recently-closed drafts for cards that didn't
 * get fully closed — either the rendered team image was never written
 * (still pointing at the default placeholder) or the roster field is empty.
 * For each stuck card, calls the Go API admin recover endpoint to re-run
 * the close-draft per-card flow.
 *
 * Why this exists: on 2026-05-13 a user's card was lost because the close-
 * draft goroutine had silent error handling — one transient image-generator
 * 500 → the goroutine bailed silently → card stayed on default image, roster
 * never made it to Firestore, and we only found it by visual inspection a
 * day later. The Go API now has structured logging on every close-draft
 * error path AND persists roster BEFORE rendering, so the failure mode is
 * narrower — but anything is recoverable. This cron is the safety net.
 *
 * Schedule: hourly. Looks back 7 days of completed drafts (any draft with
 * realTimeDraftInfo.isDraftClosed = true that completed in that window).
 * Per-card check is O(10) reads per draft, so even 100 drafts/week is well
 * under Vercel's function budget.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */

interface DraftCard {
  CardId?: string;
  cardId?: string;
  OwnerId?: string;
  ownerId?: string;
  ImageUrl?: string;
  _imageUrl?: string;
  Roster?: unknown;
  roster?: unknown;
}

const DRAFTS_API_URL =
  process.env.STAGING_DRAFTS_API_URL ||
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

const LOOKBACK_DAYS = 7;
const MAX_DRAFTS_PER_RUN = 100;

function isDefaultOrMissingImage(card: DraftCard): boolean {
  const url = card.ImageUrl || card._imageUrl || '';
  if (!url) return true;
  // The image generator's success URL always contains a `{cardId}-{uuid}` suffix;
  // the default placeholder is `draft-token-image-default_350x490.png`.
  return url.includes('draft-token-image-default') || url.includes('default_350x490');
}

function isMissingRoster(card: DraftCard): boolean {
  const roster = card.Roster || card.roster;
  if (!roster || typeof roster !== 'object') return true;
  const r = roster as Record<string, unknown>;
  const lens = ['QB', 'RB', 'WR', 'TE', 'DST'].map((p) => {
    const arr = r[p] ?? r[p.toLowerCase()];
    return Array.isArray(arr) ? arr.length : 0;
  });
  const total = lens.reduce((a, b) => a + b, 0);
  return total < 15;
}

async function recoverCard(draftId: string, walletAddress: string, adminKey: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `${DRAFTS_API_URL.replace(/\/$/, '')}/draft-actions/${encodeURIComponent(
    draftId,
  )}/owner/${encodeURIComponent(walletAddress)}/admin/recover-card`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: '{}',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text.slice(0, 300) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'fetch threw' };
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return jsonError('unauthorized', 401);
  }
  if (!isFirestoreConfigured()) {
    return jsonError('firestore not configured', 500);
  }
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    logger.error('reconcile_stuck_cards.no_admin_key', {});
    return jsonError('ADMIN_API_KEY missing', 500);
  }

  const db = getAdminFirestore();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Find recently-completed drafts. The League doc doesn't store a
  // completion timestamp directly, so use the draft tracker counts as a
  // hint for where to look, then check each draft's realTimeDraftInfo
  // (RTDB) for the closed flag. RTDB is hot, this is fast.
  let trackerSnap;
  try {
    trackerSnap = await db.doc('drafts/draftTracker').get();
  } catch (err) {
    logger.error('reconcile_stuck_cards.tracker_read_failed', { err });
    return jsonError('tracker read failed', 500);
  }
  const tracker = trackerSnap.data() as { CurrentLiveDraftCount?: number; CurrentSlowDraftCount?: number } | undefined;
  const maxFast = tracker?.CurrentLiveDraftCount ?? 0;
  const maxSlow = tracker?.CurrentSlowDraftCount ?? 0;

  // Walk backwards from current count. Stop early once we've checked
  // MAX_DRAFTS_PER_RUN or hit drafts older than the lookback window.
  const candidates: string[] = [];
  for (let i = 0; i < MAX_DRAFTS_PER_RUN && (i < maxFast || i < maxSlow); i++) {
    if (i < maxFast) candidates.push(`2024-fast-draft-${maxFast - i}`);
    if (i < maxSlow) candidates.push(`2024-slow-draft-${maxSlow - i}`);
  }

  let draftsScanned = 0;
  let stuckCardsFound = 0;
  let recovered = 0;
  let recoverFailed = 0;
  const failureDetails: Array<{ draftId: string; wallet: string; error: string }> = [];

  for (const draftId of candidates) {
    // Quick check: was this draft closed? Use Firestore drafts/{id} doc
    // existence + the realTimeDraftInfo in RTDB. If the draft doc doesn't
    // exist, skip silently (it's normal for very old draft slots to be empty
    // when the tracker has been reset).
    const leagueSnap = await db.doc(`drafts/${draftId}`).get();
    if (!leagueSnap.exists) continue;

    // Only check drafts where realTimeDraftInfo says draft is closed —
    // otherwise picks may still be happening and the card image isn't
    // expected to be generated yet.
    const rtdbSnap = await db.doc(`drafts/${draftId}`).get(); // placeholder, we read RTDB below
    void rtdbSnap;

    // Read the RTDB realTimeDraftInfo via the admin database
    // ⚠ Don't import getAdminDatabase at top to avoid initializing RTDB on
    // every Next.js cold start — lazily import it here.
    const { getAdminDatabase } = await import('@/lib/firebaseAdmin');
    const rtdb = getAdminDatabase();
    const rtSnap = await rtdb.ref(`drafts/${draftId}/realTimeDraftInfo`).once('value');
    const rt = rtSnap.val() as { isDraftClosed?: boolean; pickEndTime?: number } | null;
    if (!rt || !rt.isDraftClosed) continue;
    if (rt.pickEndTime && rt.pickEndTime < since.getTime() / 1000) continue;

    draftsScanned++;
    const cardsSnap = await db.collection(`drafts/${draftId}/cards`).get();
    for (const cardDoc of cardsSnap.docs) {
      const card = cardDoc.data() as DraftCard;
      const wallet = (card.OwnerId || card.ownerId || '').toLowerCase();
      if (!wallet) continue;
      if (!isDefaultOrMissingImage(card) && !isMissingRoster(card)) continue;

      stuckCardsFound++;
      logger.warn('reconcile_stuck_cards.found_stuck', {
        draftId,
        wallet,
        cardId: cardDoc.id,
        defaultImage: isDefaultOrMissingImage(card),
        missingRoster: isMissingRoster(card),
      });

      const result = await recoverCard(draftId, wallet, adminKey);
      if (result.ok) {
        recovered++;
        logger.info('reconcile_stuck_cards.recovered', { draftId, wallet, cardId: cardDoc.id });
      } else {
        recoverFailed++;
        failureDetails.push({ draftId, wallet, error: result.error || `HTTP ${result.status}` });
        logger.error('reconcile_stuck_cards.recover_failed', {
          draftId,
          wallet,
          cardId: cardDoc.id,
          status: result.status,
          error: result.error,
        });
      }
    }
  }

  logger.info('reconcile_stuck_cards.run_complete', {
    draftsScanned,
    stuckCardsFound,
    recovered,
    recoverFailed,
  });

  return Response.json({
    ok: true,
    draftsScanned,
    stuckCardsFound,
    recovered,
    recoverFailed,
    failureDetails: failureDetails.slice(0, 20),
  });
}
