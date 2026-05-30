import * as Sentry from '@sentry/nextjs';

const environment = process.env.NEXT_PUBLIC_ENVIRONMENT;
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    // Drop PERFORMANCE traces for the internal /admin dashboard (return 0).
    // It fires many panel-fetches on load, which Sentry flags as a recurring
    // "N+1 API Call" — harmless noise on an admin-only page. This affects
    // performance tracing only; error events are unaffected, so /admin errors
    // are still captured.
    tracesSampler: (ctx) => {
      const name = typeof ctx?.name === 'string' ? ctx.name : '';
      const path = typeof ctx?.location?.pathname === 'string' ? ctx.location.pathname : '';
      if (name.includes('/admin') || path.includes('/admin')) return 0;
      return environment === 'staging' ? 1.0 : 0.1;
    },
  });
}
