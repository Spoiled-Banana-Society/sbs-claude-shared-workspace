import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { createNotification } from '@/lib/queueNotifications';
import { pushStreamEventBg } from '@/lib/userEventStream';

const COLLECTION = 'marketplace_notifications';

// Max notifications returned in the full (read+unread) inbox view.
const INBOX_LIMIT = 50;

// GET /api/marketplace/notifications?wallet=0x...[&all=1]
// Default: unread only (legacy callers). all=1: read+unread inbox (the bell).
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) {
    return NextResponse.json({ error: 'wallet parameter required' }, { status: 400 });
  }

  if (!isFirestoreConfigured()) {
    return NextResponse.json({ notifications: [] });
  }

  const includeRead = req.nextUrl.searchParams.get('all') === '1'
    || req.nextUrl.searchParams.get('includeRead') === '1';

  try {
    const db = getAdminFirestore();
    let query = db
      .collection(COLLECTION)
      .where('wallet', '==', wallet.toLowerCase());

    // Unread-only is the legacy default; the bell passes all=1 for read-state sync.
    if (!includeRead) query = query.where('read', '==', false);

    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(includeRead ? INBOX_LIMIT : 20)
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
// Creates a notification for a specific wallet (delegates to the hub for
// cross-device dedupe + real-time ping).
export async function POST(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ ok: true });
  }

  try {
    const body = await req.json();
    const { wallet, type, title, message, link, dedupeKey, icon } = body;

    if (!wallet || !type || !title || !message) {
      return NextResponse.json({ error: 'wallet, type, title, and message are required' }, { status: 400 });
    }

    await createNotification(wallet, { type, title, message, link, dedupeKey, icon });

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

    // Real-time: tell the user's OTHER devices to refetch so read-state (e.g.
    // "Mark all read" on desktop) clears the bell on mobile near-instantly,
    // instead of waiting for the 30s poll / next focus.
    pushStreamEventBg(wallet, 'notification', { source: 'mark-read' });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[marketplace-notifications] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to mark as read' }, { status: 500 });
  }
}
