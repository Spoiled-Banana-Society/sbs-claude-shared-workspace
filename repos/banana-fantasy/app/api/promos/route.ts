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

    return json(promos, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
