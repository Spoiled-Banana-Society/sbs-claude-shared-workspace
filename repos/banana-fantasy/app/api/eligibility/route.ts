import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireWalletAuth } from '@/lib/walletAuth';
import { getPersonaVerification } from '@/lib/db-firestore';
import type { EligibilityStatus } from '@/types';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    // Server-derived wallet — KYC status leaks personal data, never let
    // ?userId= dictate which user we read.
    const { walletAddress: userId } = await requireWalletAuth(req);

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
