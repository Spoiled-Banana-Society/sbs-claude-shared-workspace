import * as Sentry from '@sentry/nextjs';

const environment = process.env.NEXT_PUBLIC_ENVIRONMENT;
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === 'staging' ? 1.0 : 0.1,
  });
}
