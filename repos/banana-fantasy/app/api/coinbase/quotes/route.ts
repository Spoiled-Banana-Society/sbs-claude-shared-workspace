export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { createSellQuote, type CdpPaymentMethod } from '@/lib/cdpAuth';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

interface QuoteOption {
  method: CdpPaymentMethod;
  label: string;
  speed: string;
  description: string;
}

// Per Coinbase Sell Config API for US, only these payment methods are
// supported: ACH_BANK_ACCOUNT, FIAT_WALLET, CRYPTO_ACCOUNT. RTP, CARD,
// PAYPAL are not supported for US offramp at the country level (verified
// 2026-05-05 against /onramp/v1/sell/config). Any quote returned for an
// unsupported method comes back with available:false; the UI filters those.
const OPTIONS: QuoteOption[] = [
  {
    method: 'ACH_BANK_ACCOUNT',
    label: 'Standard',
    speed: '1–3 business days',
    description: 'No fast-rails fee, deposited to your bank',
  },
  {
    method: 'FIAT_WALLET',
    label: 'Coinbase USD wallet',
    speed: 'Seconds',
    description: 'Instant credit to your Coinbase USD balance',
  },
  {
    method: 'CRYPTO_ACCOUNT',
    label: 'Coinbase crypto account',
    speed: 'Seconds',
    description: 'Move USDC to your Coinbase account',
  },
];

interface QuoteResult {
  method: CdpPaymentMethod;
  label: string;
  speed: string;
  description: string;
  available: boolean;
  error?: string;
  quoteId?: string;
  fiatAmount?: number;
  cryptoAmount?: number;
  totalFee?: number;
  expiresAt?: string;
}

function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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

    const cryptoAmountRaw = Number(body.cryptoAmount);
    if (!Number.isFinite(cryptoAmountRaw) || cryptoAmountRaw <= 0) {
      return jsonError('cryptoAmount must be a positive number', 400);
    }
    const sellAmount = (Math.round(cryptoAmountRaw * 100) / 100).toString();

    const country = (typeof body.country === 'string' ? body.country : 'US').trim().toUpperCase();
    const subdivision =
      typeof body.subdivision === 'string' ? body.subdivision.trim().toUpperCase() : undefined;

    const partnerUserId = (session.userId || walletAddress).slice(0, 49);
    const clientIp = getClientIp(req);

    const results = await Promise.all(
      OPTIONS.map(async (opt): Promise<QuoteResult> => {
        try {
          const q = await createSellQuote({
            sellCurrency: 'USDC',
            sellNetwork: 'base',
            sellAmount,
            cashoutCurrency: 'USD',
            paymentMethod: opt.method,
            country,
            ...(country === 'US' && subdivision ? { subdivision } : {}),
            sourceAddress: walletAddress,
            partnerUserId,
            ...(clientIp ? { clientIp } : {}),
          });

          const fiat = parseAmount(q.fiatAmount);
          const crypto = parseAmount(q.cryptoAmount);
          const networkFee = parseAmount(q.networkFee) ?? 0;
          const highFee = parseAmount(q.highFee) ?? 0;

          return {
            method: opt.method,
            label: opt.label,
            speed: opt.speed,
            description: opt.description,
            available: true,
            quoteId: q.quoteId,
            fiatAmount: fiat ?? undefined,
            cryptoAmount: crypto ?? undefined,
            totalFee: networkFee + highFee,
            expiresAt: q.expiresAt,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Quote unavailable';
          return {
            method: opt.method,
            label: opt.label,
            speed: opt.speed,
            description: opt.description,
            available: false,
            error: msg,
          };
        }
      }),
    );

    return json({ quotes: results, sellAmount });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('CDP quotes error:', err);
    return jsonError('Failed to fetch quotes', 500);
  }
}
