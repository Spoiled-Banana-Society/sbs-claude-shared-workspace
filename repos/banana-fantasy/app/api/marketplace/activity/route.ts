import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

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
        // Single-field equality only (no composite index needed); filter type
        // and pick the most-recent sale per token in memory. Per-token sale
        // counts are tiny, so this is cheap and avoids an index dependency.
        const snapshot = await db
          .collection(COLLECTION)
          .where('tokenId', 'in', chunk)
          .get();

        const newestByToken: Record<string, number> = {};
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const tid = data.tokenId;
          if (data.type !== 'buy' && data.type !== 'sell') continue;
          if (data.price == null) continue;
          const tsMs = data.timestamp?.toDate?.()?.getTime?.() ?? 0;
          if (newestByToken[tid] == null || tsMs > newestByToken[tid]) {
            newestByToken[tid] = tsMs;
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
      // Single-field equality only (no composite index needed). Filter by type,
      // sort by timestamp, and limit in memory — a single token has few events.
      const snapshot = await db
        .collection(COLLECTION)
        .where('tokenId', '==', tokenId)
        .get();

      const typeSet = new Set(types);
      const activities = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate?.()?.toISOString() ?? new Date().toISOString(),
          _ts: doc.data().timestamp?.toDate?.()?.getTime?.() ?? 0,
        }))
        .filter((a) => { const t = (a as { type?: string }).type; return t != null && typeSet.has(t); })
        .sort((a, b) => b._ts - a._ts)
        .slice(0, limit)
        .map(({ _ts, ...rest }) => rest);

      return NextResponse.json({ activities, hasMore: false });
    } catch (err) {
      console.error('[activity] GET tokenId error:', err);
      return NextResponse.json({ error: 'Failed to fetch token activity' }, { status: 500 });
    }
  }

  // Mode 2b: Global feed (scope=all) — most recent activity across ALL wallets.
  // orderBy('timestamp') is a single-field index (auto-created), and a range/
  // startAfter on that SAME field is allowed — no composite index needed.
  if (req.nextUrl.searchParams.get('scope') === 'all') {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20', 10), 50);
    const cursor = req.nextUrl.searchParams.get('cursor'); // ISO timestamp of last item shown
    try {
      const db = getAdminFirestore();
      let q = db.collection(COLLECTION).orderBy('timestamp', 'desc');
      if (cursor) {
        const d = new Date(cursor);
        if (!Number.isNaN(d.getTime())) q = q.startAfter(Timestamp.fromDate(d));
      }
      const snapshot = await q.limit(limit + 1).get();
      const docs = snapshot.docs.slice(0, limit);
      const hasMore = snapshot.docs.length > limit;
      const activities = docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      }));
      const last = docs[docs.length - 1];
      const nextCursor = hasMore && last ? (last.data().timestamp?.toDate?.()?.toISOString() ?? null) : null;
      return NextResponse.json({ activities, hasMore, nextCursor });
    } catch (err) {
      console.error('[activity] GET all error:', err);
      return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
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
    // Single-field equality only (no composite index needed). Sort by timestamp
    // and paginate in memory — a wallet's activity list is small. The previous
    // `.where(walletAddress).orderBy(timestamp)` required a composite index this
    // collection doesn't have, so it threw and Transaction History showed nothing.
    const snapshot = await db
      .collection(COLLECTION)
      .where('walletAddress', '==', wallet.toLowerCase())
      .get();

    const sorted = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        _ts: doc.data().timestamp?.toDate?.()?.getTime?.() ?? 0,
      }))
      .sort((a, b) => b._ts - a._ts);

    // Cursor = the last doc id from the previous page; resume right after it.
    let start = 0;
    if (cursor) {
      const idx = sorted.findIndex(a => a.id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const page = sorted.slice(start, start + limit);
    const hasMore = sorted.length > start + limit;

    const activities = page.map(({ _ts, ...rest }) => rest);

    return NextResponse.json({
      activities,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
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
