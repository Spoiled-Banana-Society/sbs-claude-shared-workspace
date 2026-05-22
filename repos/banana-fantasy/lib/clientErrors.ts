// Client-side error reporting helper. Fire-and-forget — never throws,
// never blocks the calling code. The /api/client-errors endpoint
// writes to v2_error_events (admin Server Errors tab + notification
// badge) and forwards to Sentry for grouping + root-cause analysis.
//
// Usage:
//   reportClientError({
//     source: 'ws.auth_failed',
//     message: 'WS connection returned 401',
//     route: 'draft-room',
//     context: { draftId, walletAddress, attempt: 3 },
//   });

import { getClientLogSessionId, getClientLogWallet } from './clientLog';

interface ClientErrorPayload {
  source: string;            // dot-separated id, e.g. 'ws.auth_failed'
  message: string;           // human-readable summary
  route?: string;            // page or hook name where it fired
  context?: Record<string, unknown>;
  stack?: string;
  actor?: string;            // wallet or user id when available
  sessionId?: string;        // debug session — auto-filled if omitted
}

// Per-source throttle. Don't spam the admin error log if the same
// failure repeats (e.g. WS retries every 30s). Re-fire at most once
// per minute per source.
const lastFiredAt = new Map<string, number>();
const THROTTLE_MS = 60_000;

export function reportClientError(payload: ClientErrorPayload): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const last = lastFiredAt.get(payload.source) ?? 0;
  if (now - last < THROTTLE_MS) return;
  lastFiredAt.set(payload.source, now);

  // Auto-attach the debug session id (links to the breadcrumb trace)
  // and the logged-in wallet as `actor` (so every error shows which
  // user hit it, with no per-call-site work). Caller-provided values
  // win when present.
  const body = {
    ...payload,
    sessionId: payload.sessionId ?? getClientLogSessionId(),
    actor: payload.actor ?? (getClientLogWallet() || undefined),
  };

  // Fire-and-forget POST. We intentionally don't await — the caller
  // shouldn't ever know or care if this fails.
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* swallow — logging must never break the app */
    });
  } catch {
    /* swallow */
  }

  // Also forward to Sentry directly if loaded. Sentry's SDK groups
  // similar errors so 99 instances of "WS 401" show as 1 issue with
  // count=99, which is what we want in the admin Sentry tab.
  try {
    const w = window as Window & {
      Sentry?: {
        captureMessage?: (msg: string, opts?: unknown) => void;
        withScope?: (cb: (scope: unknown) => void) => void;
      };
    };
    if (w.Sentry?.captureMessage) {
      w.Sentry.captureMessage(`${payload.source}: ${payload.message}`, {
        level: 'error',
        tags: {
          source: payload.source,
          route: payload.route ?? 'unknown',
        },
        extra: payload.context,
      });
    }
  } catch {
    /* swallow */
  }
}
