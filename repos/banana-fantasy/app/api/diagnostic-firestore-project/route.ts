import { NextResponse } from 'next/server';
import { getAdminApp, getAdminFirestore } from '@/lib/firebaseAdmin';

// Diagnostic endpoint — returns which Firebase project the server-side
// Admin SDK is initialized against. Used to figure out why v2_error_events
// writes from /api/client-errors silently drop on Vercel — the suspicion
// is that FIREBASE_SERVICE_ACCOUNT_JSON env var points to a different
// project than we're querying. Remove after the pipeline is fixed.
//
// projectId is non-sensitive — it's the same value already exposed via
// NEXT_PUBLIC_FIREBASE_* client env vars. Not exposing any credentials.

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // touch Firestore to ensure the lazy init happens
    getAdminFirestore();
    const app = getAdminApp();
    return NextResponse.json({
      projectId: app.options.projectId ?? null,
      databaseURL: app.options.databaseURL ?? null,
      // also include any obvious env signals
      envName: process.env.NEXT_PUBLIC_ENVIRONMENT ?? null,
      hasServiceAccountEnv: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
