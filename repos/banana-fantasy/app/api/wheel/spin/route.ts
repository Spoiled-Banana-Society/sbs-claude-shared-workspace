import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import crypto from 'node:crypto';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateNonce, generateSeed, pickWeighted } from '@/lib/rng';
import { getWheelConfig } from '@/lib/wheelConfigFirestore';

const WHEEL_SPINS_COLLECTION = 'wheelSpins';
const USERS_COLLECTION = 'v2_users';

function nowIso() {
  return new Date().toISOString();
}

function getUtcDayRange(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.wheel);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody(req);
    const rawUserId = requireString(body.userId, 'userId');
    const userId = rawUserId.toLowerCase();

    const db = getAdminFirestore();

    // Check daily spin limit
    const { start, end } = getUtcDayRange();
    const existing = await db
      .collection(WHEEL_SPINS_COLLECTION)
      .where('userId', '==', userId)
      .where('timestamp', '>=', start)
      .where('timestamp', '<', end)
      .limit(1)
      .get();

    if (!existing.empty) {
      throw new ApiError(429, 'Spin already used today');
    }

    // Pick prize
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

    // Atomically: decrement wheelSpins, grant prize, record spin
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const updatedBalances = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data()! : {};
      const currentSpins = userData.wheelSpins ?? 0;

      if (currentSpins <= 0) {
        throw new ApiError(400, 'No wheel spins available');
      }

      const updates: Record<string, number> = {
        wheelSpins: currentSpins - 1,
      };

      // Grant the prize
      if (segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number') {
        updates.freeDrafts = (userData.freeDrafts ?? 0) + segment.prizeValue;
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'jackpot') {
        updates.jackpotEntries = (userData.jackpotEntries ?? 0) + 1;
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'hof') {
        updates.hofEntries = (userData.hofEntries ?? 0) + 1;
      }

      tx.set(userRef, updates, { merge: true });

      // Record the spin
      const spinRef = db.collection(WHEEL_SPINS_COLLECTION).doc(spinId);
      tx.set(spinRef, {
        userId,
        spinId,
        result: segment.id,
        prize,
        timestamp,
        seed,
        nonce,
      });

      return {
        wheelSpins: updates.wheelSpins,
        freeDrafts: updates.freeDrafts ?? userData.freeDrafts ?? 0,
        jackpotEntries: updates.jackpotEntries ?? userData.jackpotEntries ?? 0,
        hofEntries: updates.hofEntries ?? userData.hofEntries ?? 0,
      };
    });

    return json({
      spinId,
      result: segment.id,
      prize,
      angle,
      user: updatedBalances,
    }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[wheel/spin] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
