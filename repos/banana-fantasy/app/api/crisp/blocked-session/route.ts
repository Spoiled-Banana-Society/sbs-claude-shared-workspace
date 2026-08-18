import { NextResponse } from 'next/server';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crisp/blocked-session?sid=session_…
 * Public, boolean-only: is this Crisp visitor session on our support
 * blocklist (crisp_blocked_sessions)? Lets the widget stay hidden for a
 * blocked person even when they're logged out — the Crisp session cookie
 * outlives our login. Leaks nothing but yes/no for an opaque id.
 */
export async function GET(req: Request) {
  const sid = (new URL(req.url).searchParams.get('sid') ?? '').trim();
  if (!/^session_[A-Za-z0-9-]{8,80}$/.test(sid) || !isFirestoreConfigured()) {
    return NextResponse.json({ blocked: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const doc = await getAdminFirestore().collection('crisp_blocked_sessions').doc(sid).get();
    return NextResponse.json({ blocked: doc.exists }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ blocked: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
