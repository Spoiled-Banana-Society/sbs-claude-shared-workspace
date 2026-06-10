// Direct Coinbase Onramp session — bypasses Privy entirely.
//
// Mirrors /api/coinbase/sell-session. Mints a CDP session token using
// our server-side credentials, builds a hosted Coinbase Onramp URL,
// returns it. The frontend then opens the URL in a popup, the user
// pays, USDC lands in their wallet on Base, and the existing
// BuyPassesModal polling/auto-mint logic takes over.
//
// Why not use Privy's fundWallet({ preferredProvider: 'coinbase' }):
// Privy's external-wallet Coinbase Onramp routing requires per-app
// backend whitelisting from Privy support. Going direct via our own
// CDP credentials sidesteps that entirely — same path the offramp
// already uses successfully.

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { runInBackground } from '@/lib/serverBackground';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { buildOnrampUrl, createCdpSessionToken } from '@/lib/cdpAuth';
import { logOnrampSessionCreated } from '@/lib/onrampAudit';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function getClientIp(req: Request): string | undefined {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real?.trim()) return real.trim();
  return undefined;
}

function getOrigin(req: Request): string {
  const fromHeader = req.headers.get('origin');
  if (fromHeader) return fromHeader;
  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://banana-fantasy-sbs.vercel.app';
  }
}

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

    // USDC amount the buyer needs. Required so Coinbase can lock the
    // input — otherwise users can pay for the wrong total and the
    // mint flow breaks. Always quoted in USDC (== USD for stable).
    let presetCryptoAmount: number | undefined;
    if (body.cryptoAmount !== undefined && body.cryptoAmount !== null) {
      const n = Number(body.cryptoAmount);
      if (!Number.isFinite(n) || n <= 0) return jsonError('Invalid cryptoAmount', 400);
      presetCryptoAmount = Math.round(n * 100) / 100;
    }

    const origin = getOrigin(req);
    // Once Coinbase finishes the buy, it redirects the user back here.
    // We append ?onramp=success so the modal can resume the post-pay
    // flow if the user closes the tab and comes back.
    const redirectUrl = `${origin}/buy-passes?onramp=success`;

    // partnerUserId max 49 chars — use Privy userId or wallet address.
    // Coinbase ties anti-abuse limits to this, so it should be stable
    // per user across attempts.
    const partnerUserId = (session.userId || walletAddress).slice(0, 49);

    const { token } = await createCdpSessionToken({
      addresses: [{ address: walletAddress, blockchains: ['base'] }],
      assets: ['USDC'],
      clientIp: getClientIp(req),
    });

    const url = buildOnrampUrl({
      sessionToken: token,
      partnerUserId,
      redirectUrl,
      defaultAsset: 'USDC',
      defaultNetwork: 'base',
      presetCryptoAmount,
      fiatCurrency: 'USD',
    });

    // Log the session for the admin onramp dashboard. waitUntil-backed;
    // never blocks the response.
    runInBackground('onramp.session-created', logOnrampSessionCreated({
      userId: walletAddress,
      walletAddress,
      provider: 'coinbase',
      partnerUserId,
      amount: presetCryptoAmount,
    }));

    return json({ url, sessionToken: token, redirectUrl });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('CDP buy-session error:', err);
    return jsonError('Failed to create Coinbase buy session', 500);
  }
}
