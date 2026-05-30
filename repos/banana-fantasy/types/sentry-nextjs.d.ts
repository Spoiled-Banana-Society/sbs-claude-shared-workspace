declare module '@sentry/nextjs' {
  export interface BrowserOptions {
    dsn?: string;
    environment?: string;
    tracesSampleRate?: number;
    // Per-transaction sample rate. Used to drop performance traces for
    // specific routes (e.g. /admin) so they stop generating N+1 noise.
    tracesSampler?: (samplingContext: {
      name?: string;
      location?: { pathname?: string };
      attributes?: Record<string, unknown>;
    }) => number;
  }

  export interface CaptureContext {
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
    user?: Record<string, unknown>;
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  }

  export interface SentryUser {
    id?: string;
    username?: string;
    email?: string;
    ip_address?: string;
  }

  export function init(options: BrowserOptions): void;
  export function captureException(exception: unknown, context?: CaptureContext): string;
  export function captureMessage(message: string, context?: CaptureContext): string;
  export function setUser(user: SentryUser | null): void;
}
