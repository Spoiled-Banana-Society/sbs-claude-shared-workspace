# 🚀 PROD PRIVATE SITE — Setup, Access & Deploy (READ BEFORE DEPLOYING)

_Written 2026-06-22 by Boris's Claude. This describes the LIVE launch state._

## TL;DR
- We went live with **"staging-as-prod"**: the env we used to call *staging* **IS now production**, served at **`sbsfantasy.com`**, but **sealed PRIVATE behind a pre-launch wall** until Boris flips it public.
- **The `main` branch is PRODUCTION now.** Every push to `main` (via `~/ship.sh`) deploys straight to the live (private) `sbsfantasy.com`. There is **no separate staging** yet. **Do NOT push half-finished work to `main` — it goes live (privately) instantly.**

## The two faces of `sbsfantasy.com` (this is the part that confuses people)
`PRELAUNCH_MODE=true` is set on the Vercel project. The middleware (`middleware.ts`) then does:
- **No `sbs_preview` cookie → COUNTDOWN wall.** Every public visitor (and any fresh browser / incognito / Safari Private window) sees the coming-soon/countdown page. The real app is sealed.
- **Has the `sbs_preview` cookie → FULL APP.** You get the cookie by visiting **`sbsfantasy.com/enter?key=<KEY>`** once. It drops a 30-day `sbs_preview=1` cookie, then `sbsfantasy.com` shows the real app automatically from then on (same browser).
- ⚠️ So if `sbsfantasy.com` shows you the *app*, it's because **your browser already has the bypass cookie** — not because it's public. Check in an **incognito/Private window** to see what the public sees (the countdown).
- **Going public = ONE flag flip:** `PRELAUNCH_MODE=false` in Vercel → public. Instantly reversible. **DO NOT flip this — that's Boris's launch call.**

## Architecture (staging-as-prod)
- **Frontend:** Vercel project **`banana-fantasy`** (NOT `sbs-prod` — ignore that old project). Deploys from **`main`**. It serves `sbsfantasy.com`, `staging.sbsfantasy.com`, AND `banana-fantasy-sbs.vercel.app` — **all the same build, all walled.**
- **Backend = STAGING backend** (this is the whole point of staging-as-prod):
  - Firestore + RTDB: **`sbs-staging-env`**
  - Go API: **`sbs-drafts-api-staging`** (`…-staging-…run.app`)
  - WS: **`sbs-drafts-server-staging`**
  - `isStagingMode()` hard-returns `true` → the app ALWAYS talks to the staging backend. **No prod backend (`sbs-prod-env` / `…w5wydprnbq…`) is used anywhere.**
- **Prod-config env vars on `banana-fantasy`:** `NEXT_PUBLIC_ENVIRONMENT=production`, `PAYMENTS_ENABLED=true` (these two MUST go together or payments 403), `PRELAUNCH_MODE=true`, `ADMIN_WALLET_ADDRESSES` + `SWITCH_WALLET_ADDRESSES` set (admin/switch-wallet break in prod without these), `NEXT_PUBLIC_SITE_URL=https://sbsfantasy.com`. The `NEXT_PUBLIC_STAGING_*` URL vars point at the staging backend (required — they go empty-fallback in prod).
- **New NFT contract:** "Banana Best Ball IV" `0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80` on Base, owner = backend mint signer `0xccdF79`. (Old staging contract `0x781B…` retired.) USDC stays in the contract; withdrawn manually (skim cron disabled).
- **VRF/Merkle proof contracts** rebuilt + verified working. Data fully wiped to a clean launch state.

## Deploying (IMPORTANT — `main` = prod)
1. `~/reconcile.sh` BEFORE editing (pulls live so you don't clobber).
2. Edit, then `~/ship.sh "msg"` → pushes `main` → Vercel → live on `sbsfantasy.com` (private) in ~2 min.
3. Code deploys do **not** touch the wall or env vars (those are project-level and persist).
4. ⛔ Treat `main` as production: coordinate, no half-baked commits. A broken deploy still breaks the private site you're testing on.
5. ⛔ Do NOT change `PRELAUNCH_MODE`, the prod env vars, or the domain without Boris.

## Testing the real site
- Visit **`sbsfantasy.com/enter?key=<KEY>`** to get into the full real app (real money, behind the wall). **Ask Boris for the current `<KEY>`** — it's intentionally kept out of this public repo. (It's rotatable; will change at/after launch.)
