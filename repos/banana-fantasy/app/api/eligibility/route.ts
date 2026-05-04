import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getPersonaVerification } from '@/lib/db-firestore';
import type { EligibilityStatus } from '@/types';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const userId = getSearchParam(req, 'userId');
    if (!userId) return jsonError('Missing query param: userId', 400);

    const verification = await getPersonaVerification(userId);

    const eligibility: EligibilityStatus = {
      isVerified: verification.tier1.verified,
      season: 2025,
      w9Completed: false,
      lastVerifiedDate: verification.tier1.verifiedAt,
      tier1Verified: verification.tier1.verified,
      tier2Verified: verification.tier2.verified,
      cumulativeWithdrawals: verification.cumulativeWithdrawals,
      geoState: verification.tier1.geoState,
      personaInquiryId: verification.tier1.inquiryId,
    };

    return json(eligibility, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Eligibility fetch failed:', err);
    return jsonError('Failed to fetch eligibility', 500);
  }
}
