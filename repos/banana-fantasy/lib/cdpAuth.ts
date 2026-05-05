import { generateJwt } from '@coinbase/cdp-sdk/auth';

import { ApiError } from '@/lib/api/errors';

const CDP_HOST = 'api.developer.coinbase.com';
const TOKEN_PATH = '/onramp/v1/token';
const SELL_QUOTE_PATH = '/onramp/v1/sell/quote';

export type CdpPaymentMethod =
  | 'ACH_BANK_ACCOUNT'
  | 'RTP'
  | 'CARD'
  | 'APPLE_PAY'
  | 'PAYPAL'
  | 'FIAT_WALLET'
  | 'CRYPTO_ACCOUNT';

export interface SessionTokenAddress {
  address: string;
  blockchains: string[];
}

export interface CreateSessionTokenInput {
  addresses: SessionTokenAddress[];
  assets?: string[];
  clientIp?: string;
}

export interface CreateSessionTokenResponse {
  token: string;
  channelId?: string;
}

export interface SellQuoteInput {
  sellCurrency: string;
  sellAmount: string;
  cashoutCurrency: string;
  paymentMethod: CdpPaymentMethod;
  country: string;
  subdivision?: string;
  sellNetwork?: string;
  sourceAddress?: string;
  partnerUserId?: string;
  redirectUrl?: string;
  clientIp?: string;
}

export interface SellQuoteResponse {
  quoteId: string;
  expiresAt: string;
  price: string;
  lowFee: string;
  highFee: string;
  networkFee: string;
  totalPrice: string;
  cryptoAmount: string;
  fiatAmount: string;
}

export interface OfframpTransaction {
  id: string;
  asset: string;
  status: string;
  network: string;
  sell_amount: { value: string; currency: string };
  total: { value: string; currency: string };
  subtotal: { value: string; currency: string };
  coinbase_fee: { value: string; currency: string };
  exchange_rate: { value: string; currency: string };
  fromAddress: string;
  toAddress: string;
  tx_hash: string;
  created_at: string;
  updated_at: string;
}

export interface UserTransactionsResponse {
  transactions: OfframpTransaction[];
  next_page_key?: string;
  total_count: number;
}

function getCdpCredentials(): { apiKeyId: string; apiKeySecret: string } {
  const apiKeyId = (process.env.CDP_API_KEY_ID || '').trim();
  const apiKeySecret = (process.env.CDP_API_KEY_SECRET || '').trim();
  if (!apiKeyId || !apiKeySecret) {
    throw new ApiError(500, 'CDP API credentials not configured');
  }
  return { apiKeyId, apiKeySecret };
}

async function cdpRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const { apiKeyId, apiKeySecret } = getCdpCredentials();

  const jwt = await generateJwt({
    apiKeyId,
    apiKeySecret,
    requestMethod: method,
    requestHost: CDP_HOST,
    requestPath: path,
  });

  const res = await fetch(`https://${CDP_HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    let message = `CDP request failed (${res.status})`;
    try {
      const data = (await res.json()) as { message?: string; error?: { message?: string } };
      if (data?.error?.message) message = data.error.message;
      else if (data?.message) message = data.message;
    } catch {
      // ignore body parse errors
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export async function createCdpSessionToken(
  input: CreateSessionTokenInput,
): Promise<CreateSessionTokenResponse> {
  const data = await cdpRequest<{ token?: string; channelId?: string }>(
    'POST',
    TOKEN_PATH,
    {
      addresses: input.addresses,
      ...(input.assets ? { assets: input.assets } : {}),
      ...(input.clientIp ? { clientIp: input.clientIp } : {}),
    },
  );
  if (!data.token) {
    throw new ApiError(502, 'CDP session token response missing token');
  }
  return { token: data.token, channelId: data.channelId };
}

export async function createSellQuote(input: SellQuoteInput): Promise<SellQuoteResponse> {
  return cdpRequest<SellQuoteResponse>('POST', SELL_QUOTE_PATH, input);
}

export async function getUserOfframpTransactions(
  partnerUserId: string,
  pageSize = 5,
): Promise<UserTransactionsResponse> {
  const path = `/onramp/v1/sell/user/${encodeURIComponent(partnerUserId)}/transactions?page_size=${pageSize}`;
  return cdpRequest<UserTransactionsResponse>('GET', path);
}

export interface BuildSellUrlInput {
  sessionToken: string;
  partnerUserId: string;
  redirectUrl: string;
  defaultAsset?: string;
  defaultNetwork?: string;
  presetCryptoAmount?: number;
  presetFiatAmount?: number;
  fiatCurrency?: string;
}

export function buildOfframpUrl(input: BuildSellUrlInput): string {
  const params = new URLSearchParams();
  params.set('sessionToken', input.sessionToken);
  params.set('partnerUserId', input.partnerUserId);
  params.set('redirectUrl', input.redirectUrl);
  if (input.defaultAsset) params.set('defaultAsset', input.defaultAsset);
  if (input.defaultNetwork) params.set('defaultNetwork', input.defaultNetwork);
  if (typeof input.presetCryptoAmount === 'number') {
    params.set('presetCryptoAmount', input.presetCryptoAmount.toString());
  }
  if (typeof input.presetFiatAmount === 'number') {
    params.set('presetFiatAmount', input.presetFiatAmount.toString());
  }
  if (input.fiatCurrency) params.set('fiatCurrency', input.fiatCurrency);
  return `https://pay.coinbase.com/v3/sell?${params.toString()}`;
}
