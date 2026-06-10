export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { runInBackground } from '@/lib/serverBackground';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getUserOfframpTransactions, type OfframpTransaction } from '@/lib/cdpAuth';
import { updateOfframpFromTx } from '@/lib/offrampAudit';

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

    // Sync the audit log with the latest tx state. Best-effort — never block
    // the response on this. Updates the user's most recent open offramp
    // attempt with whatever Coinbase says about the tx now.
    if (target) {
      const auditUserKey = (session.walletAddress ?? session.userId).toLowerCase();
      // Pull the settled values straight off Coinbase's tx object.
      // total.value is USD net to the user (post-fee), sell_amount.value is
      // USDC actually sold. parseFloat tolerates the string-typed values
      // Coinbase returns. We forward only finite numbers so a missing or
      // malformed field doesn't pollute the audit doc.
      const numOrUndef = (s?: string): number | undefined => {
        if (!s) return undefined;
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : undefined;
      };
      runInBackground('offramp.tx-audit', updateOfframpFromTx({
        userId: auditUserKey,
        coinbaseTxId: target.id,
        coinbaseTxStatus: target.status,
        coinbaseSellUsdc: numOrUndef(target.sell_amount?.value),
        coinbaseTotalUsd: numOrUndef(target.total?.value),
        coinbaseFeeUsd: numOrUndef(target.coinbase_fee?.value),
        coinbaseExchangeRate: numOrUndef(target.exchange_rate?.value),
      }));
    }

    return json({
      transaction: target,
      transactions: result.transactions,
      timeline: buildTimeline(target),
      hasHistory: result.transactions.length > 0,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('CDP tx-status error:', err);
    return jsonError('Failed to fetch transaction status', 500);
  }
}
