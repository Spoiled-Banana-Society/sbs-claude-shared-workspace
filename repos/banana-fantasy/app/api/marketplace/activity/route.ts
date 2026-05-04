import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const COLLECTION = 'marketplace_activity';

// GET /api/marketplace/activity?wallet=0x...&limit=20&cursor=...
// GET /api/marketplace/activity?tokenId=123&type=buy,sell  — single token sale history
// GET /api/marketplace/activity?tokenIds=1,2,3             — batch last-sale lookup
export async function GET(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ activities: [], hasMore: false });
  }

  const wallet = req.nextUrl.searchParams.get('wallet');
  const tokenId = req.nextUrl.searchParams.get('tokenId');
  const tokenIds = req.nextUrl.searchParams.get('tokenIds');

  // Mode 1: Batch last-sale lookup for multiple tokens
  if (tokenIds) {
    const ids = tokenIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (ids.length === 0) {
      return NextResponse.json({ lastSales: {} });
    }

    try {
      const db = getAdminFirestore();
      const lastSales: Record<string, { price: number; timestamp: string }> = {};

      // Firestore 'in' queries limited to 30
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 30) {
        chunks.push(ids.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        const snapshot = await db
          .collection(COLLECTION)
          .where('tokenId', 'in', chunk)
          .where('type', 'in', ['buy', 'sell'])
          .orderBy('timestamp', 'desc')
          .get();

        for (const doc of snapshot.docs) {
          const data = doc.data();
          const tid = data.tokenId;
          // Only keep the most recent sale per token
          if (!lastSales[tid] && data.price != null) {
            lastSales[tid] = {
              price: data.price,
              timestamp: data.timestamp?.toDate?.()?.toISOString() ?? new Date().toISOString(),
            };
          }
        }
      }

      return NextResponse.json({ lastSales });
    } catch (err) {
      console.error('[activity] GET batch error:', err);
      return NextResponse.json({ error: 'Failed to fetch last sales' }, { status: 500 });
    }
  }

  // Mode 2: Single token sale history
  if (tokenId) {
    const typeParam = req.nextUrl.searchParams.get('type');
    const types = typeParam ? typeParam.split(',').map(s => s.trim()) : ['buy', 'sell'];
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20', 10), 50);

    try {
      const db = getAdminFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('tokenId', '==', tokenId)
        .where('type', 'in', types)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const activities = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      }));

      return NextResponse.json({ activities, hasMore: false });
    } catch (err) {
      console.error('[activity] GET tokenId error:', err);
      return NextResponse.json({ error: 'Failed to fetch token activity' }, { status: 500 });
    }
  }

  // Mode 3: Wallet activity (original)
  if (!wallet) {
    return NextResponse.json({ error: 'wallet, tokenId, or tokenIds parameter required' }, { status: 400 });
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20', 10), 50);
  const cursor = req.nextUrl.searchParams.get('cursor');

  try {
    const db = getAdminFirestore();
    let query = db
      .collection(COLLECTION)
      .where('walletAddress', '==', wallet.toLowerCase())
      .orderBy('timestamp', 'desc')
      .limit(limit + 1);

    if (cursor) {
      const cursorDoc = await db.collection(COLLECTION).doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const hasMore = snapshot.docs.length > limit;

    const activities = docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    }));

    return NextResponse.json({
      activities,
      hasMore,
      nextCursor: hasMore ? docs[docs.length - 1]?.id : null,
    });
  } catch (err) {
    console.error('[activity] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
  }
}

// POST /api/marketplace/activity
export async function POST(req: NextRequest) {
  if (!isFirestoreConfigured()) {
    return NextResponse.json({ ok: true, id: null });
  }

  try {
    const body = await req.json();
    const { type, walletAddress, tokenId, teamName, price, counterparty, orderHash, txHash } = body;

    if (!type || !walletAddress || !tokenId) {
      return NextResponse.json({ error: 'type, walletAddress, and tokenId are required' }, { status: 400 });
    }

    const validTypes = ['buy', 'sell', 'list', 'cancel', 'offer_made', 'offer_accepted'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

    const db = getAdminFirestore();
    const docRef = await db.collection(COLLECTION).add({
      type,
      walletAddress: walletAddress.toLowerCase(),
      tokenId: String(tokenId),
      teamName: teamName || `Team #${tokenId}`,
      price: price ?? null,
      counterparty: counterparty?.toLowerCase() ?? null,
      orderHash: orderHash ?? null,
      txHash: txHash ?? null,
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error('[activity] POST error:', err);
    return NextResponse.json({ error: 'Failed to log activity' }, { status: 500 });
  }
}
