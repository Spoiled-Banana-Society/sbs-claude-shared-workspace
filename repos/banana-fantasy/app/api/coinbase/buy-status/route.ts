// Look up the most recent Coinbase Onramp (buy) transaction for the
// signed-in user and classify it into something the modal can render.
// Used by BuyPassesModal when the popup closes without USDC arriving —
// lets us tell the user "you hit the $500 limit" or "your card was
// declined" with confidence instead of showing a vague error.
//
// Returns one of:
//   { kind: 'none' }                — no recent attempt found (e.g. user
//                                      cancelled before submitting payment)
//   { kind: 'pending' }             — tx exists but still processing
//   { kind: 'success', txId }       — tx settled, USDC should be arriving
//   { kind: 'failed', reason, code } — tx failed; reason is a friendly
//                                      string ready to render

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getUserOnrampTransactions, type OnrampTransaction } from '@/lib/cdpAuth';

type ClassifiedReason =
  | { kind: 'none' }
  | { kind: 'pending'; txId: string }
  | { kind: 'success'; txId: string }
  | {
      kind: 'failed';
      reason: string;
      code: string;
      txId: string;
      // ISO timestamp when the user can buy via Coinbase again. Only
      // populated for LIMIT_EXCEEDED — Coinbase's weekly cap rolls 7
      // days from the earliest transaction in the active window.
      nextAvailableAt?: string;
    };

// Map Coinbase's status_reason enum to user-facing copy. Anything not
// listed here falls back to a generic message so we never expose raw
// enum strings. Names sourced from Coinbase Onramp docs + observed
// values in production tx logs.
function classifyFailureReason(statusReason: string | undefined): { friendly: string; code: string } {
  const code = (statusReason || '').toUpperCase();
  switch (code) {
    case 'LIMIT_EXCEEDED':
    case 'BUY_LIMIT_EXCEEDED':
    case 'WEEKLY_LIMIT_EXCEEDED':
      return {
        // Frontend appends the reset date when nextAvailableAt is
        // populated; this base message stands alone if we can't compute
        // a reset date for any reason.
        friendly: "You've hit Coinbase's $500 weekly purchase limit. Coinbase's cap is $500 per user, per 7 days. Switch to MoonPay to continue.",
        code: 'LIMIT_EXCEEDED',
      };
    case 'PAYMENT_DECLINED':
    case 'CARD_DECLINED':
      return {
        friendly: 'Your card was declined by Coinbase. Try another card, or use MoonPay.',
        code: 'PAYMENT_DECLINED',
      };
    case 'CANCELED':
    case 'CANCELLED':
    case 'USER_CANCELED':
      return {
        friendly: 'You cancelled the Coinbase purchase. You can try again or switch to MoonPay.',
        code: 'CANCELED',
      };
    case 'KYC_REQUIRED':
    case 'IDENTITY_VERIFICATION_REQUIRED':
      return {
        friendly: 'Coinbase needs additional verification before completing this purchase. Try MoonPay if you want to skip the extra step.',
        code: 'KYC_REQUIRED',
      };
    case 'GEO_RESTRICTED':
    case 'REGION_NOT_SUPPORTED':
      return {
        friendly: "Coinbase isn't available in your region for this purchase. Try MoonPay instead.",
        code: 'GEO_RESTRICTED',
      };
    default:
      return {
        friendly: "Coinbase didn't go through. You can try again or switch to MoonPay.",
        code: code || 'UNKNOWN',
      };
  }
}

function classifyTransaction(
  tx: OnrampTransaction,
  allTransactions: OnrampTransaction[],
): ClassifiedReason {
  const status = (tx.status || '').toUpperCase();
  if (status.includes('SUCCESS') || status.includes('COMPLETE')) {
    return { kind: 'success', txId: tx.id };
  }
  if (status.includes('FAIL') || status.includes('CANCEL') || status.includes('DECLIN')) {
    const { friendly, code } = classifyFailureReason(tx.status_reason);
    let nextAvailableAt: string | undefined;
    if (code === 'LIMIT_EXCEEDED') {
      // Coinbase's weekly buy limit rolls 7 days from the earliest
      // SUCCESSFUL transaction in the user's active 7-day window. We
      // approximate by finding the oldest non-failed tx in the last
      // 7 days and adding 7 days to its timestamp. If we can't find
      // one (e.g. all failures in our sample), fall back to "now + 7d".
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const eligible = allTransactions.filter((t) => {
        const ts = Date.parse(t.created_at);
        if (!Number.isFinite(ts) || ts < sevenDaysAgo) return false;
        const s = (t.status || '').toUpperCase();
        return !s.includes('FAIL') && !s.includes('CANCEL') && !s.includes('DECLIN');
      });
      const oldest = eligible.sort((a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at),
      )[0];
      const baseMs = oldest
        ? Date.parse(oldest.created_at)
        : Date.now();
      nextAvailableAt = new Date(baseMs + 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    return {
      kind: 'failed',
      reason: friendly,
      code,
      txId: tx.id,
      ...(nextAvailableAt ? { nextAvailableAt } : {}),
    };
  }
  // Pending / in-progress
  return { kind: 'pending', txId: tx.id };
}

export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.prizes);
  if (limited) return limited;

  try {
    const session = await getPrivyUser(req);
    const partnerUserIdParam = getSearchParam(req, 'partnerUserId');
    const partnerUserId = (partnerUserIdParam || session.userId || '').slice(0, 49);
    if (!partnerUserId) {
      return jsonError('partnerUserId required', 400);
    }

    const result = await getUserOnrampTransactions(partnerUserId, 5);
    if (result.transactions.length === 0) {
      // User cancelled before any tx was created.
      return json({ kind: 'none' } satisfies ClassifiedReason);
    }

    // Most recent first per Coinbase response order.
    const latest = result.transactions[0];
    return json(classifyTransaction(latest, result.transactions));
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('CDP buy-status error:', err);
    // Don't fail the modal hard — return a neutral "none" so the user
    // sees the generic friendly fallback instead of a crash.
    return json({ kind: 'none' } satisfies ClassifiedReason);
  }
}
