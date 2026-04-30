import { generateJwt } from '@coinbase/cdp-sdk/auth';

import { ApiError } from '@/lib/api/errors';

const CDP_HOST = 'api.developer.coinbase.com';
const TOKEN_PATH = '/onramp/v1/token';

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

function getCdpCredentials(): { apiKeyId: string; apiKeySecret: string } {
  const apiKeyId = (process.env.CDP_API_KEY_ID || '').trim();
  const apiKeySecret = (process.env.CDP_API_KEY_SECRET || '').trim();
  if (!apiKeyId || !apiKeySecret) {
    throw new ApiError(500, 'CDP API credentials not configured');
  }
  return { apiKeyId, apiKeySecret };
}

export async function createCdpSessionToken(
  input: CreateSessionTokenInput,
): Promise<CreateSessionTokenResponse> {
  const { apiKeyId, apiKeySecret } = getCdpCredentials();

  const jwt = await generateJwt({
    apiKeyId,
    apiKeySecret,
    requestMethod: 'POST',
    requestHost: CDP_HOST,
    requestPath: TOKEN_PATH,
  });

  const res = await fetch(`https://${CDP_HOST}${TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      addresses: input.addresses,
      ...(input.assets ? { assets: input.assets } : {}),
      ...(input.clientIp ? { clientIp: input.clientIp } : {}),
    }),
  });

  if (!res.ok) {
    let message = `CDP session token request failed (${res.status})`;
    try {
      const data = (await res.json()) as { message?: string; error?: { message?: string } };
      if (data?.error?.message) message = data.error.message;
      else if (data?.message) message = data.message;
    } catch {
      // ignore body parse errors
    }
    throw new ApiError(res.status, message);
  }

  const data = (await res.json()) as { token?: string; channelId?: string };
  if (!data.token) {
    throw new ApiError(502, 'CDP session token response missing token');
  }
  return { token: data.token, channelId: data.channelId };
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
