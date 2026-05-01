/**
 * Firebase Admin SDK singleton for server-side Firestore + RTDB access.
 *
 * Required env vars:
 *   FIREBASE_SERVICE_ACCOUNT_JSON — service-account JSON (raw or base64)
 *   NEXT_PUBLIC_DATABASE_URL      — RTDB URL (or staging fallback when on staging)
 *
 * Previous version embedded a base64-encoded staging service-account key as a
 * "Vercel runtime fallback." That is itself a leaked credential (a Google
 * private key sitting in plaintext in git) — same risk class as the
 * triggers SA Codex flagged in pass 1. Removed. Boris should rotate the
 * `firebase-adminsdk-fbsvc@sbs-staging-env` SA whose key was previously
 * inlined here.
 *
 * Behavior now:
 *   - env var set → use it
 *   - env var unset, staging → log + fall back to ADC (Cloud Run service
 *     account) so staging keeps working without secrets in git
 *   - env var unset, prod → throw at call time
 */

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getDatabase, type Database as RtdbDatabase } from 'firebase-admin/database';

import { isStagingEnv, rtdbUrl } from '@/lib/appConfig';

let _app: App | null = null;
let _db: Firestore | null = null;
let _rtdb: RtdbDatabase | null = null;

function getServiceAccount(): object | null {
  const source = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!source) return null;

  try {
    return JSON.parse(source);
  } catch {
    try {
      return JSON.parse(Buffer.from(source, 'base64').toString('utf8'));
    } catch {
      console.warn('[firebaseAdmin] Could not parse FIREBASE_SERVICE_ACCOUNT_JSON');
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
  const databaseURL = rtdbUrl();

  if (sa) {
    _app = initializeApp({
      credential: cert(sa as Parameters<typeof cert>[0]),
      databaseURL,
    });
  } else if (isStagingEnv()) {
    // Staging: rely on ADC (Cloud Run / Vercel both support it via the
    // service account attached to the deploy). Avoids inlining a private
    // key in git.
    console.warn('[firebaseAdmin] No FIREBASE_SERVICE_ACCOUNT_JSON set; using ADC');
    _app = initializeApp({ databaseURL });
  } else {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required outside of staging');
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
 * Check if Firestore is configured. Honest answer: do we have either an
 * explicit service-account env or a staging environment that can fall
 * back to ADC?
 */
export function isFirestoreConfigured(): boolean {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) return true;
  return isStagingEnv();
}
