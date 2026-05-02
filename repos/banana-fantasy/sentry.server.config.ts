import * as Sentry from '@sentry/nextjs';

const environment = process.env.NEXT_PUBLIC_ENVIRONMENT;
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
// VERCEL_GIT_COMMIT_SHA (no NEXT_PUBLIC_ prefix) is exposed server-side
// by Vercel for the running deployment. Tags every server-side event
// with the exact commit it ran on.
const release =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: environment === 'staging' ? 1.0 : 0.1,
  });
}
