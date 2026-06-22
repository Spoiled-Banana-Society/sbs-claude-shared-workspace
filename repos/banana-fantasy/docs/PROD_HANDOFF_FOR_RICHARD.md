# 🍌 PROD LAUNCH HANDOFF — for Richard's Claude

**Written 2026-06-21 by Boris's Claude. Goal: take staging (which is perfect/working) and stand up an IDENTICAL prod, safely, for the Banana Best Ball IV launch.** Read this top-to-bottom before doing anything. The companion runbook with finer detail is `docs/PROD_LAUNCH_CHECKLIST.md`.

---

## 0. THE TWO GOLDEN RULES (Boris's hard constraints — never violate)

1. **NEVER delete or overwrite OLD prod data** — users, accounts, money, winnings, cards, past-season data. It must all be preserved. (See the NEVER-DELETE list in §7.)
2. **Mirror STAGING exactly.** Staging is the source of truth. **Old prod runs a *different, older system* — we do NOT copy its code/architecture.** We replicate what **staging** does. And we make sure **old prod stuff cannot interfere with the new stuff.**

Everything below serves these two rules.

---

## 1. THE MENTAL MODEL (how staging/prod relate)

- **ONE codebase**, two environments. Staging and prod run the **same code**; they differ **only by environment variables.** Never fork the code.
- **Frontend:** repo `sbs-frontend-v2`. `main` branch → **staging** Vercel project `banana-fantasy` (banana-fantasy-sbs.vercel.app). `production` branch → **prod** Vercel project **`sbs-prod`** (→ sbsfantasy.com).
- **Prod is private first:** `sbs-prod` runs with `PRELAUNCH_MODE=true` → public sees the **countdown**; you/QA see the real app via the **bypass key**. Launch = flip `PRELAUNCH_MODE=false`. **Admin access (`ADMIN_WALLET_ADDRESSES`) is independent of this flag** — admins work in both states.
- **GCP project for prod = `sbs-prod-env`** (671861674743). This **also holds the OLD prod data** (preserved) + the OLD prod services (idle). The new 2026 data coexists with old data — **old is never deleted** (rule #1).

### Repo provenance (do NOT confuse — this tripped us up)
| Use | Local repo | Notes |
|---|---|---|
| Frontend (build here) | `~/banana-fantasy` → staging Vercel `sbs/banana-fantasy` (deploy via `~/ship.sh`) | |
| Go REST API (staging source) | `~/sbs-drafts-api-deploy` → `sbs-drafts-api-staging` | **NOT** `~/sbs-drafts-api-main` (that's OLD PROD, read-only) |
| Go WS server (staging source) | `~/SBS-Football-Drafts-main` → `sbs-drafts-server-staging` | "ALSO staging working copy" |
| ⛔ OLD-PROD read-only refs (never build from) | `~/sbs-drafts-api-main`, `~/SBS-Backend-main`, `~/sbs-draft-web-main` | hooks block reads |

---

## 2. WHAT'S ALREADY DONE THIS SESSION

### A) Frontend CODE changes — all SHIPPED to `sbs-frontend-v2/main`, build-verified, **staging-safe no-ops** (they only change *prod* behavior; staging is byte-identical because every change is env-gated with the current staging value as the default)
- **`lib/envGates.ts`** (new): `isProd()`, `paymentsEnabled()`, `testHelpersEnabled()`. Money routes (`card-mint`, `relay-buy`, `relay-permit`, `gas-topup`) → `paymentsEnabled()`; faucet + debug routes → hard `isProd()` block; bot routes → `testHelpersEnabled()`; StagingMintButton hidden in prod.
- **`lib/staging.ts`**: backend-URL resolver now `isProd() ? '' : <staging default>` → in prod a missing `NEXT_PUBLIC_STAGING_*` var **fails loud in QA** instead of silently serving prod off the staging backend.
- **`app/api/admin/deploy-bbb4v2/route.ts`**: now allowed in prod (was staging-locked); collection name/symbol env-driven (`BBB4_COLLECTION_NAME`/`BBB4_COLLECTION_SYMBOL`).
- **Env-driven staging refs** (prod reads its own; staging unchanged): `db-firestore.ts` referral link, `sync-cloud-errors` project/services, `league-players` + `draftStallCanary` RTDB URL, `upload` bucket (`UPLOAD_BUCKET`), 9 Go-API URL consts, site URLs (`NEXT_PUBLIC_SITE_URL`/`_APP_URL`).
- **Security fail-safes (isProd-gated, staging unchanged):** `adminAllowlist` + `switchWalletAllowlist` — in prod, NO fallback to the dev/test wallet list (require the env var, else empty → no one gets admin); `firebaseAdmin` — in prod, never fall back to the hardcoded staging service-account; `crisp-check` debug route 404s in prod.
- **Season → 2026 (Go backend):** `models/leagues.go` now uses one `seasonYear="2026"` const for all draft-id prefixes. **Deployed + live-tested on staging (Go rev `00158-gkf`)** — a real `2026-…` draft was created, mints/joins worked, no empty-league spawn. This source carries to prod when the prod Go API is deployed from `~/sbs-drafts-api-deploy`.

### B) Prod config already set on `sbs-prod` (Vercel) + `sbs-prod-env`
- **Admin wallets (Vercel `sbs-prod`):** `ADMIN_WALLET_ADDRESSES` **and** `NEXT_PUBLIC_ADMIN_WALLET_ADDRESSES` = `0x438bbe98eed1dd2df244b007dab0583cc9be72e0` (Boris) + `0xa13cfe7d8cab73feb372a3356fc13f9ad2d436ae` (Richard / username "BigRich"). *(Boris will add a 3rd Richard wallet later — append with a comma.)*
- **Other Vercel `sbs-prod` env set:** `BBB4_COLLECTION_NAME="Banana Best Ball IV"`, `NEXT_PUBLIC_SITE_URL=https://sbsfantasy.com`, `NEXT_PUBLIC_APP_URL=https://sbsfantasy.com`. (Plus pre-existing `PRELAUNCH_MODE`, `PRELAUNCH_BYPASS_KEY`, `NEXT_PUBLIC_LAUNCH_AT`.)
- **Vercel firewall rule on `sbs-prod`:** "API rate limit — render-loop guard" → Rate Limit **1500 req / 60s, keyed by IP**, path `/api`, action 429. (Mirrors staging — prevents the render-loop self-DDoS from 403-ing the whole site; per-IP so only the offender is throttled.)

### C) Contract — VERIFIED, not yet deployed
- The repo deploy artifact (`lib/onchain/bbb4v2Artifacts.ts`) is **byte-identical** to the live staging contract `0x781B2E6fE9A615C2680A51Ef88f309ddC2e0D73F` (proven: on-chain runtime bytecode is a verbatim substring of the artifact's creation bytecode). So deploying from this repo gives the **exact same V2 contract** (USDC on Base, gasless, all features). **Zero "old/wrong version" risk.**

---

## 3. THE STAGING BACKEND BLUEPRINT (audited — replicate this EXACTLY in prod)

This is what makes prod identical to staging. Every value below was pulled live from `sbs-staging-env`.

| Piece | Staging config → build the prod equivalent |
|---|---|
| **Redis** | `staging-redis`: **BASIC tier, REDIS_7_2, 1 GB**, port 6379, `default` network |
| **Cloud Tasks** | queue `auto-draft-queue` |
| **VPC connector** | staging: `staging-connector` (network `default`, 10.8.0.0/28). Prod already has **`prod-drafts-vpc`** (network `default`, 10.8.0.0/28) — READY ✅ |
| **Go API** `sbs-drafts-api-staging` | port **7070**, timeout **300s**, **NO VPC**, minScale 1 / maxScale 100, **1 CPU / 512 MiB**, ingress all, unauthenticated |
| **WS server** `sbs-drafts-server-staging` | port **8000**, timeout **3600s**, **VPC connector** attached, minScale 1 / maxScale 100, **1 CPU / 512 MiB**, ingress all, unauthenticated |
| **Firebase Functions** (6, in `sbs-staging-env`) | `scheduledUpdateADP` (hourly cron), `scheduledUpdateRosters` (daily cron), `onDraftFilled`, `onPickAdvance`, `onQueueUpdate`, `sbs-error-sink` |

### Go API env vars (names — values are prod-specific)
`ENVIRONMENT` (set to **`prod`** — the Go `main.go` `log.Fatal`s on boot if prod creds are missing, which is good), `GCP_PROJECT_ID` (=`sbs-prod-env`), `PROD_GCP_CREDS_LOCATION` (prod SA creds), `PROD_RT_DB_URL` (`https://sbs-prod-env-default-rtdb.firebaseio.com`), `INFURA_API_KEY` (**required or it won't boot**), `ADMIN_API_KEY`, `CLOUD_TASKS_QUEUE_NAME` (`auto-draft-queue`) + `GCP_LOCATION`, `PROD_API_URL` (= the new prod Go API URL, set after first deploy), `BASE_RPC_URL`, `ONESIGNAL_*` (optional). **NOTE on the Go API's `ETH_CONTRACT_ADDRESS`:** it is NOT the BBB4 contract — it's a legacy Ethereum-mainnet ownership-check that staging tolerates (errors ignored, Firestore is truth). **Leave it as staging has it (unset → default) so prod behaves identically.** The real BBB4 contract is wired via Firestore `system_config/batchProof` (admin "Deploy BatchProof" button) + `BBB4_OWNER_PRIVATE_KEY`, NOT this var.

### WS server env vars (names)
`ENVIRONMENT=prod`, `PROD_GCP_CREDS_LOCATION`, `PROD_REDIS_URL_LOCATION` (prod Redis host:port), `PRIVY_APP_ID`, `PRIVY_JWT_ISSUER`, `ADMIN_API_KEY`, + the prod VPC connector. *(`PRIVY_APP_ID/SECRET` are set on the Go API too but the Go API doesn't read them — harmless leftovers.)*

---

## 4. CURRENT PROD INFRA STATE (`sbs-prod-env`, audited read-only)

- ✅ **VPC** `prod-drafts-vpc` READY (network `default`, 10.8.0.0/28)
- ✅ **Secrets** `redis-url-prod`, `sbs-prod-config` exist (confirm contents — the Redis one may be stale since no instance exists yet)
- ✅ **Prod Firebase admin SA** `firebase-adminsdk-8hckl@sbs-prod-env.iam.gserviceaccount.com`
- ⚠️ **NO Redis instance** yet → must create (mirror staging)
- ⚠️ **NO `auto-draft-queue`** yet → must create
- 🟡 **Old prod services** (`sbs-drafts-api`, `sbs-drafts-server`, `sbs-cloud-functions-api`, the image/metadata generators — all `…w5wydprnbq`) sit **idle**
- 🟢 **Old prod crons are ALL PAUSED** (`updateADP`, `statsEngine`, `gameweekUpdate`, `checkForMissingTokens`, rank updates, etc.) → old background processing is OFF → **old can't interfere with new.** **Do NOT un-pause them.**

---

## 5. THE DECISION WE MADE: reuse `sbs-prod-env` (Option A), new `-prod` services

**Why not a brand-new GCP project:** the returning-user/old-winnings features need the old user accounts that live in `sbs-prod-env`. A separate project would orphan them or force a risky migration (which risks rule #1). So we **reuse `sbs-prod-env`**, deploy **new services with distinct `-prod` names**, and keep old data safe via "never delete" — not by isolation.

How this satisfies the golden rules:
- **Old doesn't break new:** old crons paused + new services are separate (`sbs-drafts-api-prod`, etc.) + the new frontend points only at the new services.
- **Don't delete old:** we only CREATE new services/infra; old services/data are untouched.

---

## 6. WHAT'S LEFT TO DO (ordered) — to make prod == staging

> The 2 infra creates + the deploys are the immediate path. The exact commands match staging's spec from §3.

1. **Create prod Redis** (mirror staging): 
   `gcloud redis instances create prod-redis --size=1 --region=us-central1 --tier=BASIC --redis-version=redis_7_2 --network=default --project=sbs-prod-env`
   → then put its `host:port` into the `redis-url-prod` secret.
2. **Create the Cloud Tasks queue:** 
   `gcloud tasks queues create auto-draft-queue --location=us-central1 --project=sbs-prod-env`
3. **Deploy Go API** → new service `sbs-drafts-api-prod` from `~/sbs-drafts-api-deploy`, port 7070, timeout 300, **no VPC**, min1/max100, 1cpu/512Mi, with the Go API env vars (§3). Verify traffic → new revision + health (`/league/batchProgress` → 200).
4. **Deploy WS** → `sbs-drafts-server-prod` from `~/SBS-Football-Drafts-main`, port 8000, timeout 3600, `--vpc-connector prod-drafts-vpc`, prod Redis, WS env vars (§3).
5. **Deploy the 6 Functions** → `sbs-prod-env`.
6. **Wire frontend prod env vars** (Vercel `sbs-prod`) to the new backend URLs + the rest: `NEXT_PUBLIC_STAGING_DRAFTS_API_URL`=new prod Go API, `NEXT_PUBLIC_STAGING_DRAFT_SERVER_URL`=new prod WS, the **prod Firebase** vars (`NEXT_PUBLIC_PROJECT_ID`, `_DATABASE_URL`, `_AUTH_DOMAIN`, `_STORAGE_BUCKET`, `_FIREBASE_API_KEY`, `_APP_ID`, `_MESSAGING_SENDER_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`), `UPLOAD_BUCKET`, `DRAFTS_API_SERVICE_KEY`, and the behavior flips **last**: `NEXT_PUBLIC_ENVIRONMENT=prod` + `PAYMENTS_ENABLED=true` (leave `TEST_HELPERS_ENABLED` unset). *(Set the behavior flips only once the backend URLs are in, or prod's fail-loud guards will (correctly) fail.)*
7. **Contract** (Boris does the wallet part): new **hot EOA owner wallet** → key into `sbs-prod` Vercel `BBB4_OWNER_PRIVATE_KEY` (Sensitive) → fund with Base ETH → run the `deploy-bbb4v2` admin route (deploys "Banana Best Ball IV") → set `NEXT_PUBLIC_BBB4_CONTRACT` + `NEXT_PUBLIC_BBB4_BATCH_PROOF_ADDRESS` → set `COLD_TREASURY_ADDRESS` = a Gnosis Safe. **Owner MUST be a hot EOA (not the Safe)** — `reserveTokens` (every mint) is `onlyOwner` and auto-signed; a Safe can't auto-sign. The Safe is the **treasury** (skim cron sweeps the hot wallet → Safe).
8. **VRF** — create + **fund (LINK)** the prod Chainlink subscriptions (draft + a separate wheel one); add the prod Merkle/wheel contracts as consumers (after contract deploy).
9. **Rotate the leaked staging keys** (Phase 0): the staging Firebase SA is hardcoded in `lib/firebaseAdmin.ts` (`STAGING_SA_B64`) AND `.env.production` is committed → both leak it in git history. Rotate the SA in GCP, review `.env.production`, gitignore + untrack it. *(The code already guards prod from USING the staging SA; rotation closes the leak. Staging-blast-radius, not a prod blocker.)*
10. **Seed `playerStats2026`** into prod Firestore (the new app already reads this collection).
11. **Reset the draft counter** for a clean `#1` (staging has a `/staging/reset-draft-counter` route; prod equivalent).
12. **Private QA** behind `PRELAUNCH_BYPASS_KEY` (mobile + desktop): mint → join → draft → admin loads → returning-vs-new-user check works. **Then flip `PRELAUNCH_MODE=false`.**

### ALSO NEEDED (don't forget these — they complete the full picture)
- **Deploy the prod FRONTEND itself.** The current `sbs-prod` deploy is just the countdown. To get the real app onto `sbs-prod`, push the code to the **`production` branch** → `sbs-prod` rebuilds with the full app. It stays **private** because `PRELAUNCH_MODE=true` is still set. Do this *after* the prod env vars (step 6) are in, so the build has correct config. (This is what carries ALL the code changes from §2 into prod.)
- **DNS / domain:** confirm **sbsfantasy.com is attached to the `sbs-prod` Vercel project** (so the domain serves the real app at launch, not a stale project). If it currently points elsewhere, that's a domain-move step.
- **Privy:** confirm the Privy app **allows the `sbsfantasy.com` domain** (auth breaks on a domain Privy doesn't recognize). Privy cert for `privy.sbsfantasy.com` was issued — re-verify it's live.
- **Drops (decisions already made):** Coinbase/CDP is being dropped (don't set `CDP_API_KEY_*`); OneSignal push is being dropped (don't set `ONESIGNAL_*` — notifications go via email/TG/Discord; verified safe, push just skips). These are "don't set those env vars," not work.
- **Optional, low-priority code (not blockers):** tighten CORS (`middleware.ts` `*.vercel.app` wildcard is broad for prod); env-drive the admin pfp bucket (`users-aggregate` uses `sbs-staging-pfps`). Skip unless time allows.

### Sequencing note
Steps 1–6 (Redis → queue → backends → Functions → env vars) + the frontend deploy can all happen **with the contract (step 7) deferred** — the contract isn't a prerequisite for the rest. Only `NEXT_PUBLIC_BBB4_CONTRACT`, the BatchProof deploy, and live mint-testing actually wait on the contract. So Richard can build the whole backend/frontend foundation first and do the contract when the hot wallet is ready.

---

## 7. DATA SAFETY — exactly how "don't delete / don't tangle" works

- **Old SEASON data** (drafts, tokens, leagues, scores — keyed `2024-…`/`2025-…`) → **sits untouched**, year-keyed, separate from the new `2026-…` keys. New and old physically can't collide. Read-only when needed.
- **User ACCOUNTS** (per-wallet: `v2_users`, `owners`) → **carry forward**. A returning user logs in and gets their account/identity/badges/winnings back — the app *reads and adds to* it, never wipes it. The **returning-vs-new distinction is a computed flag** (`/api/users/returning-check`, based on old-prod footprint) — co-mingling in `v2_users` doesn't confuse it.
- **⛔ NEVER DELETE** (if any data-wipe is ever run — and prefer NOT to run a mass wipe on prod): `v2_users`, `owners`, `transactions`, `withdrawalRequests`, `claims`, `v2_purchases`, `bbb4_usdc_sweeps`, `cards`/`cardMetadata` (Genesis), `playoffCards*`, `scores`/`stats`/`playerStats*`, `2023DraftTokens*`, `system_config`, `merkle_rounds`, `batch_proofs`, wheel collections, `web2_social_identities`. **Real unclaimed ETH lives on `draftTokens.Prizes.ETH` — be extra careful around `draftTokens`.** Always dry-run; no PITR; irreversible.
- **Token era-scoping:** the new contract has its own token ids; the existing `canonTokenId`/marketplace-index healing keeps old/new from making ghost cards — verify during QA.

---

## 8. ⚙️ WHAT RICHARD MUST SET UP so his Claude can help with prod

Two separate guardrails block Claude from touching prod (both are intentional):

1. **The `sbs-safety` hook** blocks Claude's Bash from *writing* to the `sbs-prod-env` GCP project ("Claude is restricted to staging only … run prod writes from your own shell directly"). Options:
   - **Easiest (no config):** Richard runs each prod-write command himself with a **`!` prefix** in the Claude prompt (e.g. `! gcloud redis instances create …`) — it runs in his shell (hook doesn't apply) and Claude still sees the output to verify. **Claude writes + verifies every command; Richard just pastes it with `!`.**
   - **Fully hands-off:** disable the `sbs-safety` prod-block hook (in the Claude hooks config) so Claude can run prod writes directly. More setup; only if he wants Claude unattended.
2. **Claude Code permission rules** (the `/permissions` "auto mode classifier") also gate prod actions. Add **Allow** rules (via `/permissions` → Allow → "Add a new rule…", using **arrow keys + Enter**, not number keys) for: `Bash(gcloud run deploy:*)`, `Bash(gcloud redis instances create:*)`, `Bash(gcloud tasks queues create:*)`, `Bash(gcloud run services update-traffic:*)`, `Bash(gcloud functions deploy:*)`, `Bash(gcloud secrets versions add:*)`, `Bash(vercel env add:*)`. **Do NOT add delete commands** — keep destructive ops guarded (protects rule #1).

**Recommended:** start with the **`!` prefix** path — zero extra config, works immediately, and Claude does all the precision + verification. Claude should ALWAYS triple-check each command matches staging and verify the result (READY state, traffic routing, health 200, env correctness) before moving to the next step.

---

## 9. KEY REFERENCES
- **`docs/PROD_LAUNCH_CHECKLIST.md`** — the detailed phase-by-phase runbook (updated this session with everything above).
- Staging URLs: frontend `banana-fantasy-sbs.vercel.app`; Go API `sbs-drafts-api-staging-652484219017.us-central1.run.app`; WS `sbs-drafts-server-staging-652484219017.us-central1.run.app`.
- Contract (staging, = the artifact prod will deploy): `0x781B2E6fE9A615C2680A51Ef88f309ddC2e0D73F`. USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- **Golden rules again:** don't delete old data · mirror staging · old can't touch new.

*— End of handoff. Build it to match staging, verify every step, never delete the old stuff.*
