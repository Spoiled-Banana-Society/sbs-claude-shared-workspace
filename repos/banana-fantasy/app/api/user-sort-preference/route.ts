import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { getPrivyUser } from '@/lib/auth';
import { logger } from '@/lib/logger';

const COLLECTION = 'userSortPreference';
export type SortPreference = 'adp' | 'rank';
const DEFAULT_PREFERENCE: SortPreference = 'adp';

function isValid(value: unknown): value is SortPreference {
  return value === 'adp' || value === 'rank';
}

/**
 * GET /api/user-sort-preference?walletAddress=0x...
 * Returns the user's default auto-pick sort order (adp or rank). Used by
 * the draft room on initial entry to prefer rankings over ADP when the
 * user has flipped this toggle on their rankings page.
 */
export async function GET(req: NextRequest) {
  try {
    const walletAddress = (req.nextUrl.searchParams.get('walletAddress') || '').trim().toLowerCase();
    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (!isFirestoreConfigured()) {
      return NextResponse.json({ walletAddress, preference: DEFAULT_PREFERENCE, persisted: false });
    }
    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).doc(walletAddress).get();
    const stored = snap.exists ? snap.data()?.preference : null;
    const preference = isValid(stored) ? stored : DEFAULT_PREFERENCE;
    return NextResponse.json({ walletAddress, preference, persisted: snap.exists });
  } catch (err) {
    logger.error('[user-sort-preference GET] error', { err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/user-sort-preference
 * Body: { walletAddress, preference: 'adp' | 'rank' }
 * Upserts the caller's default auto-pick sort order. Auth pattern matches
 * /api/user-positional-limits.
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
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    if (walletAddress !== authenticatedWallet) {
      return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
    }

    if (!isValid(body.preference)) {
      return NextResponse.json({ error: "preference must be 'adp' or 'rank'" }, { status: 400 });
    }

    if (!isFirestoreConfigured()) {
      return NextResponse.json({ ok: true, preference: body.preference, persisted: false });
    }

    const db = getAdminFirestore();
    await db.collection(COLLECTION).doc(walletAddress).set(
      {
        walletAddress,
        preference: body.preference,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, preference: body.preference, persisted: true });
  } catch (err) {
    logger.error('[user-sort-preference POST] error', { err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
