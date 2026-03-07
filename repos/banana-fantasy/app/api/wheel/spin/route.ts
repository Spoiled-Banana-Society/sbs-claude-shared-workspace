import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import crypto from 'node:crypto';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateNonce, generateSeed, pickWeighted } from '@/lib/rng';
import { getWheelConfig } from '@/lib/wheelConfigFirestore';

import { FieldValue } from 'firebase-admin/firestore';

const WHEEL_SPINS_COLLECTION = 'wheelSpins';
const USERS_COLLECTION = 'v2_users';

let cachedKeys: Map<string, crypto.KeyObject> = new Map();

function nowIso() {
  return new Date().toISOString();
}

function getPrivyAppId(): string {
  const appId = (process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || '').trim();
  if (!appId) throw new ApiError(500, 'Privy app ID not configured');
  return appId;
}

async function getPrivyVerificationKey(kid: string): Promise<crypto.KeyObject> {
  const cached = cachedKeys.get(kid);
  if (cached) return cached;

  const appId = getPrivyAppId();
  const res = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
  if (!res.ok) throw new ApiError(500, 'Failed to fetch Privy JWKS');
  const jwks = await res.json() as { keys: Array<{ kid: string; kty: string; crv: string; x: string; y: string }> };

  for (const jwk of jwks.keys) {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    cachedKeys.set(jwk.kid, key);
  }

  const key = cachedKeys.get(kid);
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

  const key = await getPrivyVerificationKey(kid);
  const verifier = crypto.createVerify('SHA256');
  verifier.update(signingInput);
  verifier.end();

  const isValid = verifier.verify(
    alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key,
    signature,
  );

  if (!isValid) throw new ApiError(401, 'Token signature verification failed');

  if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) {
    throw new ApiError(401, 'Auth token expired');
  }

  if (payload.aud) {
    const aud = payload.aud;
    const ok = Array.isArray(aud) ? aud.includes(appId) : aud === appId;
    if (!ok) throw new ApiError(401, 'Invalid auth token');
  }

  const expectedIssuer = process.env.PRIVY_JWT_ISSUER;
  if (expectedIssuer && payload.iss && payload.iss !== expectedIssuer) {
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

    // JWT proves authentication; userId from body matches frontend's user.id
    await verifyPrivyJwt(token);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId) throw new ApiError(400, 'Missing userId');

    const db = getAdminFirestore();

    // Check that user has spins remaining
    const userDoc = await db.collection(USERS_COLLECTION).doc(userId).get();
    const userData = userDoc.data();
    const spinsLeft = userData?.wheelSpins ?? 0;
    if (spinsLeft <= 0) {
      throw new ApiError(429, 'No spins remaining');
    }

    const { segments, segmentAngle } = await getWheelConfig();
    const seed = generateSeed();
    const nonce = generateNonce();
    const { value: segment, index } = pickWeighted(
      segments.map((s) => ({ value: s, probability: s.probability })),
      seed,
    );

    const segmentCenter = index * segmentAngle + segmentAngle / 2;
    const angle = (360 - segmentCenter + 360) % 360;
    const spinId = crypto.randomUUID();

    const prize = {
      type: segment.prizeType,
      value: segment.prizeValue,
    };
    const timestamp = nowIso();

    // Write spin record and update user balance atomically
    const batch = db.batch();

    batch.set(db.collection(WHEEL_SPINS_COLLECTION).doc(spinId), {
      userId,
      spinId,
      result: segment.id,
      prize,
      timestamp,
      seed,
      nonce,
    });

    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const balanceUpdate: Record<string, FieldValue | number> = {
      wheelSpins: FieldValue.increment(-1),
    };
    if (segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number') {
      balanceUpdate.freeDrafts = FieldValue.increment(segment.prizeValue);
    } else if (segment.prizeType === 'custom' && segment.prizeValue === 'jackpot') {
      balanceUpdate.jackpotEntries = FieldValue.increment(1);
    } else if (segment.prizeType === 'custom' && segment.prizeValue === 'hof') {
      balanceUpdate.hofEntries = FieldValue.increment(1);
    }
    batch.set(userRef, balanceUpdate, { merge: true });

    await batch.commit();

    return json({ spinId, result: segment.id, prize, angle }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[wheel/spin] Unhandled error:', err);
    return jsonError('Internal Server Error', 500);
  }
}
