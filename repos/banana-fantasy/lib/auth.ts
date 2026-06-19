import crypto from 'node:crypto';

import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

type JwtPayload = Record<string, unknown>;

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const jwksCache: {
  keys: Map<string, crypto.KeyObject>;
  cachedAt: number;
} = {
  keys: new Map(),
  cachedAt: 0,
};

function getPrivyAppId(): string {
  const appId = (process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || '').trim();
  if (!appId) throw new ApiError(500, 'Privy app ID not configured');
  return appId;
}

async function refreshJwksKeys(): Promise<void> {
  const appId = getPrivyAppId();
  const res = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
  if (!res.ok) {
    logger.error(LOG_SOURCES.auth.JWKS_FETCH_FAILED, {
      route: 'lib/auth',
      appId,
      status: res.status,
    });
    throw new ApiError(500, 'Failed to fetch Privy JWKS');
  }
  const jwks = await res.json() as { keys: Array<{ kid: string; kty: string; crv: string; x: string; y: string }> };

  jwksCache.keys = new Map();
  for (const jwk of jwks.keys) {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    jwksCache.keys.set(jwk.kid, key);
  }
  jwksCache.cachedAt = Date.now();
}

async function getVerificationKey(kid: string): Promise<crypto.KeyObject> {
  const cacheExpired = jwksCache.cachedAt === 0 || (Date.now() - jwksCache.cachedAt) > JWKS_CACHE_TTL_MS;
  const cached = !cacheExpired ? jwksCache.keys.get(kid) : undefined;
  if (cached) return cached;
  await refreshJwksKeys();
  const key = jwksCache.keys.get(kid);
  if (!key) throw new ApiError(401, 'Unknown signing key');
  return key;
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: JwtPayload;
  signature: Buffer;
  signingInput: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'Invalid auth token');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(base64UrlDecode(headerPart).toString('utf8')) as Record<string, unknown>;
  const payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8')) as JwtPayload;
  const signature = base64UrlDecode(signaturePart);
  return { header, payload, signature, signingInput: `${headerPart}.${payloadPart}` };
}

function getWalletFromPayload(payload: JwtPayload): string | null {
  const directFields = [
    payload.walletAddress,
    payload.wallet_address,
    payload.address,
    payload.user_wallet_address,
  ];

  for (const entry of directFields) {
    if (typeof entry === 'string' && entry.trim()) {
      return entry.trim().toLowerCase();
    }
  }

  const linkedAccounts = payload.linked_accounts;
  if (!Array.isArray(linkedAccounts)) return null;

  for (const account of linkedAccounts) {
    if (!account || typeof account !== 'object') continue;
    const record = account as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : '';
    const address = typeof record.address === 'string' ? record.address : '';
    if (type === 'wallet' && address.trim()) return address.trim().toLowerCase();
  }

  return null;
}

async function verifyPrivyJwt(token: string): Promise<{ userId: string; walletAddress: string | null }> {
  const appId = getPrivyAppId();
  const { header, payload, signature, signingInput } = decodeJwt(token);

  const alg = typeof header.alg === 'string' ? header.alg : '';
  if (!alg || !['ES256', 'RS256'].includes(alg)) throw new ApiError(401, 'Invalid auth token');

  const kid = typeof header.kid === 'string' ? header.kid : '';
  if (!kid) throw new ApiError(401, 'Missing key ID in token header');

  // Verify signature with JWKS key (try cache first, then refresh)
  const verifySignature = async (forceRefresh: boolean): Promise<boolean> => {
    const key = forceRefresh
      ? (await refreshJwksKeys(), jwksCache.keys.get(kid))
      : await getVerificationKey(kid);

    if (!key) throw new ApiError(401, 'Unknown signing key');

    const verifier = crypto.createVerify('SHA256');
    verifier.update(signingInput);
    verifier.end();

    return verifier.verify(
      alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key,
      signature,
    );
  };

  let isValid = false;
  try {
    isValid = await verifySignature(false);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  if (!isValid) {
    isValid = await verifySignature(true);
  }
  if (!isValid) {
    logger.error(LOG_SOURCES.auth.JWT_SIGNATURE_INVALID, {
      route: 'lib/auth',
      alg,
      kid,
    });
    throw new ApiError(401, 'Token signature verification failed');
  }

  // Check expiration
  if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) {
    throw new ApiError(401, 'Auth token expired');
  }

  // Check audience
  const aud = payload.aud;
  if (aud != null) {
    const audienceMatches = Array.isArray(aud) ? aud.includes(appId) : aud === appId;
    if (!audienceMatches) throw new ApiError(401, 'Invalid auth token');
  }

  // Check issuer
  const expectedIssuer = process.env.PRIVY_JWT_ISSUER?.trim();
  if (expectedIssuer && payload.iss && payload.iss !== expectedIssuer) {
    throw new ApiError(401, 'Invalid auth token');
  }

  const userId =
    (typeof payload.sub === 'string' && payload.sub.trim()) ||
    (typeof payload.user_id === 'string' && (payload as Record<string, string>).user_id.trim()) ||
    (typeof payload.userId === 'string' && (payload as Record<string, string>).userId.trim());

  if (!userId) throw new ApiError(401, 'Invalid auth token');

  return {
    userId,
    walletAddress: getWalletFromPayload(payload),
  };
}

// Cache Privy User API lookups per-userId for the lifetime of the lambda
// instance. Wallets don't change often, and avoiding a Privy round-trip on
// every request matters for hot endpoints (eligibility, sell-session). Soft
// 5-minute TTL.
const privyUserCache = new Map<string, { walletAddress: string | null; expires: number }>();
const PRIVY_USER_TTL_MS = 5 * 60 * 1000;
// A NULL result is cached only briefly: a brand-new social user's embedded
// wallet can take a beat to appear in the Privy User API, so a 5-min negative
// cache would wedge the wallet at null long after it exists (breaking new-user
// setup — firstLoginAt, bells). Short TTL = pick it up on the next call.
const PRIVY_USER_NEG_TTL_MS = 5 * 1000;

interface PrivyLinkedAccount {
  type?: string;
  address?: string;
  wallet_client_type?: string;
  chain_type?: string;
}

async function fetchWalletFromPrivyUserApi(userId: string): Promise<string | null> {
  const cached = privyUserCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.walletAddress;

  const appId = getPrivyAppId();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appSecret) return null;

  try {
    const auth = Buffer.from(`${appId}:${appSecret}`).toString('base64');
    const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Basic ${auth}`,
        'privy-app-id': appId,
      },
    });
    if (!res.ok) {
      console.warn('[auth] Privy User API non-OK:', res.status);
      logger.error(LOG_SOURCES.auth.PRIVY_USER_API_FAILED, { actor: userId, context: { status: res.status } });
      privyUserCache.set(userId, { walletAddress: null, expires: Date.now() + PRIVY_USER_NEG_TTL_MS });
      return null;
    }
    const data = (await res.json()) as { linked_accounts?: PrivyLinkedAccount[]; wallet?: { address?: string } };
    let wallet: string | null = null;
    // Prefer the first non-Privy embedded wallet (external > embedded)
    const accounts = Array.isArray(data.linked_accounts) ? data.linked_accounts : [];
    const external = accounts.find(
      (a) => a.type === 'wallet' && a.wallet_client_type !== 'privy' && typeof a.address === 'string',
    );
    const anyWallet = accounts.find((a) => a.type === 'wallet' && typeof a.address === 'string');
    wallet = (external?.address ?? anyWallet?.address ?? data.wallet?.address ?? null);
    if (wallet) wallet = wallet.toLowerCase();
    // Positive resolutions cache for the full TTL; a null (wallet not yet
    // visible) caches only briefly so the just-created wallet is picked up soon.
    privyUserCache.set(userId, { walletAddress: wallet, expires: Date.now() + (wallet ? PRIVY_USER_TTL_MS : PRIVY_USER_NEG_TTL_MS) });
    return wallet;
  } catch (err) {
    console.warn('[auth] Privy User API fetch failed:', err);
    logger.error(LOG_SOURCES.auth.PRIVY_USER_API_FAILED, { err, actor: userId });
    return null;
  }
}

export async function getPrivyUser(req: Request): Promise<{ userId: string; walletAddress: string | null }> {
  const authHeader = req.headers.get('authorization') || '';
  let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  // SSE/EventSource cannot set custom headers (browser limitation), so
  // SSE callers pass the JWT via `?token=` query string. We only honor
  // it when no Authorization header is present, so it can't be sniffed
  // to bypass an explicit header check on non-SSE callers.
  if (!token) {
    try {
      const qToken = new URL(req.url).searchParams.get('token');
      if (qToken && qToken.length >= 20) token = qToken;
    } catch { /* malformed URL → fall through to the 401 below */ }
  }
  if (!token) throw new ApiError(401, 'Missing authorization token');

  const user = await verifyPrivyJwt(token);

  // JWTs from social-login Privy sessions don't carry the wallet claim.
  // Fall back to the Privy User API so every downstream check (verification
  // doc key, ban check, audit logging) gets the wallet — without this, all
  // writes happen under did:privy:… and reads under the wallet, and they
  // never reconcile.
  if (!user.walletAddress) {
    const apiWallet = await fetchWalletFromPrivyUserApi(user.userId);
    if (apiWallet) user.walletAddress = apiWallet;
  }

  // Enforce bans at the auth gate — every authenticated API request checks
  // the wallet's banned flag. Cached 30s per instance to keep overhead low.
  if (user.walletAddress) {
    const { isUserBanned } = await import('@/lib/banCheck');
    if (await isUserBanned(user.walletAddress)) {
      throw new ApiError(403, 'Account suspended');
    }
  }

  // Fire-and-forget session tracker. Definition of a "login":
  // any authenticated request after ≥ 1h of inactivity. Updates the
  // user's lastActiveAt in Firestore and writes a `login` event when
  // the gap qualifies. Persistent across Vercel cold starts (unlike
  // the previous in-memory throttle).
  // Record activity ONLY under the resolved wallet — never the Privy DID.
  // Recording under the DID (when the wallet hasn't resolved yet) created junk
  // `v2_users/{did:privy:…}` docs with no wallet/owner/bells for new mobile
  // social users. Desktop/web3 always have a wallet here, so this is a no-op
  // for them.
  if (user.walletAddress) {
    import('@/lib/userEvents')
      .then(({ recordActivityAndDetectLogin }) => recordActivityAndDetectLogin(user.walletAddress as string))
      .catch(() => { /* non-fatal */ });
  }

  return user;
}
