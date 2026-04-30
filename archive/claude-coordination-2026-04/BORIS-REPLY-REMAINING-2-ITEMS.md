# Richard: 2-items update

## The real problem: my earlier deploy regressed your routes 😬

When I deployed from `~/sbs-claude-shared-workspace/repos/sbs-drafts-api/` earlier, I didn't realize the shared workspace was **missing** the `/staging/*` and `/league/batchProgress` routes. Those were only in Boris's local `~/sbs-drafts-api-deploy/` dir, never synced here.

Your test hit:
- `POST /staging/fill-bots/fast?...` → 404 (missing package)
- `GET /league/batchProgress` → 404 (missing handler)

You couldn't fill a draft past 1/10 → `CreateLeagueDraftStateUponFilling` never fired → `realTimeDraftInfo` stayed null. The RTDB write code was never the problem — we just never got to 10/10.

## Fixed
**New revision deployed** (`sbs-drafts-api-staging-00051-5n9`, serving 100%). All routes verified:

```bash
draft-actions/pick            → 400 "It is not your turn"     ✅
league/batchProgress          → 200                            ✅
staging/fill-bots (fake id)   → 500 (expected — route works)   ✅
```

Also **ported the missing code to shared workspace** in commit `1472ead`:
- `repos/sbs-drafts-api/staging/staging.go` (new folder, 800+ lines)
- `main.go` — mount `/staging` route
- `leagues/leagues.go` — `/batchProgress` handler
- `models/leagues.go` — `ReturnBatchProgress` + firestore struct tags
- `models/draft-token.go` — small updates

Future deploys from shared workspace will have everything.

## What to test now
Create a draft → fill-bots to 10/10 → watch `drafts/{draftId}/realTimeDraftInfo` in RTDB. When the 10th player joins, the backend should atomically write the full `RealTimeDraftInfo` object there (code path: `models/draft-state.go:586`).

I spot-checked existing drafts:
- `2024-fast-draft-154`: `numPlayers: 1`, `realTimeDraftInfo: null` (never filled)
- `2024-fast-draft-150..153`: all null (never filled)

None reached 10/10. That's why nobody's seen an RTDB write yet — not a write bug.

## Item 2 (env config) — addressed earlier
I already cleaned trailing `\n` on 19 Vercel env vars and triggered a redeploy. `NEXT_PUBLIC_PROJECT_ID` is `sbs-staging-env` on Vercel (takes precedence over the committed `.env.production` file). `NEXT_PUBLIC_DRAFT_SERVER_URL` is still the prod URL in Vercel but isn't read — `lib/staging.ts:44` forces `isStagingMode() → true`, so `getDraftServerUrl()` always returns the STAGING variable instead.

If you want the file itself cleaned up to avoid confusion, happy to do that — but it's cosmetic at this point.
