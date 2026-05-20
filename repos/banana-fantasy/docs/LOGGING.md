# Logging & Error Tracking

How Banana Fantasy catches, stores, and surfaces errors. Read this
before adding logging to a new page or debugging a reported bug.

## 👋 Developer — start here

This one document is the whole logging system. There are **three pieces**,
and they work together:

1. **This doc** — the manual. Read it once; you'll understand everything.
2. **`scripts/logs.mjs`** — the CLI. Run it to read live logs yourself
   (`node scripts/logs.mjs errors`). Auto-connects to staging, no setup.
3. **Export files** — when a specific bug needs fixing, you'll be handed
   a `sbs-error-<session>.json` file: it contains the error *and* the
   user's full session trace. Open it, everything's there — no account,
   no keys, no access to anything needed.

**Your workflow:** read this doc once → for a handed-over bug, open the
export file → to investigate live, use the CLI. You do **not** need the
admin panel. Jump to the section you need below.

## TL;DR

- **An error happened — where do I look?** Admin → **Logs** tab. One feed
  for everything. Filter by area (Draft / Payment / Promo / …).
- **I need the logs on the CLI.** `node scripts/logs.mjs errors --area=draft`
- **A dev needs the logs.** Open the error in the Logs tab → **Export trace** →
  hand them the JSON file. No keys or setup needed on their end.

## The two pipes

There are two separate logging streams. Use the right one.

| | Errors | Breadcrumbs |
|---|---|---|
| Call | `reportClientError(...)` / `logger.error(...)` | `clientLog(tag, event, payload)` |
| Stored in | Firestore `v2_error_events` | Firestore `v2_debug_events` |
| Retention | persistent | 24h TTL |
| Surfaces in | admin Logs tab + Sentry + badge | CLI only (`logs.mjs`) |
| Use for | something failed | tracing what led to a failure |

**Errors** are failures worth an admin's attention. **Breadcrumbs** are
the trail — state transitions, "user clicked X", "WS connected" — that
explain *how* the error happened. An error stores the `sessionId`, so
its breadcrumb trail can always be pulled back up.

## Where the code lives

| File | Role |
|------|------|
| `lib/logger.ts` | Structured logger. Server-side `.error()` auto-writes to `v2_error_events` + Sentry. |
| `lib/clientErrors.ts` | `reportClientError(...)` — client runtime errors. Throttled 1/min per source. Auto-attaches `sessionId`. |
| `lib/clientLog.ts` | `clientLog(...)` — debug breadcrumb pipe. Owns the `sessionId`. |
| `lib/errorEvents.ts` | The Firestore writer/reader for `v2_error_events`. |
| `lib/logSources.ts` | The source-name registry — `LOG_SOURCES`, `LOG_AREAS`, `logAreaForSource()`. |
| `lib/globalErrorHandlers.ts` | `window.onerror` + `unhandledrejection` capture. Installed in `app/providers.tsx`. |
| `app/api/client-errors/route.ts` | Ingests `reportClientError` POSTs. |
| `app/api/debug/log/route.ts` | Ingests `clientLog` batches. |
| `app/api/admin/error-export/route.ts` | Builds the downloadable error+trace JSON. |
| `components/admin/LogsTab.tsx` | The unified admin Logs view. |
| `scripts/logs.mjs` | CLI log reader. |

Errors also reach **Sentry** (auto-grouped/deduped) — visible from the
"Sentry issues" toggle inside the Logs tab. You rarely need it; the
error feed is the primary view.

## The naming convention

Every error `source` follows `area.feature.outcome`, lowercase,
dot-separated — e.g. `draft.join_failed`, `payment.usdc.permit_failed`.

The first segment is the **area** (`draft`, `payment`, `promo`,
`marketplace`, `wheel`, `auth`, …) — that's what the admin filter pills
and the CLI `--area=` flag key off, via `logAreaForSource()`.

Canonical sources live in `LOG_SOURCES` in `lib/logSources.ts`. **When
you add a new logging call, add its source there too** — that keeps the
admin filter and CLI consistent.

Sources matching `IMPORTANT_ERROR_PATTERNS` in
`app/api/admin/notification-counts/route.ts` also raise the admin badge.
User-money / draft-blocking failures should match a pattern there.

## Adding logging to a new page

In every `catch` / `.catch()` at an async boundary that can fail:

```ts
import { reportClientError } from '@/lib/clientErrors';
import { clientLog } from '@/lib/clientLog';
import { LOG_SOURCES } from '@/lib/logSources';

// Breadcrumb the happy path (meaningful transitions only — not renders):
clientLog('checkout#', 'submit_started', { amount, wallet });

try {
  await doTheThing();
} catch (err) {
  reportClientError({
    source: LOG_SOURCES.payment.USDC_PERMIT_FAILED, // add the constant if new
    message: err instanceof Error ? err.message : String(err),
    route: 'buy-drafts',
    context: { amount, wallet },           // small, relevant ids
    stack: err instanceof Error ? err.stack : undefined,
  });
}
```

Server side (API routes), just use the logger — it fans out for you:

```ts
logger.error(LOG_SOURCES.payment.MINT_FAILED, { err, requestId, context });
```

Rules of thumb:
- Use `reportClientError` for *expected* failures you want a clean
  `source` on. Genuinely uncaught errors are already caught globally by
  `installGlobalErrorHandlers` (`global.uncaught.*`).
- Breadcrumb with `clientLog`, not `reportClientError` — the latter is
  throttled 1/min per source and will hide a burst.
- Logging must never throw or change behavior. All helpers are
  fire-and-forget by design.

## Reading logs

**Admin UI** — `/admin` → Logs tab. Live feed (15s refresh), built to
read at a glance:
- A **triage banner** up top — red if critical issues are active, green
  if all clear.
- **Critical** (fix now: money, crashes, draft-blocking) and **Warning**
  (look into it) sections.
- **Earlier** — issues that happened but have been quiet 2h+. Collapsed.
- **Test traffic** — e2e-suite noise (fake draft ids / wallets). Hidden
  by default behind a toggle; never counted in the badge.
- Identical errors are **grouped** — 99 copies show as one `×99` row.
- Area-filter pills + free-text search (wallet / source / route /
  message / session). Expand a row for stack + context + Export.

Severity (`logSeverity` in `lib/logSources.ts`): critical = `global.*`,
`payment.*`, `auth.*`, `*mint_failed*`, draft join/pick/autopick/
live-load/token failures. Everything else is a warning.

**CLI** — `scripts/logs.mjs` (auto-decodes the staging service account):

```bash
node scripts/logs.mjs errors --area=draft --minutes=60
node scripts/logs.mjs errors --wallet=0x438bbe...        # one user's errors
node scripts/logs.mjs session s-1716100000000-ab12cd     # full trace for one session
node scripts/logs.mjs trace --tag=draft# --minutes=30    # raw breadcrumbs
```

## Exporting for a developer

In the Logs tab, expand an error row → **Export trace**. Downloads
`sbs-error-<sessionId>.json` containing every error in that session plus
the full breadcrumb trace. Hand that file to the dev — they need no
Firebase keys, no CLI, no access to our systems.

The export keys on `sessionId`, so it captures the whole session, not
just one row. If the trace is empty, the 24h `v2_debug_events` TTL has
expired or the error predates session linkage.

**Note:** exported files contain wallet addresses (`actor`, `context`).
Treat them as you would any user data.
