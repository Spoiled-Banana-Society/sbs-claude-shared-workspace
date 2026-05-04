import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

function ensureStagingOnly() {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  return null;
}

async function resetUser(userId: string) {
  try {
    const db = getAdminFirestore();
    const userRef = db.collection('v2_users').doc(userId);

    // Delete subcollections
    const subcollections = ['promos', 'wheelSpins', 'metadata', 'draftHistory'];
    for (const sub of subcollections) {
      const snap = await userRef.collection(sub).get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      if (snap.docs.length > 0) await batch.commit();
    }

    // Delete user doc
    await userRef.delete();

    // Also delete any referral codes owned by this user
    const codesSnap = await db.collection('v2_referral_codes').where('userId', '==', userId).get();
    if (!codesSnap.empty) {
      const batch = db.batch();
      codesSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    return { success: true, deleted: userId };
  } catch (err) {
    console.error('[debug/reset-user]', err);
    return { error: 'Failed to reset' };
  }
}

/**
 * GET /api/debug/reset-user?userId=xxx — Reset via URL bar
 * Also lists all v2_users doc IDs if no userId provided.
 */
export async function GET(req: NextRequest) {
  const stagingOnlyResponse = ensureStagingOnly();
  if (stagingOnlyResponse) return stagingOnlyResponse;

  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    const db = getAdminFirestore();
    const usersSnap = await db.collection('v2_users').get();
    const ids = usersSnap.docs.map((doc) => doc.id);
    return NextResponse.json({ users: ids, hint: 'Add ?userId=xxx to reset one' });
  }
  const result = await resetUser(userId);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const stagingOnlyResponse = ensureStagingOnly();
  if (stagingOnlyResponse) return stagingOnlyResponse;

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  const result = await resetUser(userId);
  return NextResponse.json(result);
}
