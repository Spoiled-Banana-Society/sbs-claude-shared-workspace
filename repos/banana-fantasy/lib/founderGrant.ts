/**
 * Founder Draft reward — the SINGLE source of truth for granting the founder
 * spin. Direct +1 wheel spin + real-time bell to every PAID, NON-founder
 * participant once the founder draft has filled. Not a claimable promo — it's
 * sent straight to their wheel (Boris 2026-06-16: "it's different, no promo box").
 *
 * Called automatically from /api/founder-drafts/check (fires as participants
 * sit in the room post-fill) and available as a manual admin fallback.
 *
 * Race-safe: many participants' browsers hit /check at once, so we ATOMICALLY
 * claim the grant (set bulkSpinGrantedAt in a txn) before crediting — only one
 * caller proceeds, the rest no-op. Prevents double-spins. The founder wallet is
 * excluded (they host the draft; the badge — handled in /check — still applies
 * to everyone, but the spin does not).
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { resolveDraftPassType, unlockBadge, isFounderDraftMarked } from '@/lib/db';
import { isFounderDraft, EMPTY_SCHEDULE, type FounderSchedule } from '@/lib/founderDraft';
import { createNotification } from '@/lib/queueNotifications';
import { promoWeekendActive } from '@/lib/promoWindow';
import { buildActivityEventDoc, addActivityEventToTx } from '@/lib/activityEvents';
import { runInBackground } from '@/lib/serverBackground';
import { logger } from '@/lib/logger';

const FOUNDER_DRAFTS_COLLECTION = 'founderDrafts';
const USERS_COLLECTION = 'v2_users';
const FULL_DRAFT_SEATS = 10; // a draft is "full" at 10 seats
const STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

function goApiBase(): string {
  return (process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
    || process.env.STAGING_DRAFTS_API_URL
    || process.env.NEXT_PUBLIC_SBS_API_URL
    || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

async function fetchParticipants(draftId: string): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${goApiBase()}/draft/${encodeURIComponent(draftId)}/state/info`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { draftOrder?: { ownerId?: string }[] };
    return (data.draftOrder ?? []).map((o) => (o.ownerId ?? '').toLowerCase()).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

interface FounderDraftInfo {
  draftStartTime: number;
  draftOrder: { ownerId: string }[];
}

/** Full draft info (start time + order) — `isFounderDraft` needs the start time,
 *  which `fetchParticipants` drops. Returns null on any error/timeout. */
async function fetchFounderDraftInfo(draftId: string): Promise<FounderDraftInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${goApiBase()}/draft/${encodeURIComponent(draftId)}/state/info`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { draftStartTime?: number; draftOrder?: { ownerId?: string }[] };
    return {
      draftStartTime: Number(data.draftStartTime ?? 0),
      draftOrder: (data.draftOrder ?? []).map((o) => ({ ownerId: (o?.ownerId ?? '') })),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read the founder schedule singleton. Returns EMPTY_SCHEDULE (inactive) on any error. */
async function fetchFounderSchedule(): Promise<FounderSchedule> {
  if (!isFirestoreConfigured()) return EMPTY_SCHEDULE;
  try {
    const db = getAdminFirestore();
    const snap = await db.collection('founderSchedule').doc('next').get();
    if (!snap.exists) return EMPTY_SCHEDULE;
    const d = snap.data() as Partial<FounderSchedule> | undefined;
    return {
      at: typeof d?.at === 'string' ? d.at : '',
      dayLabel: typeof d?.dayLabel === 'string' ? d.dayLabel : '',
      founderWallet: typeof d?.founderWallet === 'string' ? d.founderWallet.toLowerCase() : '',
      windowMinutes: Number.isFinite(d?.windowMinutes) ? Number(d!.windowMinutes) : 10,
      active: d?.active === true,
    };
  } catch {
    return EMPTY_SCHEDULE;
  }
}

/**
 * True when `draftId` is a Founder Draft, checked LIVE (not only the persisted
 * marker). Needed to gate the Pick-10 spin on the client credit path: the
 * client fires Pick-10 at fill and RACES the founder marking — and usually wins,
 * because the founder POST waits on a Privy access token first. So at that
 * instant the founderDrafts doc may not exist yet; we evaluate the schedule +
 * draftOrder directly to catch it.
 *
 * Fast-path the persisted marker (founder drafts stay marked forever). On any
 * error this FAILS OPEN (returns false) so a normal draft never loses its
 * legitimate Pick-10 spin because the Go API or Firestore hiccuped.
 */
export async function isFounderDraftLive(draftId: string): Promise<boolean> {
  if (!draftId) return false;
  try {
    if (await isFounderDraftMarked(draftId)) return true;
  } catch { /* fall through to live eligibility */ }
  try {
    const [info, schedule] = await Promise.all([
      fetchFounderDraftInfo(draftId),
      fetchFounderSchedule(),
    ]);
    if (!info || !schedule.active) return false;
    return isFounderDraft(info.draftStartTime, info.draftOrder, schedule);
  } catch {
    return false;
  }
}

export interface FounderGrantResult {
  ok: boolean;
  skipped?: string;
  granted?: number;
  skippedFree?: number;
  failed?: number;
}

export async function grantFounderDraftSpins(
  draftId: string,
  actorLabel = 'auto-fill',
): Promise<FounderGrantResult> {
  if (!isFirestoreConfigured() || !draftId) return { ok: false, skipped: 'no-firestore' };
  const db = getAdminFirestore();
  const ref = db.collection(FOUNDER_DRAFTS_COLLECTION).doc(draftId);

  // Must be a FILLED draft (all 10 seats) — participants come from the Go API
  // draftOrder. Gating on a full draft prevents the partial-fill race where an
  // early grant claims the lock against a half-empty room and permanently locks
  // out players who join seconds later.
  const participants = await fetchParticipants(draftId);
  if (participants.length === 0) return { ok: false, skipped: 'no-participants' };
  if (participants.length < FULL_DRAFT_SEATS) return { ok: false, skipped: 'not-full' };

  // Atomically CLAIM the grant so concurrent callers can't double-spin.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { claimed: false as const, reason: 'no-founder-doc' };
    const d = snap.data() ?? {};
    if (d.bulkSpinGrantedAt) return { claimed: false as const, reason: 'already-granted' };
    tx.set(ref, { bulkSpinGrantedAt: FieldValue.serverTimestamp(), bulkSpinGrantedBy: actorLabel }, { merge: true });
    return { claimed: true as const, founderWallet: String(d.founderWallet ?? '').toLowerCase() };
  });
  if (!claim.claimed) return { ok: true, skipped: claim.reason };

  const founderWallet = claim.founderWallet;
  // PAID, non-founder, non-bot participants only.
  const recipients = participants.filter(
    (p) => p && p !== founderWallet && !p.startsWith('bot-'),
  );

  let granted = 0;
  let skippedFree = 0;
  let failed = 0;
  for (const wallet of recipients) {
    try {
      const passType = await resolveDraftPassType(wallet, draftId).catch(() => null);
      // Weekend promo window: free passes earn the founder spin too (auto-reverts Sun midnight PT).
      if (passType !== 'paid' && !(passType === 'free' && promoWeekendActive())) { skippedFree += 1; continue; }
      await db.runTransaction(async (tx) => {
        tx.set(db.collection(USERS_COLLECTION).doc(wallet), { wheelSpins: FieldValue.increment(1) }, { merge: true });
        const evt = await buildActivityEventDoc({
          type: 'promo_claimed',
          userId: wallet,
          quantity: 1,
          metadata: { promoType: 'founder-draft', source: actorLabel, draftId, spinsAdded: 1 },
        });
        if (evt) addActivityEventToTx(tx, evt);
      });
      // Real-time bell, bell-only (no toast), dedupe-keyed so it can't double.
      await createNotification(wallet, {
        type: 'promo',
        title: 'Founder Draft — Free Spin!',
        message: 'You drafted with the founders — a Free Banana Spin was added to your wheel. Tap to spin.',
        link: '/banana-wheel',
        dedupeKey: `founder-spin-${draftId}`,
        icon: 'spin',
      });
      granted += 1;
    } catch (err) {
      failed += 1;
      logger.warn('founder.grant.user_failed', { draftId, wallet, err: err instanceof Error ? err.message : String(err) });
    }
  }

  await ref.set(
    { bulkSpinGrantedCount: granted, bulkSpinSkippedFreeCount: skippedFree, bulkSpinFailedCount: failed },
    { merge: true },
  );
  logger.info('founder.grant.done', { draftId, granted, skippedFree, failed, actorLabel });
  return { ok: failed === 0, granted, skippedFree, failed };
}

/**
 * Credit a Founder Draft once it has FILLED (all 10 seats):
 *  - Founders League badge to every human (any pass type, incl. the founder).
 *  - +1 wheel spin to every PAID, non-founder participant (via grantFounderDraftSpins).
 * Idempotent + race-safe (the spin grant atomically claims the lock; the badge
 * unlock is idempotent). The SINGLE credit path — used by both the on-fill POST
 * and the read-side check as a safety net. No claimable promo (no double-spin).
 */
export async function creditFounderDraft(
  draftId: string,
  draftOrder: { ownerId?: string }[],
  actorLabel = 'auto-fill',
): Promise<{ credited: boolean; reason?: string }> {
  if (!isFirestoreConfigured() || !draftId) return { credited: false, reason: 'no-firestore' };
  const db = getAdminFirestore();
  const ref = db.collection(FOUNDER_DRAFTS_COLLECTION).doc(draftId);
  const snap = await ref.get();
  if (!snap.exists) return { credited: false, reason: 'not-marked' };

  // Wait for the draft to FILL before crediting anyone (badge or spin).
  if ((draftOrder?.length ?? 0) < FULL_DRAFT_SEATS) return { credited: false, reason: 'not-full' };

  const humans = draftOrder
    .map((o) => (o?.ownerId || '').toLowerCase())
    .filter((o) => o && !o.startsWith('bot-'));
  for (const wallet of humans) {
    // PARTICIPATION badge (Boris 2026-07-01): EVERY human in a Founder Draft
    // earns the Founders League badge — free AND paid passes alike, same as the
    // JP/HOF club badges. Only the SPIN reward stays paid-only (that gate lives
    // in grantFounderDraftSpins below, unchanged). The badge is cosmetic and
    // just celebrates that you played, so it shouldn't be pay-walled.
    runInBackground('founders-badge', unlockBadge(wallet, 'founders-league', { draftId }));
  }
  runInBackground('founder-spins', grantFounderDraftSpins(draftId, actorLabel));
  await ref.set({ creditedAt: new Date().toISOString() }, { merge: true });
  return { credited: true };
}
