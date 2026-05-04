declare module '@sentry/nextjs' {
  export interface BrowserOptions {
    dsn?: string;
    environment?: string;
    tracesSampleRate?: number;
  }

  export interface CaptureContext {
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
    user?: Record<string, unknown>;
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  }

  export function init(options: BrowserOptions): void;
  export function captureException(exception: unknown, context?: CaptureContext): string;
  export function captureMessage(message: string, context?: CaptureContext): string;
}
