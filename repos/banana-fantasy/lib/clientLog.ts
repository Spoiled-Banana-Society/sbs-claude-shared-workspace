'use client';

/**
 * Fire-and-forget client → server log pipe. Buffers events, flushes
 * every 1.5s via fetch (or sendBeacon on unload). The server endpoint
 * writes them to Firestore `v2_debug_events` so we can read them via
 * `scripts/inspect-debug-logs.mjs` without asking the user to open
 * devtools.
 *
 * Volume control: only call for meaningful state transitions, NOT
 * every React render. Hard cap of 50 events per flush.
 *
 * ⚠️ The console mirror is OPT-IN — see `consoleMirrorOn()` below.
 * It used to be unconditional, and that leaked the tab to death:
 * `console.info(tag, event, payload)` makes the browser retain the
 * message AND a live reference to `payload` for the lifetime of the
 * tab, so none of it can ever be garbage collected. BUFFER is capped;
 * the console is not. A lobby with 16 drafts logs ~46 payloads/min,
 * which walked Chrome into an out-of-memory renderer kill ("Aw, Snap!",
 * Error code 5) every ~10 minutes for our heaviest user (Banana69,
 * 2026-08-01). Turn it on per-device when you actually need devtools:
 *   localStorage.setItem('sbs-debug-console', '1')
 */

interface LogEvent {
  tag: string;
  event: string;
  payload?: unknown;
  ts: number;
  path?: string;
}

const BUFFER: LogEvent[] = [];
const FLUSH_INTERVAL_MS = 1500;
const MAX_BUFFER = 50;

let sessionId = '';
let wallet = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Is the console mirror switched on for this device? Read once and
 * cached — this is checked on every clientLog call, and a localStorage
 * hit per call would be its own (smaller) performance problem.
 */
let consoleMirror: boolean | null = null;
function consoleMirrorOn(): boolean {
  if (consoleMirror !== null) return consoleMirror;
  if (typeof window === 'undefined') return false;
  try {
    consoleMirror = window.localStorage.getItem('sbs-debug-console') === '1';
  } catch {
    consoleMirror = false; // private mode
  }
  return consoleMirror;
}

function getSessionId(): string {
  if (sessionId) return sessionId;
  if (typeof window === 'undefined') return '';
  try {
    let sid = sessionStorage.getItem('sbs-debug-session-id');
    if (!sid) {
      sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('sbs-debug-session-id', sid);
    }
    sessionId = sid;
    return sid;
  } catch {
    return '';
  }
}

export function setClientLogWallet(w: string | undefined | null) {
  wallet = (w ?? '').toLowerCase();
}

/**
 * Short device label for diagnostics so logs can distinguish mobile vs desktop
 * and installed-PWA vs browser-tab (e.g. "mob-pwa", "mob", "desk").
 */
export function deviceTag(): string {
  if (typeof navigator === 'undefined') return 'ssr';
  const ua = navigator.userAgent || '';
  const isMobile = /iphone|ipad|ipod|android/i.test(ua);
  let standalone = false;
  try {
    standalone = (typeof window !== 'undefined')
      && (window.matchMedia?.('(display-mode: standalone)').matches
        || (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
  } catch { /* ignore */ }
  return `${isMobile ? 'mob' : 'desk'}${standalone ? '-pwa' : ''}`;
}

/**
 * The current debug session id — shared with reportClientError so an
 * error in v2_error_events can be tied back to this session's full
 * breadcrumb trace in v2_debug_events. Returns '' server-side.
 */
export function getClientLogSessionId(): string {
  return getSessionId();
}

/**
 * The current logged-in wallet (lowercased), '' if not logged in.
 * reportClientError auto-attaches this as `actor` so every client-side
 * error is attributed to a user with no per-call-site work.
 */
export function getClientLogWallet(): string {
  return wallet;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush() {
  if (BUFFER.length === 0 || typeof window === 'undefined') return;
  const events = BUFFER.splice(0, BUFFER.length);
  const body = JSON.stringify({
    events,
    sessionId: getSessionId(),
    wallet,
  });
  try {
    await fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // best-effort — drop on failure
  }
}

export function clientLog(tag: string, event: string, payload?: unknown) {
  if (typeof window === 'undefined') return;
  const entry: LogEvent = {
    tag,
    event,
    payload,
    ts: Date.now(),
    path: window.location?.pathname,
  };
  BUFFER.push(entry);
  // Mirror to console ONLY when explicitly enabled — the console holds
  // `payload` alive forever, so this is a memory leak by default.
  if (consoleMirrorOn()) console.info(`[${tag}] ${event}`, payload ?? '');
  // Trim oldest if buffer overflows between flushes.
  if (BUFFER.length > MAX_BUFFER) BUFFER.splice(0, BUFFER.length - MAX_BUFFER);
  scheduleFlush();
}

// Flush on page hide / unload so events don't get lost when the user
// navigates away mid-buffer. sendBeacon is best-effort and survives
// the navigation; fetch with keepalive is the modern fallback.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (BUFFER.length === 0) return;
    const events = BUFFER.splice(0, BUFFER.length);
    const body = JSON.stringify({ events, sessionId: getSessionId(), wallet });
    try {
      if ('sendBeacon' in navigator) {
        navigator.sendBeacon('/api/debug/log', new Blob([body], { type: 'application/json' }));
      }
    } catch {
      // ignore
    }
  });
}
