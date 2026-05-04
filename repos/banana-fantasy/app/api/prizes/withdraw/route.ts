import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireNumber, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { createWithdrawal } from '@/lib/db';
import { getPersonaVerification, incrementCumulativeWithdrawals } from '@/lib/db-firestore';
import type { PrizeWithdrawal, WithdrawalStatus } from '@/types';

const KYC_THRESHOLD = 2000; // Cumulative withdrawal threshold for full KYC

const API_BASE = process.env.NEXT_PUBLIC_SBS_API_URL || '';

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch {
    // ignore JSON parsing errors
  }
  try {
    const text = await res.text();
    return text ? text : null;
  } catch {
    return null;
  }
}

function normalizeWithdrawalStatus(value: unknown): WithdrawalStatus {
  if (value === 'pending' || value === 'processing' || value === 'completed' || value === 'failed') return value;
  return 'processing';
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;
  try {
    // Verify user is authenticated (Privy DID !== wallet address, so we just verify the JWT is valid)
    await getPrivyUser(req);
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const draftId = requireString(body.draftId, 'draftId');
    const amount = requireNumber(body.amount, 'amount');
    const methodRaw = body.method;

    if (!userId.trim()) {
      return jsonError('User id is required', 400);
    }
    if (amount <= 0) {
      return jsonError('Amount must be greater than 0', 400);
    }
    // TODO: Validate `amount` against the user's actual prize records before creating a withdrawal.
    if (methodRaw !== 'usdc' && methodRaw !== 'bank') {
      return jsonError('Invalid withdrawal method', 400);
    }
    const method: PrizeWithdrawal['method'] = methodRaw;

    // Check Persona verification status before processing
    const verification = await getPersonaVerification(userId);

    // Tier 1: First withdrawal — must have age + geo verification
    if (!verification.tier1.verified) {
      return json({ requiresVerification: 'basic', message: 'Age and location verification required before withdrawal' }, 403);
    }

    // Tier 2: Cumulative withdrawals >= $2k — must have full KYC
    const projectedTotal = (verification.cumulativeWithdrawals || 0) + amount;
    if (projectedTotal >= KYC_THRESHOLD && !verification.tier2.verified) {
      return json({ requiresVerification: 'kyc', message: 'Full identity verification required for withdrawals over $2,000', cumulativeTotal: verification.cumulativeWithdrawals }, 403);
    }

    let backendStatus: WithdrawalStatus | undefined;
    if (API_BASE) {
      const res = await fetch(`${API_BASE}/owner/${userId}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, draftId, amount, method }),
      });

      if (!res.ok) {
        const message = await readErrorMessage(res);
        console.error(`Withdraw API error: ${res.status}`, message);
        return jsonError(message || 'Withdraw service error', res.status);
      }

      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        // Backend may return no body; ignore.
      }

      backendStatus = normalizeWithdrawalStatus((payload as Record<string, unknown> | null)?.status);
    }

    const withdrawal = await createWithdrawal(userId, draftId, amount, method, backendStatus ?? 'pending');

    // Track cumulative withdrawals for KYC threshold
    await incrementCumulativeWithdrawals(userId, amount);

    return json({ status: withdrawal.status, withdrawal }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Withdrawal request failed:', err);
    return jsonError('Failed to process withdrawal', 500);
  }
}
