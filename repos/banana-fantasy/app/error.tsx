'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { logger } from '@/lib/logger';
import { reportClientError } from '@/lib/clientErrors';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  logger.error('[Error Boundary]', error);
  useEffect(() => {
    try {
      Sentry.captureException(error);
    } catch {}
    // Surface the boundary error in the admin Logs tab — client-side
    // logger.error does not write to Firestore, only reportClientError does.
    reportClientError({
      source: 'global.react.boundary',
      message: error.message || 'React error boundary triggered',
      route: typeof window !== 'undefined' ? window.location?.pathname : undefined,
      stack: error.stack,
      context: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="text-center space-y-4 p-8">
        <div className="text-4xl">🍌</div>
        <h2 className="text-xl font-bold text-white">Something went wrong</h2>
        <p className="text-white/50 text-sm max-w-md">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2 bg-banana text-black font-semibold rounded-lg hover:bg-banana/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
