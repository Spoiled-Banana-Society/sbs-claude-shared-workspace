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

## 3.5 🔑 FRONTEND ENV-VAR PARITY CHECKLIST (Vercel `sbs-prod`) — AUTHORITATIVE

> This is the **complete list of every env var STAGING (`banana-fantasy`) has set** (pulled live `2026-06-21` via `npx vercel env ls`). **Prod must have all of them.** The whole "make prod identical to staging" problem reduces to: set every var below on `sbs-prod`. **Default rule = COPY THE STAGING VALUE VERBATIM.** Only the vars flagged 🔶 or 🔐 get a different value. To re-pull the live list anytime: `cd ~/banana-fantasy && npx vercel env ls`.
>
> ⚠️ Do NOT set the 🔶 behavior/infra vars until the prod backend is deployed and its URLs exist — the frontend's fail-loud guards (`isProd()`) will (correctly) error otherwise. Flip `NEXT_PUBLIC_ENVIRONMENT=prod` **last**.

**🔶 PROD-SPECIFIC — must point at prod infra / define the env (NEVER reuse the staging value):**
- `NEXT_PUBLIC_ENVIRONMENT` → `prod` *(flip LAST)*
- Firebase (all → `sbs-prod-env`): `NEXT_PUBLIC_PROJECT_ID`, `NEXT_PUBLIC_DATABASE_URL`, `NEXT_PUBLIC_AUTH_DOMAIN`, `NEXT_PUBLIC_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_APP_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_MESSAGING_SENDER_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`
- Backend URLs (→ the new `-prod` services, set after they deploy): `NEXT_PUBLIC_STAGING_DRAFTS_API_URL`, `NEXT_PUBLIC_STAGING_DRAFT_SERVER_URL`, and the legacy `NEXT_PUBLIC_DRAFTS_API_URL` / `NEXT_PUBLIC_DRAFT_SERVER_URL` / `NEXT_PUBLIC_SBS_API_URL` *(verify which are still read; set to prod URLs to be safe)*
- On-chain (prod contract + wallets): `NEXT_PUBLIC_BBB4_BATCH_PROOF_ADDRESS` (prod BBB4 contract), `BBB4_OWNER_PRIVATE_KEY` (prod hot wallet — server-only, NEVER `NEXT_PUBLIC`), `COLD_TREASURY_ADDRESS` (prod Gnosis Safe)
- `ALCHEMY_WEBHOOK_SIGNING_KEY` → the signing key of the **prod** Alchemy Transfer webhook (see §3.6)
- `WHEEL_JPHOF_MINT_PASS` → verify against prod wheel/merkle config (don't blind-copy if it encodes a staging round)

**🔐 INTERNAL SHARED SECRETS — generate FRESH for prod, and set the SAME value on the prod backend (Cloud Run) where it's read. Don't reuse staging's:**
- `ADMIN_API_KEY` (also on Go API + WS), `DRAFTS_API_SERVICE_KEY` (also on Go API — frontend 503s without it), `CRON_SECRET`, `NOTIFICATIONS_INTERNAL_SECRET`, `BOT_ADMIN_SECRET`, `NFT_REFRESH_SECRET`

**✅ COPY VERBATIM — external third-party service creds; the same account serves prod (this IS "exactly what staging is"):**
- RPC/onchain: `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` *(Base — confirmed; reuse is fine. Optional: separate Alchemy app for prod to isolate rate limits)*, `NEXT_PUBLIC_OPENSEA_API_KEY`, `OPENSEA_API_KEY`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`
- Auth: `PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` — ⚠️ **see §3.6: the prod domain (sbsfantasy.com) MUST be added to the Privy app's allowed origins, or new-user login breaks** (this is the "private-gate / new-user email" bug — §7.5)
- Email: `RESEND_API_KEY`, `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM`
- Notifications/social: `ONESIGNAL_REST_API_KEY`, `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_WEBHOOK_URL`, `NEXT_PUBLIC_DISCORD_INVITE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME`, `TELEGRAM_WEBHOOK_SECRET`, `X_BEARER_TOKEN`
- KYC (⚠️ point their webhooks at the prod domain — §3.6): `PERSONA_API_KEY`, `PERSONA_WEBHOOK_SECRET`, `NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID`, `NEXT_PUBLIC_PERSONA_TEMPLATE_ID_BASIC`, `NEXT_PUBLIC_PERSONA_TEMPLATE_ID_KYC`, `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_WORKFLOW_ID`
- Support/observability: `CRISP_KEY`, `CRISP_IDENTIFIER`, `CRISP_TIER`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`

**Already set on `sbs-prod`** (per §1.B): `ADMIN_WALLET_ADDRESSES` + `NEXT_PUBLIC_ADMIN_WALLET_ADDRESSES`, `BBB4_COLLECTION_NAME`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `PRELAUNCH_MODE`, `PRELAUNCH_BYPASS_KEY`, `NEXT_PUBLIC_LAUNCH_AT`.

**Sanity gate before flipping `NEXT_PUBLIC_ENVIRONMENT=prod`:** `npx vercel env ls` on `sbs-prod` and diff the NAME set against staging's — every staging name must be present. A missing name = a silent fallback (e.g. Alchemy → public Base node → rate-limited on launch day). Missing-name is the failure mode, not wrong-value.

## 3.6 🌐 EXTERNAL-SERVICE DOMAIN/WEBHOOK ALLOWLISTS (the non-env-var half)

A few third-party services gate by **domain or webhook URL**, configured in *their* dashboard — copying the env var is necessary but not sufficient. At cutover, in each provider's console add/point to **sbsfantasy.com**:
- **Privy** — add `sbsfantasy.com` to Allowed origins/domains (else new-user login silently fails — the §7.5 bug). Same app ID is fine *if* the domain is added; otherwise a separate prod Privy app.
- **Alchemy** — create/point the **Transfer webhook** at the **prod contract + prod webhook URL** (`https://sbsfantasy.com/api/...`); its signing key → `ALCHEMY_WEBHOOK_SIGNING_KEY`. (Backstop only — `reconcilePasses` is source of truth — so not launch-blocking.)
- **Persona / Didit (KYC)** — point their webhook URLs at the prod domain.
- **Discord OAuth** — add the prod domain to the app's redirect URIs (if social login/link uses it).
- **WalletConnect** — add the prod domain to the project's allowlist if enforced.

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

## 7.5 🚨 CRITICAL: the new-user / Privy flow MUST work while prod is PRIVATE (the "lost-a-whole-day" bug)

**This is the #1 thing to get right — it cost Boris a full day on staging, and it's *masked by the private gate*, so it's easy to miss until real users hit it.**

**What happened (staging, June 2026):** with `PRELAUNCH_MODE=true` (private), `middleware.ts` `handlePrelaunch()` returned **404 for EVERY `/api/` route** for any caller without the `sbs_preview` bypass cookie. **Server-to-server callers have no cookie** → the notification webhooks (`onDraftFilled`/`onPickAdvance` Functions) and Vercel crons all 404'd → draft alerts, welcome notifications, and parts of the **new-user (Gmail/email) signup flow** silently broke. Browsers with the bypass cookie worked, so it looked fine in QA.

**The fix is in code (carries to prod):** `handlePrelaunch` now lets authenticated server-to-server callers through BEFORE the blanket 404 — webhooks via `x-internal-secret === NOTIFICATIONS_INTERNAL_SECRET`, crons via `Authorization: Bearer ${CRON_SECRET}` or the `x-vercel-cron` header.

**⚠️ Prod is ALSO private during QA/countdown — so this gate is active in prod. To avoid re-breaking it:**
1. **Set `NOTIFICATIONS_INTERNAL_SECRET` and `CRON_SECRET` on the prod Vercel project.** The fix depends on them — if unset, webhooks/crons 404 behind the seal and new-user notifications + draft alerts silently die again.
2. **The prod Firebase Functions must POST to the prod API with the `x-internal-secret` header** (mirror staging) so they clear the gate.
3. **Any NEW internal/webhook `/api` route must carry one of those auth headers** or it 404s whenever prelaunch is on.

**Plus the Privy social-login wallet resolution (fresh Gmail/email users):**
- A brand-new social user's Privy embedded wallet appears a beat *after* login. `lib/auth.ts` re-resolves it via the Privy User API with a short negative-cache TTL so firstLogin/welcome-bell/username don't get stuck on a stale `null`. (In code → carries to prod.)
- **Set `PRIVY_APP_SECRET` on EVERY backend that does auth** (Vercel + Go services), not just one — the User API fallback needs it, or social-login users 403. (`feedback_privy_social_login_fallback`.)

**🔴 MUST-DO in the private QA pass (before flipping prod public):** test the **full new-user flow on prod behind the bypass key, on BOTH desktop and mobile, with a FRESH Gmail login.** Confirm: wallet resolves, the welcome bell + free-spin banner appear, username claims, and draft alerts fire. **It must work EXACTLY like staging does now.** This is exactly what broke before and is hidden by the private gate — so it's the single most important thing to verify.

---

## 7.6 ✅ Two staging features shipped this session — prod-ready (carry via the code at cutover)

Both are on `main`, build-verified, staging-safe, and (being code) come to prod automatically when you build the prod frontend — **no separate prod work, just include them in the cutover whenever you build.** *(✅ Boris checked both on staging — confirmed working & good. Cleared to ship to prod at the cutover.)*
1. **Promo extra-spin fix** (`lib/promoMath.ts` + `lib/db-firestore.ts`): the "Buy 10 → Spin" and "buy-bonus" promos were awarding an **extra** spin/bonus on a purchase that followed an exact-multiple landing (the full-bar value `max` was stored and re-counted). Fixed by counting the milestone **delta**; added a regression unit test. Self-heals existing inflated progress going forward.
2. **Promos "Activity" tab** (`components/profile/ActivityHistory.tsx` + `app/promos/page.tsx`): a real-time promo-history tab (after "Locked") showing spins won / promos claimed / passes bought / drafts won, timestamped. Reuses the existing profile activity feed (SSE) with a new `filterTypes` prop — no new data/infra, fully backward-compatible.

---

## 7.7 🔁 RETURNING USERS + the OG BADGE — what must be in place for prod

> **⚠️ CORRECTION — ignore any earlier "BBB1 / BBB2 / BBB3 contract" thread.** An earlier draft asked for BBB1 + BBB2 contract addresses and a holder-snapshot to extend detection. **That work is NOT needed and should be ignored.** All-seasons wallet detection + the OG badge already work in the code (see below). **The ONLY returning-users task for prod is the one web2 email/Google mirror in the "⚠️ The ONE real gap" section** — a single script, run once at cutover.

Returning-user recognition on first login (right UX + the **OG badge**) is **mostly already handled in the code** and carries to prod automatically. There is **ONE real prod data gap** (web2/email identities). Read this carefully — an earlier draft of this doc overstated the work; the correction is below.

### ✅ All-seasons coverage already ships in the code (BBB1 + BBB2 + BBB3)
Detection is **NOT BBB3-only.** The backbone is a bundled wallet snapshot of **every player from every Banana Best Ball season (2022 → 2025)** — BBB1, BBB2, BBB3 included:
```
lib/data/existing-players.json     1,745 wallets, all seasons   (a CODE file — ships to prod with the repo)
lib/returningUsers.ts:65           PAST_PLAYER_SET  ← built from that file
lib/returningUsers.ts:73           isPastPlayer()   ← checks PAST_PLAYER_SET
lib/returningUsers.ts:87           isReturningWalletSync()  ← allowlist OR PAST_PLAYER_SET
lib/badges/awards.ts:33            OG badge gates on isPastPlayer()  → unlockBadge(userId,'og')
```
Because `existing-players.json` is bundled in the repo, **wallet-based returning detection + the OG badge already work in prod the moment the code deploys.** No BBB1/BBB2/BBB3 contract addresses needed, no holder snapshot to run, no code change.
*(`BBB3_CONTRACT_ADDRESS` in `returningUsers.ts:21` is only a supplementary live on-chain check for someone who acquired a BBB3 NFT *after* the snapshot was frozen. Bonus, not the backbone.)*

### ⚠️ The ONE real gap — web2/email identities are EMPTY in prod
Web2/Gmail returning users get a **fresh Privy embedded wallet** that is NOT their old wallet, so the wallet snapshot can't match them. They're matched by email/handle via a flattened index in Firestore that login reads as `email:<lowercased>` / `x:<handle>` doc IDs (`app/api/users/returning-check/route.ts:171-180`):
```
web2_social_identities    ← email / X-handle ↔ old wallet.   VERIFIED 2026-06-21: EMPTY in sbs-prod-env
```
**Staging already has this collection, fully built and proven working.** The cleanest fix is to **mirror staging's finished collection into prod** rather than rebuild it from raw old-prod `socialUsers` (which is keyed differently and would have to be re-flattened — silent-failure risk if the key format is off by a space/case).

→ **Run the ready script (DRY-RUN first, then `--go`):**
```
# from ~/banana-fantasy — supply the PROD service account, run prod write from your OWN shell (`!`)
PROD_SA_B64=$(cat <prod-sa>.json | base64) node scripts/mirror-web2-identities-to-prod.mjs        # preview
PROD_SA_B64=$(cat <prod-sa>.json | base64) node scripts/mirror-web2-identities-to-prod.mjs --go    # execute
```
The script copies staging `web2_social_identities` → prod **verbatim** (idempotent merge; hard-guards source==sbs-staging-env, dest==sbs-prod-env; data-only — writes one read-only-by-the-app collection, touches no accounts/money). ~503 docs.

**Realistic expectation (X-login was removed — `providers/PrivyProvider.tsx:115`, Boris 2026-06-20):** of the 503 old web2 users, **~346 logged in with Google/email** and carry an email → they match on return and get returning UX + OG badge. The **~157 X-only** users have **no email on file** and X is no longer a login method, so they **cannot be auto-detected** when they sign up fresh with Gmail. That's an inherent consequence of removing X login — **identical in staging today**, not a mirror bug. The `x:` docs are still copied (harmless; login simply never reads them) in case X-link matching is wired in later.

*(`bbb3_holders` is also empty in prod but is redundant — `existing-players.json` already covers BBB3 wallets. Importing it is optional belt-and-suspenders, not required.)*

### What ALREADY works (no code needed)
- **Wallet-based returning detection + OG badge** — covered by `existing-players.json` (all seasons), in the code. ✅
- **First-login surfaces** — download-app banner (all users, mobile + desktop), first-purchase promo (`promoFilter.ts:69`), new-to-USDC web3 ping (web3-login users). All built + correctly gated.

### Net for "returning users just work" in prod
1. **Code deploy alone** → every wallet-based past player (BBB1/2/3) is detected + gets the OG badge. Nothing to do.
2. **One mirror** → run `scripts/mirror-web2-identities-to-prod.mjs --go` once at cutover so web2 Google/email returning users are recognized too.
That's it — **no contract addresses, no new detection code, no rebuild.**

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
