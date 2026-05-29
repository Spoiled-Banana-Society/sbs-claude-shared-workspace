/**
 * Firebase client helpers (Realtime Database).
 *
 * SBS uses Firebase Realtime Database for lightweight real-time signals like
 * number of players currently joined in a draft.
 */

import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getDatabase,
  onValue,
  onChildAdded,
  ref,
  push,
  serverTimestamp,
  query,
  limitToLast,
  type Database,
  type Unsubscribe,
  off,
} from 'firebase/database';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

function getFirebaseConfigFromEnv(): FirebaseConfig | null {
  const cfg: FirebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_AUTH_DOMAIN || '',
    databaseURL: process.env.NEXT_PUBLIC_DATABASE_URL || '',
    projectId: process.env.NEXT_PUBLIC_PROJECT_ID || '',
    storageBucket: process.env.NEXT_PUBLIC_STORAGE_BUCKET || '',
    messagingSenderId: process.env.NEXT_PUBLIC_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_APP_ID || '',
    measurementId: process.env.NEXT_PUBLIC_MEASUREMENT_ID || undefined,
  };

  if (!cfg.apiKey || !cfg.databaseURL || !cfg.projectId) {
    // Return null instead of throwing — callers must handle gracefully.
    // This prevents the error boundary from crashing the entire draft room
    // when Firebase env vars are missing.
    console.warn(
      '[firebase] Missing Firebase env vars (NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_DATABASE_URL, NEXT_PUBLIC_PROJECT_ID). Firebase RTDB disabled.',
    );
    return null;
  }

  return cfg;
}

let _app: FirebaseApp | null = null;
let _db: Database | null = null;
let _disabled = false;

/**
 * Whether Firebase RTDB is available (env vars configured).
 */
export function isFirebaseAvailable(): boolean {
  if (_disabled) return false;
  if (_app) return true;
  // Check without initializing — just see if config is valid
  const cfg = getFirebaseConfigFromEnv();
  if (!cfg) {
    _disabled = true;
    return false;
  }
  return true;
}

/**
 * Get (or init) the Firebase app. Returns null if Firebase is not configured.
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (_disabled) return null;
  if (_app) return _app;

  if (getApps().length) {
    _app = getApp();
    return _app;
  }

  const cfg = getFirebaseConfigFromEnv();
  if (!cfg) {
    _disabled = true;
    return null;
  }
  _app = initializeApp(cfg);
  return _app;
}

/**
 * Get (or init) the Firebase Realtime Database. Returns null if Firebase is not configured.
 */
export function getFirebaseDatabase(): Database | null {
  if (_db) return _db;
  const app = getFirebaseApp();
  if (!app) return null;
  _db = getDatabase(app);
  return _db;
}

/**
 * Subscribe to a Firebase path.
 *
 * @param path - Firebase RTDB path to subscribe to
 * @param cb - Callback invoked with the value (or null if path doesn't exist)
 * @param onError - Optional error callback (e.g., permission_denied)
 * @returns an unsubscribe function (no-op if Firebase is not configured).
 */
export function subscribeValue<T = unknown>(
  path: string,
  cb: (value: T | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) {
    console.warn('[firebase] subscribeValue skipped — Firebase not configured');
    return () => {}; // no-op unsubscribe
  }
  const r = ref(db, path);

  const unsub = onValue(
    r,
    (snapshot) => {
      cb(snapshot.exists() ? (snapshot.val() as T) : null);
    },
    (error) => {
      console.error('[firebase] subscribeValue error', error);
      if (onError) onError(error);
    },
  );

  return () => {
    off(r);
    unsub();
  };
}

/**
 * Subscribe to number of players joined in a draft.
 *
 * Firebase path (per API_INTEGRATION.md):
 *   /drafts/{draftId}/numPlayers
 */
export function subscribeDraftNumPlayers(draftId: string, cb: (numPlayers: number) => void): Unsubscribe {
  return subscribeValue<number>(`/drafts/${draftId}/numPlayers`, (v) => cb(Number(v || 0)));
}

/**
 * Subscribe to the shared randomize-bar anchor (epoch ms) the Go API writes at
 * fill-time. Lets every client run the "randomizing" bar on the same clock so
 * the bar + reveal line up across windows.
 *
 * Firebase path: /drafts/{draftId}/randomizeStartAt
 * (needs a matching `.read` rule in staging-rtdb.rules.json or reads return null.)
 */
export function subscribeDraftRandomizeStartAt(draftId: string, cb: (startAtMs: number) => void): Unsubscribe {
  return subscribeValue<number>(`/drafts/${draftId}/randomizeStartAt`, (v) => cb(Number(v || 0)));
}

/**
 * Subscribe to the league display name (e.g. "BBB #811") for a draft.
 *
 * Firebase path:
 *   /drafts/{draftId}/displayName
 *
 * Go API writes this at the moment of fill (CreateLeagueDraftStateUponFilling),
 * so the row label updates within ~100ms of the slot filling instead of
 * relying on a REST retry loop.
 */
export function subscribeDraftDisplayName(draftId: string, cb: (displayName: string) => void): Unsubscribe {
  // Lazy-import to keep this file SSR-safe (clientLog is 'use client').
  const log = (event: string, payload?: unknown) => {
    void import('@/lib/clientLog').then(m => m.clientLog('league#', event, payload)).catch(() => {});
  };
  log('rtdb.subscribe', { draftId, path: `/drafts/${draftId}/displayName` });
  const unsub = subscribeValue<string>(`/drafts/${draftId}/displayName`, (v) => {
    log('rtdb.event', { draftId, value: v, type: typeof v });
    if (typeof v === 'string' && v.length > 0) cb(v);
  });
  return () => {
    log('rtdb.unsubscribe', { draftId });
    unsub();
  };
}

// ─────────── User event stream (real-time toast + notification) ───────────

/**
 * Shape of an event on the user's real-time stream. Mirrors
 * `StreamEventType` + `StreamEventPayload` in lib/userEventStream.ts
 * (kept duplicated here so the frontend doesn't import server-only code).
 */
export interface UserStreamEvent {
  /** Auto-generated by Firebase push() — used for client-side dedup. */
  eventId: string;
  type:
    | 'badge-unlock'
    | 'promo-pick-10'
    | 'promo-jackpot-hit'
    | 'promo-buy-10'
    | 'promo-daily-drafts'
    | 'promo-new-user'
    | 'referral-milestone';
  timestamp: number;
  draftId?: string;
  badgeId?: string;
  milestone?: 'verified' | 'bought1' | 'bought10';
  source?: string;
  awardedCount?: number;
}

/**
 * Subscribe to a user's real-time event stream.
 *
 * Firebase path: `/userEvents/{userId}/{auto-id}`.
 *
 * IMPORTANT — initial-load behavior: `onChildAdded` fires once for every
 * existing child at subscribe time, then again for each new child. To
 * avoid spamming the user with old events on every page-load, the caller
 * MUST dedup via a localStorage "seen event ids" set (the
 * useBadgeUnlockNotifier `notified` set is the pattern). Each event
 * carries a stable `eventId` for this purpose.
 *
 * Returns no-op if Firebase isn't configured.
 */
export function subscribeUserEvents(
  userId: string,
  cb: (event: UserStreamEvent) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) {
    console.warn('[firebase] subscribeUserEvents skipped — Firebase not configured');
    return () => {};
  }
  if (!userId) {
    console.warn('[firebase] subscribeUserEvents skipped — empty userId');
    return () => {};
  }

  const r = ref(db, `/userEvents/${userId.toLowerCase()}`);
  const unsub = onChildAdded(
    r,
    (snapshot) => {
      const val = snapshot.val();
      if (!val || typeof val !== 'object') return;
      cb({
        eventId: snapshot.key ?? `${val.type}-${val.timestamp ?? Date.now()}`,
        ...(val as Omit<UserStreamEvent, 'eventId'>),
      });
    },
    (error) => {
      console.error('[firebase] subscribeUserEvents error', error);
    },
  );

  return () => {
    off(r, 'child_added');
    unsub();
  };
}

// ─────────── Draft Room Chat ───────────

export interface ChatMessageRecord {
  walletAddress: string;
  username: string;
  text: string;
  timestamp: number;
}

const CHAT_HISTORY_LIMIT = 200;

/**
 * Subscribe to the chat for a draft. Messages stream in oldest→newest, capped
 * at the most recent CHAT_HISTORY_LIMIT entries.
 *
 * Firebase path: /drafts/{draftId}/chat/{pushId}
 */
export function subscribeChatMessages(
  draftId: string,
  cb: (messages: Array<ChatMessageRecord & { id: string }>) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) {
    console.warn('[firebase] subscribeChatMessages skipped — Firebase not configured');
    return () => {};
  }
  const r = ref(db, `/drafts/${draftId}/chat`);
  const q = query(r, limitToLast(CHAT_HISTORY_LIMIT));

  const unsub = onValue(
    q,
    (snapshot) => {
      const out: Array<ChatMessageRecord & { id: string }> = [];
      snapshot.forEach((child) => {
        const v = child.val() as Partial<ChatMessageRecord> | null;
        if (v && typeof v.text === 'string' && typeof v.walletAddress === 'string') {
          out.push({
            id: child.key || `${v.timestamp ?? Date.now()}`,
            walletAddress: v.walletAddress,
            username: typeof v.username === 'string' ? v.username : v.walletAddress,
            text: v.text,
            timestamp: typeof v.timestamp === 'number' ? v.timestamp : Date.now(),
          });
        }
      });
      // RTDB returns in key order which is chronological for `push()` keys.
      cb(out);
    },
    (error) => {
      console.error('[firebase] subscribeChatMessages error', error);
      if (onError) onError(error);
    },
  );

  return () => {
    off(r);
    unsub();
  };
}

/**
 * Append a chat message to the draft's chat log. Uses `push()` so the key is a
 * server-ordered chronological ID (no client clock skew issues). `timestamp`
 * is set via `serverTimestamp()` for the same reason.
 */
export async function pushChatMessage(
  draftId: string,
  msg: { walletAddress: string; username: string; text: string },
): Promise<void> {
  const db = getFirebaseDatabase();
  if (!db) {
    console.warn('[firebase] pushChatMessage skipped — Firebase not configured');
    return;
  }
  const trimmed = msg.text.trim();
  if (!trimmed || !msg.walletAddress || !draftId) return;
  const r = ref(db, `/drafts/${draftId}/chat`);
  await push(r, {
    walletAddress: msg.walletAddress.toLowerCase(),
    username: msg.username || msg.walletAddress,
    text: trimmed.slice(0, 500),
    timestamp: serverTimestamp(),
  });
}
