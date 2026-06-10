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

    return json(promos, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
