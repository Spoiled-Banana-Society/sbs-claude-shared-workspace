export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getUserOfframpTransactions, type OfframpTransaction } from '@/lib/cdpAuth';
import { logger } from '@/lib/logger';

interface TimelineStep {
  key: 'sent' | 'received' | 'converting' | 'paying_out' | 'complete';
  label: string;
  status: 'done' | 'active' | 'pending' | 'failed';
}

function buildTimeline(tx: OfframpTransaction | null): TimelineStep[] {
  const status = tx?.status ?? 'PENDING';
  const txHash = tx?.tx_hash;

  // Map Coinbase tx status to a 5-step user-facing timeline.
  const isFailed = /FAIL|ERROR|EXPIRED/i.test(status);
  const isComplete = status === 'TRANSACTION_STATUS_SUCCESS' || /COMPLETE/i.test(status);
  const hasOnchainHash = Boolean(txHash);

  if (isFailed) {
    return [
      { key: 'sent', label: 'USDC sent from your wallet', status: hasOnchainHash ? 'done' : 'failed' },
      { key: 'received', label: 'Coinbase received', status: 'failed' },
      { key: 'converting', label: 'Converting to USD', status: 'pending' },
      { key: 'paying_out', label: 'Bank deposit', status: 'pending' },
      { key: 'complete', label: 'Money in your bank', status: 'pending' },
    ];
  }

  if (isComplete) {
    return [
      { key: 'sent', label: 'USDC sent from your wallet', status: 'done' },
      { key: 'received', label: 'Coinbase received', status: 'done' },
      { key: 'converting', label: 'Converted to USD', status: 'done' },
      { key: 'paying_out', label: 'Bank deposit initiated', status: 'done' },
      { key: 'complete', label: 'Money in your bank', status: 'done' },
    ];
  }

  // In progress
  return [
    { key: 'sent', label: 'USDC sent from your wallet', status: hasOnchainHash ? 'done' : 'active' },
    { key: 'received', label: 'Coinbase received', status: hasOnchainHash ? 'active' : 'pending' },
    { key: 'converting', label: 'Converting to USD', status: 'pending' },
    { key: 'paying_out', label: 'Bank deposit', status: 'pending' },
    { key: 'complete', label: 'Money in your bank', status: 'pending' },
  ];
}

export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.prizes);
  if (limited) return limited;

  try {
    const session = await getPrivyUser(req);
    const url = new URL(req.url);
    const txId = url.searchParams.get('txId');
    const partnerUserIdParam = url.searchParams.get('partnerUserId');

    const partnerUserId = (partnerUserIdParam || session.userId || '').slice(0, 49);
    if (!partnerUserId) {
      return jsonError('partnerUserId required', 400);
    }

    const result = await getUserOfframpTransactions(partnerUserId, 10);

    let target: OfframpTransaction | null = null;
    if (txId) {
      target = result.transactions.find((t) => t.id === txId) ?? null;
    } else if (result.transactions.length > 0) {
      target = result.transactions[0];
    }

    return json({
      transaction: target,
      transactions: result.transactions,
      timeline: buildTimeline(target),
      hasHistory: result.transactions.length > 0,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('coinbase.tx-status.unhandled', { route: '/api/coinbase/tx-status', err });
    return jsonError('Failed to fetch transaction status', 500);
  }
}
