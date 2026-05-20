'use client';

/**
 * Global uncaught-error capture. Without this, any error that doesn't
 * hit a React error boundary — a rejected promise, a throw inside an
 * event handler, a script error — is invisible. These handlers route
 * everything uncaught through `reportClientError` so it lands in the
 * admin Logs tab + Sentry.
 *
 * For *expected* failures (a failed fetch you already catch), call
 * `reportClientError` directly with a clean `source` — that gives
 * better grouping than the catch-all sources used here.
 *
 * Install once from app/providers.tsx (AppContent).
 */

import { reportClientError } from './clientErrors';

// Idempotency — AppContent effects can re-run; only register once.
let installed = false;

// Flood guard. `reportClientError` already throttles 1/min per source,
// but both handlers collapse to just 2 sources, so a tight error loop
// throwing distinct messages could still slip many through. Hard-cap
// total global captures per page load, and dedupe by message so the
// first *distinct* error in a burst still gets through.
const MAX_CAPTURES = 20;
let captureCount = 0;
const seenMessages = new Set<string>();

function shouldCapture(message: string): boolean {
  if (captureCount >= MAX_CAPTURES) return false;
  if (seenMessages.has(message)) return false;
  seenMessages.add(message);
  captureCount += 1;
  return true;
}

function stringifyReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message || 'Unhandled rejection', stack: reason.stack };
  }
  if (typeof reason === 'string') return { message: reason };
  try {
    return { message: JSON.stringify(reason) ?? 'Unhandled rejection' };
  } catch {
    return { message: String(reason) };
  }
}

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Uncaught synchronous/async errors that bubble to window.
  window.addEventListener('error', (event: ErrorEvent) => {
    try {
      // Resource-load errors (img/script 404s) also fire 'error' but
      // have no `message` — skip those, they're noise.
      if (!event.message) return;
      if (!shouldCapture(event.message)) return;
      reportClientError({
        source: 'global.uncaught.error',
        message: event.message,
        route: window.location?.pathname,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    } catch {
      /* swallow — logging must never break the app */
    }
  });

  // Promise rejections with no .catch().
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      const { message, stack } = stringifyReason(event.reason);
      if (!shouldCapture(message)) return;
      reportClientError({
        source: 'global.unhandled.rejection',
        message,
        route: window.location?.pathname,
        stack,
      });
    } catch {
      /* swallow */
    }
  });
}
