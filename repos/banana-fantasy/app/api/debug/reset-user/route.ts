import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/debug/reset-user — Delete a user's Firestore data so they get re-seeded fresh.
 * Body: { userId }
 * STAGING ONLY — delete this endpoint before prod.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

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

    return NextResponse.json({ success: true, deleted: userId });
  } catch (err) {
    console.error('[debug/reset-user]', err);
    return NextResponse.json({ error: 'Failed to reset' }, { status: 500 });
  }
}
