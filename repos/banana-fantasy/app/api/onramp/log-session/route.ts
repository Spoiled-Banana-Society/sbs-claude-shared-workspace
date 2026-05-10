// Client-initiated beacon for onramp sessions — used by BuyPassesModal
// to log MoonPay session_created entries since we don't own the popup
// (Privy does). For Coinbase the buy-session endpoint already logs
// server-side; this is the equivalent path for MoonPay.

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString, requireNumber } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { logOnrampSessionCreated, type OnrampProvider } from '@/lib/onrampAudit';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.prizes);
  if (limited) return limited;

  try {
    const session = await getPrivyUser(req);
    const body = await parseBody(req);

    const walletAddress = requireString(body.walletAddress, 'walletAddress').toLowerCase();
    if (!ETH_ADDRESS_RE.test(walletAddress)) {
      return jsonError('Invalid wallet address', 400);
    }

    const providerRaw = requireString(body.provider, 'provider');
    if (providerRaw !== 'moonpay' && providerRaw !== 'coinbase') {
      return jsonError("provider must be 'moonpay' or 'coinbase'", 400);
    }
    const provider = providerRaw as OnrampProvider;

    const amount = requireNumber(body.amount, 'amount');
    if (amount <= 0) return jsonError('amount must be > 0', 400);

    const partnerUserId = (session.userId || walletAddress).slice(0, 49);

    const id = await logOnrampSessionCreated({
      userId: walletAddress,
      walletAddress,
      provider,
      partnerUserId,
      amount,
    });

    return json({ id });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('onramp log-session error:', err);
    return jsonError('Failed to log onramp session', 500);
  }
}
