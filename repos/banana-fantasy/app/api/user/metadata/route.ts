import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import type { WalletType } from '@/lib/activityEvents';

const USERS_COLLECTION = 'v2_users';
const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

const ALLOWED_WALLET_TYPES: WalletType[] = ['privy_embedded', 'privy_external', 'external_connect', 'unknown'];

/**
 * POST /api/user/metadata
 *
 * Captures lightweight session context on the user doc so it can be
 * denormalized onto activity events for analytics. Called once per session
 * from useAuth when we know the wallet type + device.
 *
 * Also accepts profile fields (nflTeam) that the Go API doesn't model.
 * The Go API owns username + profilePicture (in `owners` collection); this
 * route owns nflTeam (in `v2_users`) so it survives logout.
 *
 * Body: { userId, walletType?, userAgent?, nflTeam? }
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) return json({ ok: false, skipped: 'no-firestore' });

    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      walletType?: string;
      userAgent?: string;
      nflTeam?: string | null;
    } | null;
    if (!body?.userId || !WALLET_REGEX.test(body.userId)) {
      return jsonError('Invalid userId', 400);
    }

    const update: Record<string, unknown> = {
      lastSeenAt: new Date().toISOString(),
    };

    if (body.walletType !== undefined) {
      update.walletType = ALLOWED_WALLET_TYPES.includes(body.walletType as WalletType)
        ? (body.walletType as WalletType)
        : 'unknown';
    }
    if (body.userAgent !== undefined) {
      update.lastUserAgent = body.userAgent ?? null;
    }
    if (body.nflTeam !== undefined) {
      // Allow clearing with empty string / null
      update.nflTeam = body.nflTeam || null;
    }

    const db = getAdminFirestore();
    await db.collection(USERS_COLLECTION).doc(body.userId.toLowerCase()).set(update, { merge: true });

    return json({ ok: true });
  } catch (err) {
    logger.warn('user.metadata.failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
