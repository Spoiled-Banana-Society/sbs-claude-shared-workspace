import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getPromos } from '@/lib/db';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const userId = getSearchParam(req, 'userId');
    if (!userId) {
      // Return default promo templates for logged-out users (view only, no claims)
      const { getDefaultPromos } = await import('@/lib/api/seed');
      return json(getDefaultPromos(), 200);
    }

    const promos = await getPromos(userId);

    // Stamp live lifetime stats onto the daily-drafts promo for the modal
    // ("paid drafts all-time"). Authoritative Go count (same source as
    // ripeness/King); best-effort — a Go hiccup must never break promos.
    try {
      const daily = promos.find((p) => p.type === 'daily-drafts');
      if (daily && /^0x[0-9a-fA-F]{40}$/.test(userId)) {
        const { fetchOwnerPaidFilledCount } = await import('@/lib/api/owner');
        daily.modalContent.lifetimePaidDrafts = await fetchOwnerPaidFilledCount(userId.toLowerCase());
      }
    } catch { /* stats are decoration — promos still return */ }

    // One-time backfill: users who bought passes BEFORE per-purchase history
    // existed (2026-06-10) get their Buy-10 Purchase History reconstructed
    // from the real completed purchase records, then persisted so this never
    // runs again for them.
    try {
      const mint = promos.find((p) => p.type === 'mint');
      if (mint && (mint.modalContent.totalMinted ?? 0) > 0 && !(mint.modalContent.mintHistory?.length)) {
        const { getPurchaseHistory } = await import('@/lib/db');
        const completed = (await getPurchaseHistory(userId))
          .filter((x) => x.status === 'completed' && x.quantity > 0)
          .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1))
          .slice(0, 50);
        if (completed.length > 0) {
          mint.modalContent.mintHistory = completed.map((x) => ({
            date: x.createdAt.slice(0, 10),
            quantity: x.quantity,
            status: 'claimed' as const,
          }));
          const { getAdminFirestore } = await import('@/lib/firebaseAdmin');
          await getAdminFirestore()
            .collection('v2_users').doc(userId)
            .collection('promos').doc(mint.id)
            .set({ modalContent: { mintHistory: mint.modalContent.mintHistory } }, { merge: true });
        }
      }
    } catch { /* backfill is best-effort */ }

    // Backstop: new accounts seeded before the welcome noti existed (or whose
    // seed-time write was lost) get it here — dedupe-keyed, so for everyone
    // else this is a guaranteed no-op. Some user docs are created by stub
    // writes that bypass the full seed and carry NO createdAt (caught live on
    // 0x9a74…e17b) — stamp those now, and treat zero-activity unstamped docs
    // as new. Accounts with any passes/spins/balance can never qualify.
    try {
      const { getAdminFirestore } = await import('@/lib/firebaseAdmin');
      const userRef = getAdminFirestore().collection('v2_users').doc(userId);
      const userSnap = await userRef.get();
      const u = (userSnap.data() ?? {}) as { createdAt?: string; createdAtEstimated?: boolean; draftPasses?: number; freeDrafts?: number; wheelSpins?: number; usdcBalance?: number };
      if (userSnap.exists && !u.createdAt) {
        // Backfill stamp is marked ESTIMATED — a legacy account stamped
        // "today" must never read as a 7-day-new account on its next visit
        // (that loophole gave Boris's admin wallet a welcome noti).
        await userRef.set({ createdAt: new Date().toISOString(), createdAtEstimated: true }, { merge: true }).catch(() => {});
      }
      const zeroActivity = !(u.draftPasses ?? 0) && !(u.freeDrafts ?? 0) && !(u.wheelSpins ?? 0) && !(u.usdcBalance ?? 0);
      // New = real (non-estimated) createdAt within 7 days. Accounts with
      // only an estimated stamp (or none) must ALSO be zero-activity.
      const isNew = u.createdAt && !u.createdAtEstimated
        ? Date.now() - new Date(u.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
        : userSnap.exists && zeroActivity;
      // Played a previous season (BBB1-3)? Not a "new user" — no welcome
      // noti, whatever the account age (Boris's definition 2026-06-10).
      const { isReturningWalletSync } = await import('@/lib/returningUsers');
      if (isNew && !isReturningWalletSync(userId)) {
        const { createNotification } = await import('@/lib/queueNotifications');
        await createNotification(userId, {
          type: 'welcome',
          title: 'Welcome! Free Spin Waiting',
          message: 'Verify your X account to earn a Free Banana Spin — win up to 20 free drafts, at least 1 guaranteed. Tap to claim.',
          link: '/promos?promo=6',
          dedupeKey: 'welcome-new-user',
          icon: '🎉',
        });
      }
    } catch { /* best-effort */ }

    return json(promos, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
