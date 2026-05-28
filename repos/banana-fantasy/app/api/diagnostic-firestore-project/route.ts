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
    const db = getAdminFirestore();
    const app = getAdminApp();

    // Try an actual write and report exactly what happens. Removes the
    // ambiguity of "app.options.projectId is null but maybe the SA works
    // anyway" — if writes actually land, we know the pipeline is fine.
    let writeResult: { success: boolean; docId?: string; error?: string };
    try {
      const ref = await db.collection('v2_error_events').add({
        source: 'diagnostic.endpoint_probe',
        message: 'write attempt from /api/diagnostic-firestore-project',
        actor: 'diagnostic-endpoint',
        timestamp: new Date().toISOString(),
      });
      writeResult = { success: true, docId: ref.id };
    } catch (writeErr) {
      writeResult = {
        success: false,
        error: writeErr instanceof Error
          ? `${writeErr.name}: ${writeErr.message}`
          : String(writeErr),
      };
    }

    return NextResponse.json({
      projectId: app.options.projectId ?? null,
      databaseURL: app.options.databaseURL ?? null,
      envName: process.env.NEXT_PUBLIC_ENVIRONMENT ?? null,
      hasServiceAccountEnv: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      writeResult,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
