import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

const REFERRAL_CODES_COLLECTION = 'v2_referral_codes';

/**
 * GET /r/{code} — the short name-based referral link (…/r/BorisV).
 * Bumps the code's click counter (best-effort) and lands the visitor on the
 * homepage with ?ref= set, which useAuth already captures into
 * sessionStorage for signup attribution. Unknown codes still redirect —
 * never dead-end a shared link.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const raw = String(params.code || '').slice(0, 32);
  const id = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  if (id && isFirestoreConfigured()) {
    try {
      const db = getAdminFirestore();
      const ref = db.collection(REFERRAL_CODES_COLLECTION).doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        // Only count clicks for real codes — don't mint junk docs for typos.
        const { FieldValue } = await import('firebase-admin/firestore');
        await ref.set(
          { clicks: FieldValue.increment(1), lastClickAt: new Date().toISOString() },
          { merge: true },
        );
      }
    } catch { /* click counting is best-effort */ }
  }

  return NextResponse.redirect(new URL(`/?ref=${encodeURIComponent(id)}`, req.url), 307);
}
