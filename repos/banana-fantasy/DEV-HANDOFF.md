# Dev Handoff

Codebase is in `repos/banana-fantasy/`. Build / typecheck / lint all clean.

**Live staging:** https://banana-fantasy-sbs.vercel.app

## Run locally

```
cd repos/banana-fantasy
npm install
npm run dev
```

Need a `.env.local` with Privy app ID + Firebase admin SDK creds. Ask Richard.

## Deploy

```
cd ~/sbs-claude-shared-workspace
./scripts/deploy.sh "<commit message>"
```

The script mirrors `repos/banana-fantasy/` → `sbs-frontend-v2` repo and triggers
the Vercel deploy hook. Don't push direct to `sbs-frontend-v2` — Vercel
deployment protection blocks auto-deploys, you'd just orphan the commit.

## Hard rules

1. **Staging only.** Never deploy to `draft.sbsfantasy.com` (prod) or modify
   anything pointed at `sbs-prod-env`. Frontend changes here only land on
   `banana-fantasy-sbs.vercel.app`.
2. **Never POST/PATCH/PUT to Go from the browser.** All user mutations go
   through Next.js BFF routes (`/api/draft/*`, `/api/league/*`, `/api/owner/mint`).
   Client code uses `authedAppFetch` with a Privy JWT; the BFF resolves the
   wallet from session and forwards to Go with `X-SBS-Service-Key` +
   `X-SBS-Wallet`. Reads (`getDraftInfo`, leaderboards, etc.) still hit Go
   directly — lower risk, no state mutation.
3. **Server-side code that hits the Go API** uses `lib/draftsApiServer.ts`
   (never raw `fetch` to `*.run.app`). That helper attaches the service key
   and optional admin key. See `app/api/draft/[draftId]/pick/route.ts`.

## Drafts API auth — env vars (names only)

Set in Vercel and Cloud Run before enabling Go auth (`DRAFTS_API_AUTH_ENABLED=true`):

| Variable | Where | Purpose |
|----------|-------|---------|
| `DRAFTS_API_SERVICE_KEY` | Vercel + Cloud Run | BFF → Go shared secret |
| `AUTO_DRAFT_SECRET` | Cloud Run only | Cloud Tasks auto-draft callback |
| `ADMIN_API_KEY` | Vercel + Cloud Run + Firebase Functions | Admin/staging routes (`fill-bots`, `recover-card`) |
| `DRAFTS_API_AUTH_ENABLED` | Cloud Run only | Rollout flag (`false` until BFF is live) |
| `STAGING_DRAFTS_API_URL` | Vercel (server) | Go API base URL for `draftsApiServer` |

E2e scripts that set up drafts directly against Go (`e2e/drafting-timer.spec.ts`,
`e2e/dual-tab-stability.spec.ts`) read `DRAFTS_API_SERVICE_KEY` and
`ADMIN_API_KEY` from `.env.local` via `scripts/e2e-drafts-api.mjs`.

## Deploy order (drafts API auth)

1. Deploy frontend with BFF routes + `DRAFTS_API_SERVICE_KEY` on Vercel (Go auth still off).
2. Deploy Go with middleware code but `DRAFTS_API_AUTH_ENABLED=false`.
3. Set `DRAFTS_API_SERVICE_KEY`, `AUTO_DRAFT_SECRET`, `ADMIN_API_KEY` on Cloud Run.
4. Deploy Firebase Functions with `ADMIN_API_KEY` for staging callbacks.
5. Flip `DRAFTS_API_AUTH_ENABLED=true` on Cloud Run.
6. Verify: direct `curl` to Go pick without service key → 403; BFF pick with Privy session → 200 on user's turn; auto-draft still fires after timer.

## Backends

- **Go API** (REST): `~/Downloads/sbs-drafts-api-main` (read-only reference
  copy). Deploy via `gcloud run deploy sbs-drafts-api-staging` from Boris's
  copy. You need staging service-account JSON to deploy.
- **WS server** (`SBS-Football-Drafts`): not in this workspace.
- **Firestore** project: `sbs-staging-env`.

## Where to find things

| | |
|---|---|
| Live draft state | `lib/draftApi.ts` (client) |
| Auto-pick | `hooks/useDraftEngine.ts` `autoPickForPlayer` |
| Draft room | `app/draft-room/page.tsx` |
| Promo modal | `components/modals/PromoModal.tsx` |
| Wheel spin | `app/api/wheel/spin/route.ts` (force a result with `?forceWheel=jackpot`) |
| Admin | `app/admin/page.tsx` (single-page tabbed) |
| Spectator | `/spectate/[draftId]` redirects to `/draft-room?…&spectate=true` |

## Open items worth knowing

- A few `app/api/owner/*` routes (`use-pass`, `refund-pass`, `team-nicknames`)
  trust the body's `walletAddress` — no Privy auth check. Tighten before
  prod volume.
- Marketplace listing rule (free passes can't list during season) is
  client-only. Needs server gate before real volume — see CLAUDE.md.
- One-off `/api/admin/revoke-7702` should come out (one-time fix, served its
  purpose).
- Rankings CSV **import** is demo-only (`applyUploadedRankings` just shows
  an alert). Trigger button hidden; modal + handlers kept intact (prefixed
  `_` for lint) so it's easy to wire to the Go API. Download works.
- `recordJackpotHit` (`lib/db-firestore.ts`) silently returns null if the
  Go API `state/info` lookup blips — the JP credit just doesn't land. No
  retry, no Sentry log. Worth a retry + logger.error on the err path.
- Pre-existing lint warnings (`<img>` over `next/image`, missing useEffect
  deps) in legacy files. Build passes; warnings haven't been cleaned up.
