/**
 * Firebase Admin SDK singleton for server-side Firestore access.
 * 
 * Uses FIREBASE_SERVICE_ACCOUNT_JSON env var (base64-encoded or raw JSON)
 * to authenticate. Falls back to application default credentials.
 */

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getDatabase, type Database as RtdbDatabase } from 'firebase-admin/database';

const STAGING_RTDB_URL = 'https://sbs-staging-env-default-rtdb.firebaseio.com';

let _app: App | null = null;
let _db: Firestore | null = null;
let _rtdb: RtdbDatabase | null = null;

// Staging service account (base64) — hardcoded fallback for Vercel runtime
// where .env.production server-side vars are not available.
const STAGING_SA_B64 = 'ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAic2JzLXN0YWdpbmctZW52IiwKICAicHJpdmF0ZV9rZXlfaWQiOiAiODU1ZmM5YWY4MWJmYTUxNDBhMWRlMjdiYmMyY2MyNzAyMjg3NDVmZCIsCiAgInByaXZhdGVfa2V5IjogIi0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVxuTUlJRXZnSUJBREFOQmdrcWhraUc5dzBCQVFFRkFBU0NCS2d3Z2dTa0FnRUFBb0lCQVFDalhxZTU3ZUs5dU13SFxud1ZWbHl3ekZkcGhIMFF5R2d5MUM1N0hCT2h0SytRbTA4bW1TR0ZEZWkwM0N6c0NZQ1kwalNvaHR6OU15VzBGYlxuNWI1R0p0Y2lTMThHL0E2UDE2aHVhdlordUVobzF2emNvNkxVNVI2TWRTTGFWaG9zRCtibncxUEY3bzc1a0M4clxuZnp6NlhZellObjlsaEtXM2w1U1kxRW8yVEZodVMyWkRZaUpyUVFzYnNhWkJLd05qUG5wdjlnOWxYQUdLVWNyQVxuYTVuS0J6WlJhMjI1WUw3dkZ4bGRBU3hNQmUzaUl1cWZQNGpXSlFMbUpmYThSakJNWGJqYWkxdGVONmRYOUlxRFxuYkwrWjl6TDZnMjhheEpad0tTTGJJbzFnYURzVWFkQU1HSHhZdlMxelNGK3VWaXFZS0N4U0xNOGhuOWhjNU1XaVxuN012OXMvQm5BZ01CQUFFQ2dnRUFCUEs3Lzh5dHZuTlhjckN2Wm5yazh5SXBjSnRyVnJPb2JrdFlQZk1GbXBxNlxuYVltaUd2T3psMW4reS9TNUxxR3piYXMzUUtRMzBHR2xOQ1JjUkFHdktISEIraE11V2JyOWRnSzFYcGMwVWtDWVxudmhJU3Y0SUZEOW9JYVRhTWFtTTg2aTRuWG1wZ1dEeSt3UUdFbGt5NUZGOXFNbWYzSVAxdFdjZXNTOEs2TnZUelxuUHVGVU1YTzR1V0lrY1h1T3BqUnhkeHRZemltUGd5N3I4REwzM1JkYjBCOEhqeU81ZytBekRtVVJIR1Mwc29lS1xuaERmWEE0c3VmbUxXYzZGbnkwK0EyMmtQOGpNM2szWjc0S2Z0WVpoRDlyUHQ4cVRXMjVsRVYyTHUxb2o3ZzhTb1xuQ0dGZ0tYQ2h5SENDTE02QlorMHZPV1c1QTVOM0plRjU1dEl2eEZFN0dRS0JnUURmbnhpNENSZ1RNWUVSaVl5WlxuU0hBYkhIci96SWIyTTZZR3FXSTluekJuV01TRGdzMlpsc1RBdWJoTjJpUWJ6WVRhT3p1N1gzd0RtQzhmaWR1c1xueDBHUVhwVG9UQzk3NmVDQnNWaWk4Rko5cGExNjIrY2pBQUYzV0RwbmUzcEU3b0Z2WjlhV2dsU2xUNFdwcVBHM1xueURScE8xWUFXY0l6Ympvbi9OZG9PNm1mRFFLQmdRQzdCanBSSWxVTmNGVTY0QjFOSGlXNXlraWxaQ3FYYmhaR1xuK2VicTdTb0JOT1pvYzBnaHFBOXJ4djRodE5iNXhhaWlKNXk2VTY5UDFmdGdHWXMzZDBXcCtuMXVwdGJOMTA3TVxudEM3dXJ0ai9POVJ6bDEweFdiTFZWMmpVRVpOS2hscHBCUThrekI0V3hLeVVEK0ZDNk9WTVhVTVdVYXVDK0NFcVxuTDBzWDNEaVFRd0tCZ1FESDFCLyt0UUd5aFJaVldaa3VrTEM5U1dJUW0vQXVxbEMrdXpaeTRvSWFtQlJqZ012QlxuYUIxQ0s3UXF2Ymh1citUOEx0cGR3aUhNQkg1M3JIV0ZuRGxXalc1N2R6a25mZ09GWWJsWFFYSTFuWXU4c2kyRlxuOVVkYUlwbHVSOFVuUEFxbVJ5QlhOdmYxRVc3Y0FZQ2ZQbVMzZExLUmRhUTQyVk5XMEhhZFNsTjFNUUtCZ1FDMFxubldnV1VMeW8xTkpLb0lOTHBaQ3pZMHBUQjNBbWUvZGhwaGUreXpsa251emc5R3cxckxMdjErWTNNUWpuZ0Y3QlxuOHRWbUVFbGZKWHkxS3hZS2c5SXdQS3VELy9XMEpubUFNWWFkbFJnVkxYZVlCaGJIQVNRMjZrcGZlM1d1WkIvT1xuQ2tlOHRxOWNONldlKzlNRXBoeERhbEhPclNLZ3dmWnRZZXo0WndIdE53S0JnQktoclhUV2gvaUk3dTk3ZzJBTlxuNldMRC9FTHNudEp3NDJWRG16WkhRUk1Za3VObUs4K3RmRDZyT1pYLzNpc1UzOWxTYlEvMjFNOVFzRVlScWlXclxuYkxKU01vL3JzcVhrOGpmNWl2YVY3UkoxTk1jTisvR1FVMU5naCtwdnhpemZvaWgrekxxSG1jVTFuT2RReCtOaFxuaW1RelIreHMvWFZ5azY5QVE2cGlvaUFaXG4tLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tXG4iLAogICJjbGllbnRfZW1haWwiOiAiZmlyZWJhc2UtYWRtaW5zZGstZmJzdmNAc2JzLXN0YWdpbmctZW52LmlhbS5nc2VydmljZWFjY291bnQuY29tIiwKICAiY2xpZW50X2lkIjogIjExNDk3MjA1Mjg0MTA4MzQ2MDA4NiIsCiAgImF1dGhfdXJpIjogImh0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbS9vL29hdXRoMi9hdXRoIiwKICAidG9rZW5fdXJpIjogImh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwKICAiYXV0aF9wcm92aWRlcl94NTA5X2NlcnRfdXJsIjogImh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL29hdXRoMi92MS9jZXJ0cyIsCiAgImNsaWVudF94NTA5X2NlcnRfdXJsIjogImh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL3JvYm90L3YxL21ldGFkYXRhL3g1MDkvZmlyZWJhc2UtYWRtaW5zZGstZmJzdmMlNDBzYnMtc3RhZ2luZy1lbnYuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLAogICJ1bml2ZXJzZV9kb21haW4iOiAiZ29vZ2xlYXBpcy5jb20iCn0K';

function getServiceAccount(): object | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  // Try env var first, then hardcoded fallback
  const source = raw || STAGING_SA_B64;
  if (!source) return null;

  try {
    return JSON.parse(source);
  } catch {
    try {
      return JSON.parse(Buffer.from(source, 'base64').toString('utf8'));
    } catch {
      console.warn('[firebaseAdmin] Could not parse service account');
      return null;
    }
  }
}

export function getAdminApp(): App {
  if (_app) return _app;

  if (getApps().length) {
    _app = getApps()[0];
    return _app;
  }

  const sa = getServiceAccount();
  const databaseURL = process.env.NEXT_PUBLIC_DATABASE_URL || STAGING_RTDB_URL;
  if (sa) {
    _app = initializeApp({
      credential: cert(sa as Parameters<typeof cert>[0]),
      databaseURL,
    });
  } else {
    // Fall back to ADC (works in GCP environments)
    _app = initializeApp({ databaseURL });
  }
  return _app;
}

export function getAdminFirestore(): Firestore {
  if (_db) return _db;
  const app = getAdminApp();
  _db = getFirestore(app);
  return _db;
}

/**
 * Get the Realtime Database via Admin SDK. Bypasses RTDB security rules,
 * so use only from trusted server contexts (API routes, Cloud Functions).
 */
export function getAdminDatabase(): RtdbDatabase {
  if (_rtdb) return _rtdb;
  const app = getAdminApp();
  _rtdb = getDatabase(app);
  return _rtdb;
}

/**
 * Check if Firestore is configured (service account available).
 */
export function isFirestoreConfigured(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !!STAGING_SA_B64;
}
