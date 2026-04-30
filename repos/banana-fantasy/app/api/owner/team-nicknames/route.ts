import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { getPrivyUser } from '@/lib/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Per-user, per-league custom team names. Stored as a single doc per user
// with a map of leagueId → nickname so reads are 1 doc per page load and
// writes update a single field path. Public read (display-only data; no
// sensitive info), authenticated write.
//
// GET  /api/owner/team-nicknames?walletAddress=0x…
//   → { nicknames: { [leagueId]: string } }
//
// POST /api/owner/team-nicknames  body: { walletAddress, leagueId, name }
//   → { ok: true } — empty/whitespace name removes the entry.

const COLLECTION = 'userTeamNicknames';
const MAX_NAME = 60;

export async function GET(req: NextRequest) {
  try {
    const walletAddress = (req.nextUrl.searchParams.get('walletAddress') || '').trim().toLowerCase();
    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }
    if (!isFirestoreConfigured()) {
      return NextResponse.json({ nicknames: {}, persisted: false });
    }
    const db = getAdminFirestore();
    const snap = await db.collection(COLLECTION).doc(walletAddress).get();
    const data = snap.exists ? snap.data() : null;
    const nicknames = (data?.nicknames as Record<string, string> | undefined) ?? {};
    return NextResponse.json({ walletAddress, nicknames });
  } catch (err) {
    logger.error('[team-nicknames GET] error', { err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

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
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : '';
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const name = rawName.slice(0, MAX_NAME);

    if (!walletAddress) return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
    if (walletAddress !== authenticatedWallet) {
      return NextResponse.json({ error: 'Wallet mismatch' }, { status: 403 });
    }

    if (!isFirestoreConfigured()) {
      return NextResponse.json({ ok: true, persisted: false });
    }

    const db = getAdminFirestore();
    const ref = db.collection(COLLECTION).doc(walletAddress);
    if (!name) {
      // Empty name = remove the entry.
      await ref.set(
        {
          walletAddress,
          [`nicknames.${leagueId}`]: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } else {
      await ref.set(
        {
          walletAddress,
          nicknames: { [leagueId]: name },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    logger.error('[team-nicknames POST] error', { err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
