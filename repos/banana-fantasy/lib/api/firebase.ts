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
  goOnline,
  goOffline,
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
 * Force the Realtime Database websocket to reconnect. iOS installed PWAs
 * suspend the websocket when backgrounded and don't always auto-revive it on
 * foreground — so live events stop arriving (they pile up and dump ~minutes
 * later). Calling goOffline→goOnline on foreground kicks a fresh connection so
 * real-time resumes immediately. No-op if Firebase isn't configured.
 */
export function wakeRealtime(): void {
  const db = getFirebaseDatabase();
  if (!db) return;
  try {
    goOffline(db);
    goOnline(db);
  } catch { /* ignore */ }
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
 * Subscribe to the draft TYPE (pro|hof|jackpot) the Go API stamps onto
 * /drafts/{draftId}/realTimeDraftInfo/type at fill. This is the SAME node the
 * draft room reads, so a direct onValue subscription here gives the My Drafts
 * list instant (push) type updates — identical to the room and across devices,
 * no 3s poll. The server may write the human strings or the short codes; both
 * are normalized. Unrecognized/absent values invoke nothing (caller keeps its
 * current type). The realTimeDraftInfo `.read` rule cascades to this child.
 */
export function subscribeDraftType(draftId: string, cb: (type: 'pro' | 'hof' | 'jackpot' | 'jackhof') => void): Unsubscribe {
  return subscribeValue<unknown>(`/drafts/${draftId}/realTimeDraftInfo/type`, (v) => {
    if (typeof v !== 'string') return;
    const s = v.trim().toLowerCase();
    // 'jackhof' first: it contains neither 'jackpot' nor 'hof' exactly, but be
    // defensive about future server spellings of the dual type.
    if (s === 'jackhof' || s === 'jackpot+hof' || s === 'jack-hof') cb('jackhof');
    else if (s === 'jackpot') cb('jackpot');
    else if (s === 'hof' || s === 'hall of fame') cb('hof');
    else if (s === 'pro') cb('pro');
  });
}

/** The fast-changing live fields the My Drafts list needs per drafting row. */
export interface DraftRealTimeInfoLite {
  currentDrafter?: string;
  pickNumber?: number;
  roundNum?: number;
  pickEndTime?: number;
  isDraftComplete?: boolean;
  // Set at fill. Used to reject a STALE reused-id node (staging reuses draft
  // ids): only trust this snapshot if its draftStartTime matches the draft's
  // known start, so a previous draft's leftover state can't drive the row.
  draftStartTime?: number;
}

/**
 * Subscribe to the whole /drafts/{draftId}/realTimeDraftInfo node — the SAME
 * node the draft room reads — so the My Drafts list gets instant (push) pick
 * progress: current pick number, whose turn it is, the pick countdown, and
 * completion. This is what makes the list's "we're on pick X / your turn"
 * update in lockstep with the room and across devices instead of on a 3s poll.
 * The node only exists once the draft has started (10/10), so it stays null
 * during filling — callers treat null as "no live pick state yet".
 */
export function subscribeRealTimeDraftInfo(
  draftId: string,
  cb: (info: DraftRealTimeInfoLite | null) => void,
): Unsubscribe {
  return subscribeValue<DraftRealTimeInfoLite>(`/drafts/${draftId}/realTimeDraftInfo`, (v) => {
    cb(v && typeof v === 'object' ? v : null);
  });
}

/**
 * The single live draft-activity summary the Go aggregator publishes to
 * /stats/liveDraftActivity every ~10s. One value, read by every surface (lobby,
 * draft room, and the fill-alert feed) so they can never disagree:
 *   count     — FAST drafts currently in progress (slow drafts excluded)
 *   round     — furthest-along round among them (the one about to wrap)
 *   updatedAt — unix ms of the last write (present for debugging; the client
 *               uses its own receipt time for fail-closed staleness, not this,
 *               to avoid server/client clock skew).
 */
export interface LiveDraftActivity {
  count: number;
  round: number;
  updatedAt: number;
}

/**
 * Subscribe to the live draft-activity summary node. Coerces to numbers and
 * passes null when the node is missing/malformed so callers can hide the line.
 * This is ONE tiny node (not the whole /drafts subtree), so it's a cheap
 * always-on subscription safe for high-traffic pages (lobby, draft room).
 */
export function subscribeLiveDraftActivity(
  cb: (value: LiveDraftActivity | null) => void,
): Unsubscribe {
  return subscribeValue<Record<string, unknown>>('/stats/liveDraftActivity', (v) => {
    if (!v || typeof v !== 'object') {
      cb(null);
      return;
    }
    cb({
      count: Number(v.count) || 0,
      round: Number(v.round) || 0,
      updatedAt: Number(v.updatedAt) || 0,
    });
  });
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
    | 'promo-first-purchase'
    | 'first-purchase-unlocked'
    | 'referral-milestone'
    | 'promo-card-free-draft'
    // Content-less refetch ping for the server-backed notification bell.
    | 'notification';
  timestamp: number;
  draftId?: string;
  badgeId?: string;
  milestone?: 'verified' | 'bought1' | 'bought10';
  source?: string;
  awardedCount?: number;
  // For 'notification' pings — the bell entry, for instant render (no refetch).
  notifId?: string;
  notifType?: string;
  notifTitle?: string;
  notifMessage?: string;
  notifLink?: string;
  notifIcon?: string;
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
/**
 * Subscribe to the global-chat broadcast ping — a single shared RTDB node the
 * server bumps on every #general message. One write, every open chat hears
 * it instantly. Returns no-op if Firebase isn't configured.
 */
/**
 * Shared presence map — ONE RTDB listener no matter how many avatars render
 * dots. `presence/{wallet}` holds a server-stamped lastSeen (ms); online =
 * within the last 90s. Subscribers get the full map on every change.
 */
type PresenceMap = Record<string, number>;
let presenceMap: PresenceMap = {};
let presenceUnsub: Unsubscribe | null = null;
const presenceSubs = new Set<(m: PresenceMap) => void>();

export function subscribePresenceMap(cb: (m: PresenceMap) => void): () => void {
  presenceSubs.add(cb);
  cb(presenceMap);
  if (!presenceUnsub) {
    const db = getFirebaseDatabase();
    if (db) {
      presenceUnsub = onValue(ref(db, '/presence'), (snap) => {
        presenceMap = (snap.val() as PresenceMap | null) ?? {};
        presenceSubs.forEach((fn) => fn(presenceMap));
      }, () => { /* read rule missing — dots simply don't render */ });
    }
  }
  return () => {
    presenceSubs.delete(cb);
    if (presenceSubs.size === 0 && presenceUnsub) {
      try { presenceUnsub(); } catch { /* ignore */ }
      presenceUnsub = null;
    }
  };
}

export const PRESENCE_ONLINE_WINDOW_MS = 90_000;

export function subscribeGlobalChatPing(cb: () => void): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) return () => {};
  const r = ref(db, '/globalChatPing');
  const unsub = onValue(r, () => cb(), () => { /* permission/network — poll covers it */ });
  return unsub;
}

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
  // CRITICAL: constrain to the most recent events. `/userEvents/{wallet}` is
  // an append-only log that's never trimmed, so a plain onChildAdded would
  // replay the ENTIRE history on every load — on an active wallet that backlog
  // (bandwidth + per-child processing) delays delivery of NEW events by
  // seconds, which is exactly the cross-device lag we were chasing. limitToLast
  // gives a tiny initial window + every new event instantly. The caller's
  // freshness gate (timestamp window) drops any old ones in that small window.
  const q = query(r, limitToLast(15));
  const unsub = onChildAdded(
    q,
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
