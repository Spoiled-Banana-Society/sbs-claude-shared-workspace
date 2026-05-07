export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { buildOfframpUrl, createCdpSessionToken, type CdpPaymentMethod } from '@/lib/cdpAuth';
import { getPersonaVerification } from '@/lib/db-firestore';
import { checkBlockRules } from '@/lib/verifyBlockRules';
import { logOfframpSessionCreated } from '@/lib/offrampAudit';

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

    // Gate the cashout on KYC + SBS-specific block rules. We re-check at every
    // withdrawal (even for already-verified users) because state-by-state
    // restrictions mean a user who moves to a banned state must be re-blocked.
    // Read verification under wallet address (lowercase) — canonical key
    // matching /api/verify/submit's save target. Falls back to Privy userId
    // only when no wallet exists (defensive — shouldn't happen for cashout).
    const verificationKey = (session.walletAddress ?? session.userId).toLowerCase();
    const verification = await getPersonaVerification(verificationKey);
    if (!verification.tier1.verified) {
      // User hasn't completed Didit verification yet. Frontend pops the
      // VerificationModal to drive them through it.
      return json(
        {
          error: 'Identity verification required',
          requiresVerification: 'kyc',
        },
        403,
      );
    }
    const blockResult = checkBlockRules(verification.verifiedIdentity);
    if (blockResult.blocked) {
      // User is verified by Didit but blocked by SBS-specific rules
      // (banned state, parish-level ban, age below state minimum, etc.).
      return json(
        {
          error: blockResult.message || 'Withdrawal not permitted in your jurisdiction.',
          blockCode: blockResult.code,
          blockDetail: blockResult.detail,
        },
        403,
      );
    }

    // Optional preset crypto amount (USDC). If omitted, user picks on Coinbase.
    let presetCryptoAmount: number | undefined;
    if (body.cryptoAmount !== undefined && body.cryptoAmount !== null) {
      const n = Number(body.cryptoAmount);
      if (!Number.isFinite(n) || n <= 0) return jsonError('Invalid cryptoAmount', 400);
      presetCryptoAmount = Math.round(n * 100) / 100;
    }

    // Honour the destination the user picked in our UI (ACH / Coinbase wallet
    // / Coinbase crypto). Without this, Coinbase ignores our selection and
    // shows whatever default they want — which surfaced as users picking
    // "Standard ACH" but seeing the USD-cash-balance flow.
    const VALID_METHODS: CdpPaymentMethod[] = [
      'ACH_BANK_ACCOUNT',
      'FIAT_WALLET',
      'CRYPTO_ACCOUNT',
      'RTP',
      'CARD',
      'APPLE_PAY',
      'PAYPAL',
    ];
    const rawMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod : undefined;
    const defaultCashoutMethod = VALID_METHODS.includes(rawMethod as CdpPaymentMethod)
      ? (rawMethod as CdpPaymentMethod)
      : undefined;

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
      ...(defaultCashoutMethod ? { defaultCashoutMethod } : {}),
      presetCryptoAmount,
      fiatCurrency: 'USD',
    });

    // Audit log: record that we issued a Coinbase session for this user.
    // Status will be updated to tx_pending/completed/failed when tx-status
    // polling sees a real Coinbase tx, or marked abandoned after 1h with no
    // tx detected.
    await logOfframpSessionCreated({
      userId: verificationKey,
      walletAddress,
      partnerUserId,
      amount: presetCryptoAmount,
      paymentMethod: defaultCashoutMethod,
      draftId: typeof body.draftId === 'string' ? body.draftId : undefined,
    });

    return json({ url, sessionToken: token, redirectUrl });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('CDP sell-session error:', err);
    return jsonError('Failed to create cash-out session', 500);
  }
}
