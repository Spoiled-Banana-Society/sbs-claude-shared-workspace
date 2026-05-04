import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const COLLECTION = 'marketplace_notifications';

// GET /api/marketplace/notifications?wallet=0x...
// Fetches unread notifications for the given wallet
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) {
    return NextResponse.json({ error: 'wallet parameter required' }, { status: 400 });
  }

  if (!isFirestoreConfigured()) {
    return NextResponse.json({ notifications: [] });
  }

  try {
    const db = getAdminFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where('wallet', '==', wallet.toLowerCase())
      .where('read', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const notifications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    }));

    return NextResponse.json({ notifications });
  } catch (err) {
    console.error('[marketplace-notifications] GET error:', err);
    return NextResponse.json({ notifications: [] });
  }
}

// POST /api/marketplace/notifications
// Creates a notification for a specific wallet
export async function POST(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ ok: true });
  }

  try {
    const body = await req.json();
    const { wallet, type, title, message, link } = body;

    if (!wallet || !type || !title || !message) {
      return NextResponse.json({ error: 'wallet, type, title, and message are required' }, { status: 400 });
    }

    const db = getAdminFirestore();
    await db.collection(COLLECTION).add({
      wallet: wallet.toLowerCase(),
      type,
      title,
      message,
      link: link || null,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[marketplace-notifications] POST error:', err);
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
  }
}

// PATCH /api/marketplace/notifications
// Mark notifications as read: { wallet: "0x...", ids: ["id1", "id2"] } or { wallet: "0x...", all: true }
export async function PATCH(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ ok: true });
  }

  try {
    const body = await req.json();
    const { wallet, ids, all } = body;

    if (!wallet) {
      return NextResponse.json({ error: 'wallet required' }, { status: 400 });
    }

    const db = getAdminFirestore();

    if (all) {
      const snapshot = await db
        .collection(COLLECTION)
        .where('wallet', '==', wallet.toLowerCase())
        .where('read', '==', false)
        .get();
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.update(doc.ref, { read: true }));
      await batch.commit();
    } else if (ids?.length) {
      const batch = db.batch();
      for (const id of ids) {
        batch.update(db.collection(COLLECTION).doc(id), { read: true });
      }
      await batch.commit();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[marketplace-notifications] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to mark as read' }, { status: 500 });
  }
}
