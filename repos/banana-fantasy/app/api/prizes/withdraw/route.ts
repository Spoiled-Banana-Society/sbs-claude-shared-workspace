import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireNumber, requireString } from '@/lib/api/routeUtils';
import { requireWalletAuth } from '@/lib/walletAuth';
import { createWithdrawal } from '@/lib/db';
import { logger } from '@/lib/logger';
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
    // Server-derived wallet — never trust body.userId. The withdrawal is
    // always credited to the authenticated caller's wallet.
    const { walletAddress: userId } = await requireWalletAuth(req);
    const body = await parseBody(req);
    const draftId = requireString(body.draftId, 'draftId');
    const amount = requireNumber(body.amount, 'amount');
    const methodRaw = body.method;

    if (amount <= 0) {
      return jsonError('Amount must be greater than 0', 400);
    }
    // Temporary safety cap until full prize-ledger validation lands.
    // Without this an authenticated + KYC'd wallet could submit any amount
    // and the Firestore withdrawal record would be created. Real fix is
    // to read the user's prize history and only allow `amount <= unwithdrawn`.
    // Until then, hard-cap a single withdrawal at $5k and let the human
    // ops review queue catch anything exotic.
    const MAX_WITHDRAWAL_AMOUNT = 5000;
    if (amount > MAX_WITHDRAWAL_AMOUNT) {
      return jsonError(`Single withdrawals are capped at $${MAX_WITHDRAWAL_AMOUNT} until further validation lands.`, 400);
    }
    if (methodRaw !== 'usdc' && methodRaw !== 'bank') {
      return jsonError('Invalid withdrawal method', 400);
    }
    const method: PrizeWithdrawal['method'] = methodRaw;

    // Check KYC verification status before processing (Didit; legacy
    // Persona naming in helper functions due to vendor swap).
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
    if (!API_BASE) {
      // Fail loud rather than silently telling the user "withdrawal queued"
      // while no Go-API transfer ever fires. Previously a missing env var
      // would still write the Firestore withdrawal record + return success,
      // which is a real prod-config landmine.
      logger.error('prizes.withdraw.api_base_missing', { route: '/api/prizes/withdraw' });
      return jsonError('Withdrawal service not configured', 503);
    }
    {
      const res = await fetch(`${API_BASE}/owner/${userId}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, draftId, amount, method }),
      });

      if (!res.ok) {
        const message = await readErrorMessage(res);
        logger.error('prizes.withdraw.backend_error', { route: '/api/prizes/withdraw', status: res.status, message });
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
    logger.error('prizes.withdraw.unhandled', { route: '/api/prizes/withdraw', err });
    return jsonError('Failed to process withdrawal', 500);
  }
}
