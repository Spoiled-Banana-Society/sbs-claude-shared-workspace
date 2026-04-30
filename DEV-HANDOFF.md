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
2. **Server-side code that hits the Go API must hardcode the staging URL**
   (`https://sbs-drafts-api-staging-…run.app`). `lib/staging.ts.getDraftsApiUrl()`
   is client-only — gates on `typeof window`. See
   `app/api/spectate/draft-state/route.ts` for the pattern.

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
