export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { buildOfframpUrl, createCdpSessionToken } from '@/lib/cdpAuth';
import { logger } from '@/lib/logger';

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

    // Optional preset crypto amount (USDC). If omitted, user picks on Coinbase.
    let presetCryptoAmount: number | undefined;
    if (body.cryptoAmount !== undefined && body.cryptoAmount !== null) {
      const n = Number(body.cryptoAmount);
      if (!Number.isFinite(n) || n <= 0) return jsonError('Invalid cryptoAmount', 400);
      presetCryptoAmount = Math.round(n * 100) / 100;
    }

    const origin = getOrigin(req);
    const redirectUrl = `${origin}/prizes?cashout=success`;

    const partnerUserId = (session.userId || walletAddress).slice(0, 49);

    const { token } = await createCdpSessionToken({
      addresses: [{ address: walletAddress, blockchains: ['base'] }],
      assets: ['USDC'],
      clientIp: getClientIp(req),
    });

    const url = buildOfframpUrl({
      sessionToken: token,
      partnerUserId,
      redirectUrl,
      defaultAsset: 'USDC',
      defaultNetwork: 'base',
      presetCryptoAmount,
      fiatCurrency: 'USD',
    });

    return json({ url, sessionToken: token, redirectUrl });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('coinbase.sell-session.unhandled', { route: '/api/coinbase/sell-session', err });
    return jsonError('Failed to create cash-out session', 500);
  }
}
