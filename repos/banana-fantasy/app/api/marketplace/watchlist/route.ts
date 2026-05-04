import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const COLLECTION = 'marketplace_watchlist';

// GET /api/marketplace/watchlist?wallet=0x...
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) {
    return NextResponse.json({ error: 'wallet parameter required' }, { status: 400 });
  }

  if (!isFirestoreConfigured()) {
    return NextResponse.json({ items: [] });
  }

  try {
    const db = getAdminFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where('wallet', '==', wallet.toLowerCase())
      .orderBy('addedAt', 'desc')
      .limit(100)
      .get();

    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      addedAt: doc.data().addedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[watchlist] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }
}

// POST /api/marketplace/watchlist — add/upsert
export async function POST(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ ok: true });
  }

  try {
    const body = await req.json();
    const { wallet, tokenId, price } = body;

    if (!wallet || !tokenId) {
      return NextResponse.json({ error: 'wallet and tokenId required' }, { status: 400 });
    }

    const db = getAdminFirestore();
    const walletLower = wallet.toLowerCase();

    // Check if already exists
    const existing = await db
      .collection(COLLECTION)
      .where('wallet', '==', walletLower)
      .where('tokenId', '==', String(tokenId))
      .limit(1)
      .get();

    if (!existing.empty) {
      // Update lastKnownPrice
      await existing.docs[0].ref.update({
        lastKnownPrice: price ?? null,
      });
      return NextResponse.json({ ok: true, id: existing.docs[0].id });
    }

    const docRef = await db.collection(COLLECTION).add({
      wallet: walletLower,
      tokenId: String(tokenId),
      addedAt: FieldValue.serverTimestamp(),
      lastKnownPrice: price ?? null,
    });

    return NextResponse.json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error('[watchlist] POST error:', err);
    return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 });
  }
}

// DELETE /api/marketplace/watchlist
export async function DELETE(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ ok: true });
  }

  try {
    const body = await req.json();
    const { wallet, tokenId } = body;

    if (!wallet || !tokenId) {
      return NextResponse.json({ error: 'wallet and tokenId required' }, { status: 400 });
    }

    const db = getAdminFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where('wallet', '==', wallet.toLowerCase())
      .where('tokenId', '==', String(tokenId))
      .limit(1)
      .get();

    if (!snapshot.empty) {
      await snapshot.docs[0].ref.delete();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[watchlist] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to remove from watchlist' }, { status: 500 });
  }
}
