import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import crypto from 'node:crypto';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateNonce, generateSeed, pickWeighted } from '@/lib/rng';
import { getWheelConfig } from '@/lib/wheelConfigFirestore';

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { addActivityEventToTx, buildActivityEventDoc, logActivityEvent } from '@/lib/activityEvents';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';

const WHEEL_SPINS_COLLECTION = 'wheelSpins';
const USERS_COLLECTION = 'v2_users';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

const jwksCache: {
  keys: Map<string, crypto.KeyObject>;
  cachedAt: number;
} = {
  keys: new Map(),
  cachedAt: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function getPrivyAppId(): string {
  const appId = (process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || '').trim();
  if (!appId) throw new ApiError(500, 'Privy app ID not configured');
  return appId;
}

async function getPrivyVerificationKey(kid: string): Promise<crypto.KeyObject> {
  const cacheExpired = jwksCache.cachedAt === 0 || (Date.now() - jwksCache.cachedAt) > JWKS_CACHE_TTL_MS;
  const cached = !cacheExpired ? jwksCache.keys.get(kid) : undefined;
  if (cached) return cached;
  await refreshPrivyVerificationKeys();
  const key = jwksCache.keys.get(kid);
  if (!key) throw new ApiError(401, 'Unknown signing key');
  return key;
}

async function refreshPrivyVerificationKeys(): Promise<void> {
  const appId = getPrivyAppId();
  const res = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
  if (!res.ok) throw new ApiError(500, 'Failed to fetch Privy JWKS');
  const jwks = await res.json() as { keys: Array<{ kid: string; kty: string; crv: string; x: string; y: string }> };

  jwksCache.keys = new Map();
  for (const jwk of jwks.keys) {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    jwksCache.keys.set(jwk.kid, key);
  }
  jwksCache.cachedAt = Date.now();
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: Buffer;
  signingInput: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'Invalid auth token');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(base64UrlDecode(headerPart).toString('utf8')) as Record<string, unknown>;
  const payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8')) as Record<string, unknown>;
  const signature = base64UrlDecode(signaturePart);
  return { header, payload, signature, signingInput: `${headerPart}.${payloadPart}` };
}

async function verifyPrivyJwt(token: string): Promise<string> {
  const appId = getPrivyAppId();

  const { header, payload, signature, signingInput } = decodeJwt(token);
  const alg = typeof header.alg === 'string' ? header.alg : '';
  if (!alg || !['ES256', 'RS256'].includes(alg)) throw new ApiError(401, 'Unsupported token algorithm: ' + alg);

  const kid = typeof header.kid === 'string' ? header.kid : '';
  if (!kid) throw new ApiError(401, 'Missing key ID in token header');

  const verifySignature = async (forceRefresh: boolean): Promise<boolean> => {
    const key = forceRefresh
      ? (await refreshPrivyVerificationKeys(), jwksCache.keys.get(kid))
      : await getPrivyVerificationKey(kid);

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
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
  }

  if (!isValid) {
    isValid = await verifySignature(true);
  }

  if (!isValid) throw new ApiError(401, 'Token signature verification failed');

  if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) {
    throw new ApiError(401, 'Auth token expired');
  }

  const aud = payload.aud;
  if (aud == null) throw new ApiError(401, 'Invalid auth token');
  const audienceMatches = Array.isArray(aud) ? aud.includes(appId) : aud === appId;
  if (!audienceMatches) throw new ApiError(401, 'Invalid auth token');

  const expectedIssuer = process.env.PRIVY_JWT_ISSUER?.trim();
  if (expectedIssuer && payload.iss !== expectedIssuer) {
    throw new ApiError(401, 'Invalid auth token');
  }

  const userId =
    (typeof payload.sub === 'string' && payload.sub) ||
    (typeof (payload as Record<string, unknown>).user_id === 'string' && (payload as Record<string, string>).user_id) ||
    (typeof (payload as Record<string, unknown>).userId === 'string' && (payload as Record<string, string>).userId);

  if (!userId) throw new ApiError(401, 'Invalid auth token');
  return userId;
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.wheel);
  if (rateLimited) return rateLimited;
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) throw new ApiError(401, 'Missing authorization token');

    // Verify JWT is valid (proves user is authenticated)
    // Note: Privy JWT sub is a DID (did:privy:xxx), not a wallet address.
    // The body userId is the wallet address used as our app's user ID.
    // We verify the JWT is valid but use the body userId for data lookups.
    await verifyPrivyJwt(token);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId) throw new ApiError(400, 'Missing userId');

    const db = getAdminFirestore();

    const { segments, segmentAngle } = await getWheelConfig();
    const seed = generateSeed();
    const nonce = generateNonce();

    // Allow forced results in staging — check multiple env signals
    const allowForcedResult =
      process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging' ||
      process.env.VERCEL_ENV === 'preview' ||
      (process.env.VERCEL_URL || '').includes('banana-fantasy') ||
      process.env.NODE_ENV === 'development';
    const forceResult =
      allowForcedResult && typeof body.forceResult === 'string' ? body.forceResult : null;
    let segment: typeof segments[number];
    let index: number;

    if (forceResult) {
      const forcedIdx = segments.findIndex(s => s.id === forceResult);
      if (forcedIdx >= 0) {
        segment = segments[forcedIdx];
        index = forcedIdx;
      } else {
        ({ value: segment, index } = pickWeighted(
          segments.map((s) => ({ value: s, probability: s.probability })),
          seed,
        ));
      }
    } else {
      ({ value: segment, index } = pickWeighted(
        segments.map((s) => ({ value: s, probability: s.probability })),
        seed,
      ));
    }

    const segmentCenter = index * segmentAngle + segmentAngle / 2;
    const angle = (360 - segmentCenter + 360) % 360;
    const spinId = crypto.randomUUID();

    const prize = {
      type: segment.prizeType,
      value: segment.prizeValue,
    };
    const timestamp = nowIso();

    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const spinRef = db.collection(WHEEL_SPINS_COLLECTION).doc(spinId);

    const draftPassCount =
      segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number'
        ? segment.prizeValue
        : 0;
    const mintOnChain = isAdminMintConfigured() && draftPassCount > 0;

    // Pre-build the spin_won activity doc OUTSIDE the transaction (Firestore
    // forbids new reads after writes inside a transaction). On-chain mint
    // tx hash + tokenIds aren't known yet — they get populated by a
    // follow-up update event after the mint succeeds, so the spin event is
    // recorded atomically with the counter mutation regardless of mint fate.
    const spinActivityDoc = await buildActivityEventDoc({
      type: 'spin_won',
      userId,
      paymentMethod: 'free',
      quantity: draftPassCount,
      metadata: {
        spinId,
        prizeType: segment.prizeType,
        prizeValue: segment.prizeValue,
        segmentId: segment.id,
        segmentLabel: segment.label,
        mintOnChain,
      },
    });

    await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      const userData = userDoc.data();
      const spinsLeft = userData?.wheelSpins ?? 0;
      if (spinsLeft <= 0) {
        throw new ApiError(429, 'No spins remaining');
      }

      tx.set(spinRef, {
        userId,
        spinId,
        result: segment.id,
        prize,
        timestamp,
        seed,
        nonce,
      });

      // Atomic counter update with floor-of-0 on every counter so legacy
      // bad data can't cascade. Spin decrement, optional pass / entry
      // increments — all in one transaction.
      const currentSpins = Math.max(0, (userData?.wheelSpins as number | undefined) ?? 0);
      const currentFree = Math.max(0, (userData?.freeDrafts as number | undefined) ?? 0);
      const currentJp = Math.max(0, (userData?.jackpotEntries as number | undefined) ?? 0);
      const currentHof = Math.max(0, (userData?.hofEntries as number | undefined) ?? 0);

      const balanceUpdate: Record<string, number> = {
        wheelSpins: Math.max(0, currentSpins - 1),
      };
      if (draftPassCount > 0) {
        balanceUpdate.freeDrafts = currentFree + draftPassCount;
      }
      if (segment.prizeType === 'custom' && segment.prizeValue === 'jackpot') {
        balanceUpdate.jackpotEntries = currentJp + 1;
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'hof') {
        balanceUpdate.hofEntries = currentHof + 1;
      }
      tx.set(userRef, balanceUpdate, { merge: true });

      // Activity event in the SAME transaction — counter and feed always
      // agree about whether the spin happened.
      addActivityEventToTx(tx, spinActivityDoc);
    });

    // On-chain mint for draft_pass wins — happens outside the tx so a failed
    // mint doesn't roll back the spin counter.
    let mintTxHash: string | undefined;
    let mintedTokenIds: string[] = [];
    if (mintOnChain) {
      try {
        const res = await reserveTokensToWallet({ to: userId, count: draftPassCount });
        mintTxHash = res.txHash;
        mintedTokenIds = res.tokenIds;
        await recordPassOrigins({
          tokenIds: mintedTokenIds,
          origin: 'spin_reward',
          ownerAtMint: userId,
          txHash: mintTxHash,
          reason: `wheel_spin:${spinId}`,
        });
        logger.info('wheel.spin.mint_ok', { spinId, userId, count: draftPassCount, txHash: mintTxHash, tokenIds: mintedTokenIds });
      } catch (mintErr) {
        logger.error('wheel.spin.mint_failed', { spinId, userId, count: draftPassCount, err: mintErr });
        try {
          await db.collection('failed_mints').doc(spinId).set({
            spinId,
            userId,
            count: draftPassCount,
            reason: `wheel_spin:${spinId}`,
            error: (mintErr as Error)?.message ?? String(mintErr),
            createdAt: FieldValue.serverTimestamp(),
            retryable: true,
          });
        } catch (logErr) {
          logger.error('wheel.spin.failed_mint_record_error', { spinId, err: logErr });
        }
      }
    }

    // The spin_won activity event was already written atomically with the
    // counter mutation above. If the on-chain mint succeeded after, log a
    // supplementary `pass_granted` event so the user's history shows the
    // mint tx hash + tokenIds (the spin event records what they won; this
    // records the on-chain delivery).
    if (mintOnChain && mintedTokenIds.length > 0) {
      await logActivityEvent({
        type: 'pass_granted',
        userId,
        paymentMethod: 'free',
        quantity: draftPassCount,
        tokenIds: mintedTokenIds,
        txHash: mintTxHash ?? null,
        metadata: {
          source: 'wheel_spin_mint',
          spinId,
        },
      });
    }

    // Referral milestone — fire 'verified' on the referrer's referral promo
    // once the friend has (a) claimed the New User Bonus SPIN
    // (newUserPromoClaimed === true on their twitter link) AND (b) actually
    // used a wheel spin (this route). Idempotent: updateReferralRewards
    // only flips a 'pending' reward to 'claim'.
    try {
      const twitterSnap = await db
        .collection('v2_twitter_links')
        .where('walletAddress', '==', userId.toLowerCase())
        .limit(1)
        .get();
      if (!twitterSnap.empty && twitterSnap.docs[0].data().newUserPromoClaimed) {
        const userDoc = await userRef.get();
        if (userDoc.exists && userDoc.data()?.referredBy) {
          const { updateReferralRewards } = await import('@/lib/db');
          await updateReferralRewards(userId, 'verified');
        }
      }
    } catch (refErr) {
      logger.warn('wheel.spin.referral_milestone_failed', {
        userId,
        err: (refErr as Error).message,
      });
    }

    // Auto-queue for Jackpot/HOF — happens server-side so it can't be interrupted
    if (segment.prizeType === 'custom' && (segment.prizeValue === 'jackpot' || segment.prizeValue === 'hof')) {
      try {
        const { joinQueue } = await import('@/lib/db');
        await joinQueue(userId, segment.prizeValue as 'jackpot' | 'hof');
        logger.debug(`[wheel/spin] Auto-queued ${userId} for ${segment.prizeValue}`);
      } catch (qErr) {
        console.warn(`[wheel/spin] Auto-queue failed (entry still awarded):`, qErr);
      }
    }

    return json(
      { spinId, result: segment.id, prize, angle, mintOnChain, txHash: mintTxHash, tokenIds: mintedTokenIds },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('wheel.spin.unhandled', { route: '/api/wheel/spin', err });
    return jsonError('Internal Server Error', 500);
  }
}
