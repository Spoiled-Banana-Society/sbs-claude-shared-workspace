# State-Integrity Audits

The **proactive** half of observability. Our logger/error-feed is *reactive* — it
fires when something throws in the moment. But some bugs are **silent state drift**:
the data sits in a wrong state and nothing errors until a user trips on it.

> Real example (2026-05-30): a wallet's pass counter said 12 while its real spendable
> tokens were 0. Nothing logged for *days* — until the user tried to join a draft and
> got a 500. A state audit would have flagged it the day it drifted.

**Logs watch _events_. Audits watch _state_.** You need both.

## What it checks (money / fairness only — never "every part of the site")

| Check | Invariant | Source | Severity |
|-------|-----------|--------|----------|
| passes | `draftPasses`/`freeDrafts` ≤ real spendable `validDraftTokens` | `audit.passes.over` | 🔴 critical (user blocked at join) |
| passes | counter ≥ real spendable | `audit.passes.under` | 🟡 warning (under-credited, safe direction) |
| negative balances | no money/pass counter < 0 | `audit.balance.negative` | 🔴 critical (corruption) |

Scope is deliberately tight: a value that can **silently lie** AND **costs money/fairness**.
Drafting UI, chat, leaderboards, auth, etc. are NOT audited — they either throw in the
moment (the feed catches them) or are derived from one source (nothing to drift against).

## How to run it

- **CLI (dev / ad-hoc)** — no Next build, just a service account + node:
  ```bash
  SA_PATH=/path/to/staging-sa.json node scripts/audit.mjs        # human report
  SA_PATH=... node scripts/audit.mjs --json                      # machine-readable
  ```
  Exits non-zero if any **critical** finding exists (CI-friendly).

- **Admin (on-demand)** — `GET /api/admin/integrity` returns findings JSON;
  `GET /api/admin/integrity?post=1` also writes them into the admin Logs feed.

- **Scheduled (automatic)** — `/api/crons/audit-integrity` runs daily (`vercel.json`,
  `0 8 * * *`) and posts every finding into `v2_error_events`, so a 🔴 `audit.passes.over`
  shows up in the **admin Logs tab** under Critical, with the affected wallet — before
  any user hits it.

## Adding a new check

Money/fairness invariants only. In `lib/audits/checks.ts`:
1. Write `async function auditX(db): Promise<AuditFinding[]>` returning findings with a
   `source` like `audit.<area>.<outcome>`.
2. Add it to `AUDIT_CHECKS`.
3. If it should page as Critical, add its `source` to `CRITICAL_PATTERNS` in `lib/logSources.ts`.
4. Mirror the logic in `scripts/audit.mjs` (kept standalone so the dev can run it build-free).

Candidate next checks (have a real drift history): **draft batch tracker**
(`FilledLeaguesCount` vs actual filled drafts — drives the JP/HOF guaranteed distribution),
**promo credit** (claim counts; free drafts must earn no promo credit).

## Source of truth

`lib/audits/checks.ts` is canonical (used by the admin route + cron). `scripts/audit.mjs`
mirrors it for build-free CLI use. Change one → change both.
