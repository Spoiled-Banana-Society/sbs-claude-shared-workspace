import * as Sentry from '@sentry/nextjs';

const environment = process.env.NEXT_PUBLIC_ENVIRONMENT;
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
// Release tag = git SHA so each deploy is a distinct release in Sentry's
// UI. Lets us see "this error first appeared after deploy abc1234" and
// auto-link to the source map for that exact build. NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
// is exposed by Vercel automatically; falls through cleanly when absent
// (local dev).
const release = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: environment === 'staging' ? 1.0 : 0.1,
  });
}
