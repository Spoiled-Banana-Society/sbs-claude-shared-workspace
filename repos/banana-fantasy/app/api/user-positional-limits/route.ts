import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { getPrivyUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  applyDefaults,
  DEFAULT_POSITION_LIMITS,
  LIMIT_BOUNDS,
  POSITIONS,
  readLimitsEnabled,
  type Position,
} from '@/lib/positionLimits';

const COLLECTION = 'userPositionalLimits';

/**
 * GET /api/user-positional-limits?walletAddress=0x...
 * Returns the user's per-position auto-draft caps merged with defaults.
 * Public read — these aren't sensitive and the Go API needs to be able
 * to look them up server-side without an auth token.
 */
export async function GET(req: NextRequest) {
  try {
    const walletAddress = (req.nextUrl.searchParams.get('walletAddress') || '').trim().toLowerCase();
    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (!isFirestoreConfigured()) {
      return NextResponse.json({ walletAddress, limits: DEFAULT_POSITION_LIMITS, enabled: true, persisted: false });
    }
    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).doc(walletAddress).get();
    const data = snap.exists ? snap.data() : null;
    const limits = applyDefaults(data);
    return NextResponse.json({ walletAddress, limits, enabled: readLimitsEnabled(data), persisted: snap.exists });
  } catch (err) {
    logger.error('[user-positional-limits GET] error', { err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/user-positional-limits
 * Body: { walletAddress, QB, RB, WR, TE, DST }
 * Upserts the caller's caps. Each value must be an integer in
 * [LIMIT_BOUNDS.min, LIMIT_BOUNDS.max]. Auth pattern matches
 * notifications/subscribe — the authenticated wallet must match the body.
 */
export async function POST(req: NextRequest) {
  try {
    let authenticatedWallet: string;
    try {
      const user = await getPrivyUser(req);
      authenticatedWallet = (user.walletAddress || '').toLowerCase();
      if (!authenticatedWallet) throw new Error('no wallet on user');
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim().toLowerCase() : '';
    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (walletAddress !== authenticatedWallet) {
      return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
    }

    const limits: Record<Position, number> = { ...DEFAULT_POSITION_LIMITS };
    for (const pos of POSITIONS) {
      const v = body[pos];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < LIMIT_BOUNDS.min || v > LIMIT_BOUNDS.max) {
        return NextResponse.json(
          { error: `${pos} must be an integer in [${LIMIT_BOUNDS.min}, ${LIMIT_BOUNDS.max}]` },
          { status: 400 },
        );
      }
      limits[pos] = v;
    }

    // Master on/off. Optional in the body; defaults ON. Only `false` disables.
    const enabled = body.enabled === false ? false : true;

    if (!isFirestoreConfigured()) {
      return NextResponse.json({ ok: true, limits, enabled, persisted: false });
    }

    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(walletAddress).set(
      {
        walletAddress,
        ...limits,
        enabled,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, limits, enabled, persisted: true });
  } catch (err) {
    logger.error('[user-positional-limits POST] error', { err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
