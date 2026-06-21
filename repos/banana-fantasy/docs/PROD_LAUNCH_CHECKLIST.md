# 🍌 SBS Fantasy — PROD LAUNCH CHECKLIST (BBB4)

**Launch target:** Tue 2026-06-23, 4:20pm PT (`NEXT_PUBLIC_LAUNCH_AT=2026-06-23T16:20:00-07:00`)
**Strategy:** Stand up the FULL real app at `sbsfantasy.com` behind the prelaunch wall (`PRELAUNCH_MODE=true`), test everything privately via `/enter?key=…`, then launch = flip `PRELAUNCH_MODE=false`. No DNS change or migration at launch moment — all risk de-risked days early.

**How to use:** Work top-to-bottom; phases are dependency-ordered. `[ ]` = todo. ⚠️ = real-money risk, do not skip. Every "verify" step must actually pass before moving on. This is a real-money launch — nothing done "from memory," everything verified live.

---

## 🆕 SESSION UPDATE — 2026-06-21 (read FIRST; supersedes a few items below)

A full re-audit + live verification this session. These CORRECT or ADD to the phases below — apply them where noted.

### ⚙️ PROD-PREP EXECUTED (on `main`, build-verified, NOT deployed yet)
- ✅ **Env-flag split DONE** — new `lib/envGates.ts` (`paymentsEnabled` / `testHelpersEnabled` / `isProd`). 4 money routes → `paymentsEnabled()`; faucet + 4 debug routes → hard prod block (`isProd()`); 3 bot routes → `testHelpersEnabled()`; StagingMintButton hidden in prod. Backward-compatible (staging unchanged). **Prod env to set: `PAYMENTS_ENABLED=true`; leave `TEST_HELPERS_ENABLED` unset.**
- ✅ **Bare staging URLs env-driven DONE** — 12 direct-use consts wrapped (9 Go-API → `NEXT_PUBLIC_STAGING_DRAFTS_API_URL`; 3 site → `NEXT_PUBLIC_SITE_URL`, incl. `deploy-bbb4v2` baseURI). Fallback-defaults correctly left alone (founderGrant/draftApi/messages/4 admin routes were already env-driven). **Prod env to set: `NEXT_PUBLIC_STAGING_DRAFTS_API_URL`=prod Go API, `NEXT_PUBLIC_SITE_URL`=https://sbsfantasy.com.**
- ⬜ Remaining URL bits (lower priority): `db-json:240` (mock db, not prod) + coinbase redirect fallbacks (moot — Coinbase dropping). [`db-firestore:183` referral link now FIXED — see below.]

#### ✅ ADDED 2026-06-21 (continued session — all build-verified, staging byte-identical)
- ✅ **Season year → 2026 DONE + DEPLOYED** (Go rev `00158-gkf`, traffic routed, live-smoke-tested: real draft created `2026-paid-draft-6`, both bots same league = no empty-league spawn). One `seasonYear` const in `models/leagues.go` drives all 3 draft-id spots (can't half-change); dead `currentSeason` synced to 2026. Player data already 2026 (`playerStats2026`). **→ SUPERSEDES the "Season year = 2024 BIGGEST blocker" item below — RESOLVED.** StartDate/EndDate left at 2024 = deferred (only matters at scoring; real: contest starts **Sept 4** = NFL wk1, ends wk17). **Prod: hit `/staging/reset-draft-counter` so prod drafts start at #1.**
- ✅ **Backend-URL prod-gated fallback DONE** (`lib/staging.ts`): `isProd() ? '' : <staging default>` → a forgotten `NEXT_PUBLIC_STAGING_*` in prod FAILS LOUD in QA instead of silently serving prod off the staging backend. Staging byte-identical (isProd false in staging).
- ✅ **BBB4 deploy route prod-ready** (`admin/deploy-bbb4v2`): staging-only lock → allows prod (still admin + wallet-lock gated); name/symbol env-driven. **🔑 Prod collection name = "Banana Best Ball IV"** (Boris) → set `BBB4_COLLECTION_NAME='Banana Best Ball IV'` (+ optional `BBB4_COLLECTION_SYMBOL`). **CONTRACT VERSION PROVEN:** on-chain runtime bytecode of staging `0x781B…` (the `bbb4-staging` OpenSea collection) is a **verbatim substring of the repo deploy artifact** → prod deploys the byte-IDENTICAL V2 contract. **Zero "old version" risk.**
- ✅ **Hardcoded-staging sweep DONE:** referral link (`db-firestore:183`) + `sync-cloud-errors` project/services env-driven (staging unchanged). All other Go-API URLs + the 5 admin routes confirmed **already** env-driven. Coinbase staging fallback = harmless `getOrigin` edge case.
- ✅ **HOT WALLET / TREASURY architecture (verified from `SBSDraftPassBBB4V2.sol`):** contract is `Ownable`; `reserveTokens` (EVERY free/paid mint) is `onlyOwner` + auto-signed by the relay → **the owner MUST be a hot EOA, NOT a Gnosis Safe** (a Safe can't auto-sign every mint → minting would stop). `withdrawUSDC()` sends to `owner()`; the skim cron then sweeps hot wallet → `COLD_TREASURY_ADDRESS`. **Prod setup:** new hot EOA = contract owner (key in Vercel **Sensitive**, fund with **Base ETH**, it deploys → becomes owner); **Gnosis Safe = treasury** → set `COLD_TREASURY_ADDRESS`=Safe. **Never import the hot key into a wallet app (EIP-7702 risk).**
- 🆕 **New prod env vars introduced this session:** `BBB4_COLLECTION_NAME` (="Banana Best Ball IV"), `BBB4_COLLECTION_SYMBOL` (optional), `CLOUD_ERROR_SYNC_SERVICES` (prod Cloud Run service names, comma-sep) — all default to staging values when unset, so staging is unchanged.

1. ✅ **Token double-spend (concurrent-join) bug — FIXED + DEPLOYED to staging** (Go rev `00157-cnt`, validated with 4× concurrency tests: one pass → one league, guard fires). The fix lives in `~/sbs-drafts-api-deploy/models/leagues.go` (`AddCardToLeague` — pass-claim now atomic inside the seat transaction). **→ Carry this source to prod** (it's in the deploy dir already). *This was a real, recurring bug — the one that "split a pass across drafts."*

2. 🔴 **ENV-FLAG CONFLICT — sharpens Phase 6/7 (verified in code).** The **same** flag `NEXT_PUBLIC_ENVIRONMENT === 'staging'` gates BOTH the **real money routes that MUST work in prod** (`purchases/card-mint`, `marketplace/relay-buy`, `marketplace/relay-permit`, `marketplace/gas-topup` — they 403 unless env==='staging') AND the **test/abuse routes that MUST be off in prod** (`purchases/staging-mint` faucet, `admin/bots/*`, `admin/deploy-bbb4v2`, `debug/*`).
   → **Do NOT just set `NEXT_PUBLIC_ENVIRONMENT=production`** (Phase 6 line 96) — that **403s all card payments + marketplace**. **Split the flag first** (do on `main`, test on staging): `PAYMENTS_ENABLED='true'` (on staging+prod) for the 4 money routes, and `TEST_HELPERS_ENABLED='true'` (staging only, OFF in prod) for the faucet/bots/debug routes. This also makes Phase 7's "isStagingMode hard-true" rewrite cleaner.

3. **Coinbase FULLY droppable (VERIFIED)** → drop `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`. **Buy/onramp uses MoonPay** (`BuyPassesModal.tsx:91` "Card path = MoonPay only; Coinbase Onramp dormant"); **withdraw is self-custody USDC**. Coinbase touches nothing live — zero breakage.

   **🔑 PROD MINT POLICY (Boris, 06-21):** prod has **NO free/staging mint for users — anywhere.** Specifically:
   - ✅ **Users: paid mint only** — pay ($25 USDC/card) → real on-chain mint (`card-mint` + USDC). Stays (in `PAYMENTS_ENABLED`).
   - ❌ **Remove the free faucet entirely:** `purchases/staging-mint` route **and** the `StagingMintButton` on `app/page.tsx:175` (currently shown via always-true `isStagingMode()`). No button, no route — a real user must never get a free pass.
   - ✅ **Admins keep grant, admin-gated:** `admin/grant-drafts` (`requireAdmin`, `reserveTokensToWallet`), `admin/bulk-grant`, `admin/grant-prize`, `admin/send-usdc` — all `requireAdmin`. STAY in prod, locked to the admin allowlist.
   - **🔑 PASS MODEL (verified):** EVERY pass — free OR paid — is a **real Base NFT** minted via `reserveTokensToWallet` → `BBB4.reserveTokens` (`adminMint.ts:143`). `passType ('free'|'paid')` is just a TAG applied by `registerMintedTokens` (`reconcilePasses.ts:248`); the mint is identical. Wheel free wins mint a real free Base NFT (`wheel/spin/route.ts:427,470`). Paid purchase mints a real paid Base NFT. **Admin grant requirement (Boris):** admins must be able to grant BOTH free and paid real Base NFTs to self/others. `grant-drafts:124` hardcodes `'free'` today → add a `passType` (free|paid) param (ONLY change needed — the mint is the same `reserveTokensToWallet`; no new logic, no risk).

4. **OneSignal push being DROPPED** (→ email/TG/Discord only) → drop `ONESIGNAL_*` from prod env. **VERIFIED SAFE:** the notification dispatch (`lib/notifications/dispatch.ts:20` `Promise.allSettled` + `channels.ts` "never throw — failures come back as a value") runs every channel **independently** — push being unconfigured returns `skip('not configured')` and **cannot block email/TG/Discord**. So for prod: simply **don't set the OneSignal vars** → push skips, draft alerts deliver via email/TG/Discord, and the staging 403 log-spam disappears. No code removal strictly required; zero risk to alerts.
   - **Coinbase removal (offramp) — VERIFIED SAFE too:** withdrawals are **self-custody USDC sends** (`SelfCashOutModal` + `/api/withdraw/preflight` + signed USDC transfer; `prizes/withdraw:116` = "direct (non-Coinbase) offramp"). The CDP `sell-session` is a separate removable feature — dropping `CDP_API_KEY_*` won't break withdrawals. 🔎 **Confirm:** the *buy/onramp* (funding USDC) may still use Coinbase Onramp — decide if that stays or also moves.

5. **3 randomness systems — get each right (they bit before; code is fixed, config is new):**
   - **Draft** type distribution = VRF + Merkle, own contract → covered by Phases 3/4/9.
   - **Wheel spins** = VRF + Merkle, **a SEPARATE contract**, one season-long 100k-spin period (`wheel_periods`, sharded leaves). **ADD to Phase 3/4:** deploy the prod wheel contract + its own Chainlink sub + a fresh season period.
   - **Jackpot-hit promo = the "different" one — NO own contract.** Winner = `sha256(wheel period salt + vrf + 'jp-draw:'+draftId) % paidEntrants`; proof = on-chain **receipt tx** signed by the owner wallet. **It rides on the prod WHEEL VRF period** → set up wheel VRF **before** jackpot draws work. Dependency order: Draft VRF → Wheel VRF → jackpot works for free.

6. **More leaked secrets to rotate (add to Phase 0):** `INFURA_API_KEY` + `ONESIGNAL_REST_API_KEY` are baked **literally in the Go `Dockerfile`** (in git) → rotate + move to Secret Manager. Also `RI_TOKEN` hardcoded in the staging Functions (`updateRosters.js`).

7. **WS server (recommend for prod):** the draft *list* page still opens authenticated WS connections (bypassing `wsEnabled=false`), making the WS server a 2nd autopick engine that can race the canonical one. **Cleanest: don't run the prod WS service** (frontend falls back to the 2.5s poll — zero UX impact), or gate that draft-list connection. Re-evaluate Phase 5's WS deploy with this.

8. **Admin in prod (your ask): ✅ ships automatically** with the frontend — just set `ADMIN_WALLET_ADDRESSES` / `NEXT_PUBLIC_ADMIN_WALLET_ADDRESSES` to the real prod admins (Phase 6) and confirm admin routes load behind the wall (Phase 11).

9. **Privy custom domain** (`privy.sbsfantasy.com`, Phase 10) was *awaiting cert* as of 2026-06-18 — **re-verify it's issued now**: `curl -sS -o /dev/null -w "%{ssl_verify_result}\n" https://privy.sbsfantasy.com/` (0 = done).

10. **Deferred-but-real (your call):** `eligibility` route leaks KYC/geo/Persona-ID with no auth (add auth); `referrals` page white-screens on a backend 500 (3-line guard). Neither is launch-blocking; handle during prod-build testing.

### ✅ FULL VERIFICATION PASS — 2026-06-21 (2 agents + my own checks + live deploys; every doc claim re-checked)

#### ❌ STALE — no longer true; do NOT chase
- **Phase 6 `DRAFTS_API_SERVICE_KEY` ("11 routes 503 without it")** — zero refs in current `lib/`/`app/api` (Caleb auth reverted). Not required.
- **Phase 7 "wheel-odds discrepancy"** — NOT a bug. `lib/api/config.ts:11-18` weights sum to 100; intentional, separate from draft-type 1/5/94.
- **Phase 9 "no VRF restart endpoint exists"** — STALE: a cold-open route DOES exist (`staging/staging.go:36` `merkle-open-next-round` → `PreOpenNextMerkleRound`). Full restart still needs the manual pointer reset + `batch_proofs` delete around it.

#### 🔴 STILL REAL — confirmed against current code (line refs corrected)
- **Season year = 2024 → ✅ RESOLVED + DEPLOYED 2026-06-21 (see ADDED block above; Go rev `00158-gkf`, live-tested).** ~~`constants/contests.go:3` `currentSeason="2024"`;~~ — historical refs below kept for context only: `models/leagues.go:234,328,362` key `2024-…-draft`; StartDate/EndDate `:239-240` = 2024 NFL schedule; `staging/staging.go` uses `2025-…`. **And the draft engine REQUIRES `playerStats2026`** (`owner/owner.go:342`, `models/players.go:77,92,130`, `draft-state.go:360,425`) → **live mismatch:** players read 2026, leagues keyed 2024. Set ALL season refs to 2026/dynamic + load `playerStats2026` in prod Firestore.
- **Env-flag (money routes 403 in prod):** `card-mint:68`, `relay-buy:79`, `relay-permit:31`, `gas-topup:53` all `403 unless NEXT_PUBLIC_ENVIRONMENT==='staging'`; **`.env.production:26` sets it to `prod`** → all 4 money routes 403 in prod today. **Split the flag** (`PAYMENTS_ENABLED` vs `TEST_HELPERS_ENABLED`). THE keystone.
- **USDC treasury = zero address** (`lib/api/config.ts:32`, throws `:57-63`) → set to prod Gnosis Safe.
- **`isStagingMode()` hard-returns true** — line moved to `lib/staging.ts:28-49` (doc said 18-39). Prod rewrite needed.
- **`.env.production:16` `NEXT_PUBLIC_DATABASE_URL` → staging RTDB** (+ `firebaseAdmin.ts:76` falls back to staging). Repoint to prod.
- **Env-key mismatch:** code reads `NEXT_PUBLIC_APP_ID` (`lib/api/firebase.ts:44`) but `.env.production:20` sets `NEXT_PUBLIC_FIREBASE_APP_ID`. Align or Firebase app id is empty.
- **Leaked staging SA** inlined `lib/firebaseAdmin.ts:20` (doc said :19). Rotate + remove (Phase 0).
- **`StagingMintButton` on home** (`app/page.tsx:175`) gated only by `isStagingMode()` → shows in prod. Gate by env.
- **`app/api/upload/route.ts:8`** bucket = staging; **`crons/sync-cloud-errors/route.ts:61`** PROJECT_ID = staging. Repoint.
- **Owner routes no auth** (`owner/use-pass:32`, `refund-pass`, `team-nicknames:14` — comment admits "tighten before prod"). Add auth.
- **`purchases/create`+`verify` present** (delete), **`debug/crisp-check`**+**`admin/revoke-7702`** present (remove).
- **No automated prize pipeline** — only admin `grant-prize`/`bulk-grant`/`import-winners`; winners see $0 until manual. Decide.
- **Draft-list page still opens WS** (`useDraftingPageState.ts:1262`, hardcoded staging WS `:1202`) — don't run prod WS, or gate it.

#### 🆕 NEW staging leaks NOT in the 06-18 body (found this pass — important)
- **⚠️ `admin/deploy-bbb4v2/route.ts:18` `BASE_URI = banana-fantasy-sbs.vercel.app/api/nft/metadata/`** → `setBaseURI` at `:86`. **If the prod contract is deployed via this route UNEDITED, prod NFTs get STAGING metadata URLs.** Edit BASE_URI to prod before the contract deploy.
- **Bare-const staging URLs (no env override → need code edits):** `lib/draftApi.ts:13`, `lib/founderGrant.ts:28`, `lib/friends.ts:289` (staging Go API); `app/api/referrals/route.ts:21` + `lib/db-firestore.ts:714` `REFERRAL_SITE_URL` + `coinbase/{sell,buy}-session` redirects (staging site URL). The `NEXT_PUBLIC_*_URL || staging` ones self-heal from env; **these bare consts do not.**
- **40+** `sbs-drafts-api-staging` fallbacks total (doc said ~14) — audit all before flip.
- (Good news: **no** `w5wydprnbq`/`sbs-prod-env` hardcoded Go-host fallback found — the "silently hits old prod" class is contained to leaving `NEXT_PUBLIC_DRAFTS_API_URL` unset.)

#### ✅ CONFIRMED GOOD (independently re-verified)
- **Token double-spend fix present & correct** in `sbs-drafts-api-deploy/models/leagues.go:358,383,425,435,438` (atomic seat+claim; reads-before-writes valid).
- **3 randomness systems exactly as described:** draft = VRF+Merkle own contract (`batchproof/`, `system_config/batchProofMerkle`); wheel = SEPARATE contract+period (`system_config/wheelProof`, `BananaWheelProof.sol`, `wheel_periods`); jackpot-hit = wheel period salt + receipt tx, **no own contract** (`lib/jackpotDrawProof.ts:65-70,117`), legacy `sha256('jp-draw:'+draftId)` is fallback ONLY. Dependency order (Draft VRF → Wheel VRF → jackpot) confirmed.
- **SLOT-0 floor fixes present** (`capture-draft-data:75,78`, `notification-counts:409,412`, proof-feed paths are `app/api/drafts/proof-feed/route.ts:89` + `/stream:105` — doc path was wrong).
- **`contracts/*.sol` present:** `SBSDraftPassBBB4V2`, `BBB4BatchProofMerkle`, `BBB4BatchProofVRFCommit`, `BananaWheelProof`, `BananaWheelAssignmentJournal`.

#### 🔎 DEPLOYMENT REALITY (verified live via gcloud/gh)
- **Prod backends already EXIST** in `sbs-prod-env`: `sbs-drafts-api` + `sbs-drafts-server` (running OLD retired code — old `/league/batchProgress`→404). Launch = **redeploy current code onto them** with prod env, not build from scratch.
- **`production` branch is BEHIND `main`** (`fadf36…` vs `70f83f…`) → push `production`→`main` HEAD at launch (incl. the token fix once on main).
- **`~/sbs-drafts-api-deploy` has a `.git` again** (re-init'd 06-20 21:15) — MEMORY says it was reset to a plain folder; reconcile git state before deploy. Working tree has the token fix regardless.

**Prod infra ALREADY in place (verified live 2026-06-21 — check these off):**
- ✅ Prod **VPC connector** `prod-drafts-vpc` = READY (Phase 1).
- ✅ Prod **Secret Manager** `sbs-prod-config` + `redis-url-prod` exist (Phase 1).
- ✅ **Privy cert ISSUED** — `privy.sbsfantasy.com` TLS OK (`ssl_verify=0`) (Phase 10 — was "pending 06-18", now done).
- ✅ **`sbsfantasy.com` → Vercel** (76.76.21.21, HTTP 200, serving the wall) (Phase 10 DNS — done).
- 🔎 Prod **Redis instance** — `redis-url-prod` secret exists but the instance didn't list; confirm it's READY before the WS deploy (Phase 1).

---

## ENVIRONMENT TOPOLOGY (the system, for reference)

| | Staging | Production |
|---|---|---|
| Frontend (Vercel) | project `banana-fantasy` → `banana-fantasy-sbs.vercel.app`, deploys from `main` (`~/ship.sh`) | project `sbs-prod` → `sbsfantasy.com`, deploys from **`production` branch ONLY** |
| GCP project | `sbs-staging-env` (652484219017) | `sbs-prod-env` (671861674743) |
| Go Drafts API | `sbs-drafts-api-staging` | `sbs-drafts-api-w5wydprnbq` |
| WS server | `sbs-drafts-server-staging` | `sbs-drafts-server-w5wydprnbq` |
| Firebase RTDB | `sbs-staging-env-default-rtdb` | `sbs-prod-env-default-rtdb` |
| BBB4 contract | `0x781B…D73F` (staging) | **NEW prod deploy (TBD)** |

**Golden rule:** same code everywhere; staging vs prod differ ONLY by environment variables. Never fork the codebase.
**NEVER** set `sbs-prod` Production Branch to `main`. **NEVER** point `sbsfantasy.com` at the staging project.

---

## PHASE 0 — SECURITY PRE-FLIGHT (do first, blocks everything)

- [ ] ⚠️ **Rotate leaked SA key #1** — `firebase-triggers@…` leaked in `~/sbs-drafts-api-deploy` git history. GCP Console → IAM → Service Accounts → new JSON key → update Functions/triggers creds → delete old key.
- [ ] ⚠️ **Rotate leaked SA key #2** — `firebase-adminsdk-fbsvc@sbs-staging-env`, was inlined as `STAGING_SA_B64` in `lib/firebaseAdmin.ts:19` **and** committed in `.env.production` (commit `bc7a6c63`). New JSON key → set as Vercel `FIREBASE_SERVICE_ACCOUNT_JSON` → delete old key.
- [ ] **Remove the hardcoded SA** from `lib/firebaseAdmin.ts:19` (`STAGING_SA_B64`); remove SA JSON from committed `.env.production`. Inject prod SA via env ONLY, never committed.
- [ ] Confirm `configs/prodServiceAccount.json`, `triggersServiceAccount.json`, `sbs-prod-env-firebase.json` in the deploy repo are **gitignored** (and rotated).
- [ ] Confirm `.env.local` (with `X_BEARER_TOKEN`, `OPENSEA_API_KEY`, Alchemy key) is gitignored and never bundled. Treat those keys as exposed if it ever left the machine.

---

## PHASE 1 — PROD INFRA PROVISIONING (Console/owner — the Firebase SA *cannot* create infra)

- [ ] **Prod VPC connector** created in `sbs-prod-env` (WS server needs it).
- [ ] **Prod Redis instance** READY + reachable (`REDIS_URL`); WS 503 = Redis unreachable.
- [ ] **Secret Manager `sbs-prod-config`** (project 671861674743) exists + populated; prod SA has `secretmanager.versions.access`.
- [ ] ⚠️ **Prod Chainlink VRF subscription** created + **funded (LINK)**, and the prod Merkle contract **added as a consumer** (do after Phase 3). Unfunded/missing consumer = every batch reverts.
- [ ] Set `INFURA_API_KEY` for prod (currently empty in `Dockerfile.prod` — via Secret Manager or env).

---

## PHASE 2 — 2026 SEASON DATA (⚠️ data task, NOT a string swap — Richard/data-side)

Draft ids are `{YEAR}-{fast|slow}-draft-{slot}`, YEAR = NFL season. Currently hardcoded & **inconsistent** (`contests.go`=2024, `leagues.go`=2024, `staging.go`=2025, `seasonConfig`=2025). For a 2026 contest, set ALL consistently:

- [ ] Draft-id prefix + `const currentSeason` → 2026 (best: dynamic `time.Now().Year()`).
- [ ] `models/leagues.go` StartDate/EndDate → 2026 NFL schedule dates.
- [ ] ⚠️ **`playerStats2026` LOADED** (only 2023/2024/2025 exist now).
- [ ] `2026DraftPlayoffData` loaded; `seasonConfig` year + `staging.go` prefix aligned.
- [ ] Verify the deploy repo's "2026 season" reconcile actually set these (a recent commit suggests it's in progress — confirm real values).

---

## PHASE 3 — CONTRACTS (deploy fresh on Base mainnet)

### BBB4 NFT draft-pass contract
- [ ] Deploy FRESH prod contract from `contracts/SBSDraftPassBBB4V2.sol` (real prod name) via one-time admin route `app/api/admin/deploy-bbb4v2/route.ts` (change staging-only guard for prod; deploy runs server-side, key `BBB4_OWNER_PRIVATE_KEY` is Sensitive in Vercel).
- [ ] Init: setBaseURI + flipMintState ON + smoke-mint token **#0** to admin (first real mint = #1) + verify conduit auto-approve.
- [ ] ⚠️ **DELETE the deploy route after use.**
- [ ] Verify on-chain: name, owner, `mintIsActive`, `TOKEN_PRICE_USDC`=$25, `isApprovedForAll(any, OpenSeaConduit 0x1E00…3c71)===true`, kill-switches.
- [ ] ⚠️ Admin wallet `0xccdF…441D` health: `eth_getCode(admin)` must return `0x` (NOT `0xef0100…` — a 7702 delegation marker breaks the 3-step mint). Never import the admin key into any wallet app.
- [ ] Confirm admin-mint gas adapts to live Base base fee (`resolveGasParams`, not a fixed 0.1 gwei cap) + admin wallet ETH balance monitored.

### Merkle batch-proof / VRF contract (independent of the NFT contract)
- [ ] Deploy the Merkle batch-proof contract fresh on Base mainnet as prod owner. Save contractAddress, vrfCoordinator, vrfSubscriptionId, vrfKeyHash, deployTxHash, owner.
- [ ] ⚠️ Triple-check the VRF subscription ID on copy (a single missing digit previously bricked all batches).

---

## PHASE 4 — PROD FIRESTORE CONFIG + RULES

- [ ] Write `system_config/batchProofMerkle` in PROD Firestore (all the contract config from Phase 3).
- [ ] Set `system_config/batchProof.contractVariant = "vrf-commit-merkle"` in PROD Firestore.
- [ ] ⚠️ **Deploy prod RTDB rules** (`database.rules.json`) — rules do NOT copy across projects. Must include `.read` for **every** field the frontend live-subscribes (esp. `drafts/{id}/realTimeDraftInfo` which now carries live draft type). Missing `.read` = silently denied → "data doesn't exist." Verify with unauth `curl …/drafts/<id>/realTimeDraftInfo.json`.
- [ ] **Deploy prod Firestore rules** to `sbs-prod-env`.

---

## PHASE 5 — DEPLOY 3 BACKENDS TO PROD (all three, not just the Go API)

- [ ] **Go Drafts API** → `sbs-drafts-api-w5wydprnbq` with prod env vars: `PRIVY_APP_ID` (prod), `ADMIN_API_KEY` (must match Vercel `DRAFTS_API_ADMIN_KEY`), `BBB4_OWNER_PRIVATE_KEY`. After deploy set `PROD_API_URL` via `gcloud run services update`.
- [ ] **WS server** → `sbs-drafts-server-w5wydprnbq` (port 8000, `--vpc-connector`, `--min-instances 1`, `REDIS_URL`). ⚠️ NOT git-tracked — confirm exact source before deploy.
- [ ] **Firebase Functions** (`~/sbs-staging-functions/`) → deploy via firebase CLI targeting `sbs-prod-env`. ⚠️ NOT git-tracked — confirm contents.
- [ ] ⚠️ **VERIFY traffic on the NEW revision for BOTH Cloud Run services** — deploy silently leaves traffic on the old revision. Run `gcloud run services update-traffic <svc> --to-latest` on both. Verify: `gcloud run services describe <svc> --format="value(status.traffic[0].revisionName)"`.

---

## PHASE 6 — PROD VERCEL ENV VARS (`npx vercel env add VAR production`)

⚠️ Fail-loud helpers crash startup if any required var is missing — that's the backstop, set them all.

- [ ] `NEXT_PUBLIC_ENVIRONMENT=production`
- [ ] `NEXT_PUBLIC_APP_URL=https://sbsfantasy.com` + `NEXT_PUBLIC_SITE_URL=https://sbsfantasy.com` (else referral links, NFT baseURI, OG images, Coinbase redirects default to the staging vercel domain)
- [ ] `NEXT_PUBLIC_DRAFTS_API_URL` → **NEW prod Go API** (and `NEXT_PUBLIC_STAGING_DRAFTS_API_URL` if that's what resolves — see Phase 7)
- [ ] `NEXT_PUBLIC_DRAFT_SERVER_URL` → prod WS (`wss://sbs-drafts-server-w5wydprnbq…`)
- [ ] `NEXT_PUBLIC_DATABASE_URL` → **prod RTDB** (`sbs-prod-env-default-rtdb`) — fix the `.env.production` mismatch where it points at staging
- [ ] `NEXT_PUBLIC_SBS_API_URL` → prod Firebase Functions (withdrawal service)
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` → **rotated prod SA**
- [ ] `NEXT_PUBLIC_PRIVY_APP_ID` + `PRIVY_APP_ID` + `PRIVY_APP_SECRET` + `PRIVY_JWT_ISSUER` → all the **prod** Privy app (they must switch together or auth silently breaks)
- [ ] ⚠️ `DRAFTS_API_SERVICE_KEY` — **CRITICAL: 11 core routes 503 unconditionally without it** (draft pick, league join/leave, buy/mint, queues, admin). Set a random 64-hex. Keep `DRAFTS_API_AUTH_ENABLED` OFF at launch.
- [ ] `BBB4_OWNER_PRIVATE_KEY` (Sensitive), `DRAFTS_API_ADMIN_KEY`, `ADMIN_WALLET_ADDRESSES` (real admins only), `CRON_SECRET` (else all 11 crons 401), `ALCHEMY_WEBHOOK_SIGNING_KEY`, `DIDIT_WEBHOOK_SECRET`, `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` (WSS-capable for USDC-arrival watch), `OPENSEA_API_KEY`, `CDP_API_KEY_*`, KYC/email/push/support secrets.
- [ ] Prelaunch trio: `PRELAUNCH_MODE=true`, `PRELAUNCH_BYPASS_KEY=sbs_XCNIc_ULhnxgFFoN09olMQc6` (rotate post-launch), `NEXT_PUBLIC_LAUNCH_AT=2026-06-23T16:20:00-07:00`.
- [ ] Fix env-key name bug: client reads `NEXT_PUBLIC_APP_ID`, `.env.production` sets `NEXT_PUBLIC_FIREBASE_APP_ID` — align them.
- [ ] Ensure `NEXT_PUBLIC_MOCK_AUTH` / `USE_MOCK_DATA` are NOT set/true in prod.

---

## PHASE 7 — CODE CHANGES FOR PROD

- [ ] ⚠️ **`isStagingMode()` (`lib/staging.ts:18-39`) hard-returns `true`** (server + client) — the master switch wiring the whole app to the staging backend. `isLive = isStagingMode() && !!walletAddress`, so live-drafting is gated on it. **Needs a deliberate prod rewrite, not just a flag flip** — repoint `NEXT_PUBLIC_STAGING_DRAFTS_API_URL` at prod OR restore env-based detection, and make sure live-draft mode stays on.
- [ ] ⚠️ **Backend-URL rule:** NEVER put `NEXT_PUBLIC_DRAFTS_API_URL` / `NEXT_PUBLIC_DRAFT_SERVER_URL` in a fallback chain. Audit every server-side resolver so none silently resolves to the OLD prod `w5wydprnbq` URL (the "looks deployed, returns empty" class). The prod meaning of these vars flips — confirm they point at the new prod backends.
- [ ] **Swap contract address (single source of truth):** edit `lib/contracts/bbb4.ts → DEFAULT_BBB4_CONTRACT_ADDRESS` only. Do NOT set `NEXT_PUBLIC_BBB4_CONTRACT` env override. Then update `COLLECTION_SLUG` (`lib/opensea.ts`), `app/security/blockaid/page.tsx`, `scripts/backfill-index-from-drafttokens.mjs`, both CLAUDE.md files. `grep -rn 0x781B2E6f` → zero stale refs. `npm run build`.
- [ ] **Set USDC treasury** `toAddress` (`lib/api/config.ts:32`) — currently the zero address (payments throw until set).
- [ ] **Repoint hardcoded staging refs:** `lib/firebaseAdmin.ts:12` (STAGING_RTDB_URL), `app/api/drafts/league-players/route.ts:63,94`, `app/api/crons/sync-cloud-errors/route.ts:61` (PROJECT_ID), `app/api/upload/route.ts:8` (bucket), `sbs-staging-pfps` bucket refs, and the ~14 hardcoded `sbs-drafts-api-staging` URL fallbacks in `app/api/{standings,leaderboard,rankings,prizes,...}` + `lib/{nftPassClassify,specialDraft,founderGrant,db-firestore}`.
- [ ] ⚠️ **SLOT-0 fixes present in prod build:** the first prod draft is slot 0 (`2026-…-draft-0`). Scanners flooring at `Math.max(1,…)` make it invisible → proof feed empty AND **capture cron never makes Team #1's card** (grey pass). Confirm floor→0 fixes in: proof-feed, proof-feed/stream, capture-draft-data cron, admin/notification-counts. Set `merkle_rounds/1.firstBatchNumber=1` on prod.
- [ ] **Gate/remove staging-only scaffolding:**
  - `StagingMintButton` on home (`app/page.tsx:175`) — gated only by `isStagingMode()` (always true) → shows in prod. Gate by env, not staging-mode.
  - StagingBanner must be hidden in prod.
  - Remove `/api/debug/crisp-check` (temp). Confirm `/api/debug/*`, `/api/purchases/staging-mint`, relay routes are correctly `NEXT_PUBLIC_ENVIRONMENT`-gated.
  - Remove `app/api/admin/revoke-7702` (one-off). Confirm `app/api/purchases/create`+`/verify` (legacy card path with `test_`-token bypass + "TODO real processor") is dead/deleted.
  - Prune test wallets from `lib/switchWalletAllowlist.ts`, `lib/userRoster.ts`, `lib/adminAllowlist.ts` fallback.
  - Ensure `scripts/_*.mjs` (esp. destructive wipe/deploy scripts) can't be pointed at prod creds and don't leak via ship.sh.
- [ ] Tighten CORS: the `*.vercel.app` wildcard (`middleware.ts:14`) is broad for prod — consider restricting.
- [ ] Resolve wheel-odds discrepancy: `lib/api/config.ts` weights = JP 1% / HOF 2% vs CLAUDE.md authoritative **1% JP / 5% HOF / 94% Pro**. Confirm correct.
- [ ] ⚠️ **Owner routes trusting body `walletAddress` without Privy auth:** `owner/use-pass`, `owner/refund-pass`, `owner/team-nicknames` — add server-side auth before real volume.

---

## PHASE 8 — DATA WIPE/SEED (only if prod inherits any draft history — a brand-new prod project is mostly a no-op)

- [ ] ⚠️ **recursiveDelete rule:** any collection with subcollections (esp. `drafts`) MUST be cleared with `wipeCollectionRecursive()` (listDocuments + `db.recursiveDelete`), NEVER doc-level batch delete (that orphaned 2,507 ghost drafts). Verify post-wipe with `listDocuments().length`.
- [ ] WIPE: `drafts` (keep `draftTracker`) + RTDB `drafts/`, `draftTokens`, `draftTokenMetadata`, `marketplace_index`, `pass_origin`, `nft_league_map`, per-wallet `validDraftTokens`/`usedDraftTokens`, per-user `promos`/`badges`/`draftHistory`/`standings`, `active_offers`/`active_listings`/`marketplace_activity`/`marketplace_watchlist`, `v2_queues` (reset `rounds:[]`, keep docs).
- [ ] RESET TO 0 every account: `draftPasses` **AND `freeDrafts`** (separate field — header shows the sum) AND `jackpotEntries`; `draftTracker.FilledLeaguesCount=0`. Recompute via `recountFromInventory`.
- [ ] ⛔ **NEVER delete:** `cards`/`cardMetadata` (Genesis), `playoffCards*`, `scores`/`stats`/`playerStats*`, `2023DraftTokens*`, **financial/winnings** (`transactions`, `withdrawalRequests`, `claims`, `v2_purchases`, `bbb4_usdc_sweeps`, `onramp_attempts`, `kyc_attempts` — real unclaimed ETH lives on `draftTokens.Prizes.ETH`), all logs, `system_config`, `merkle_rounds`, `batch_proofs`, wheel collections, `web2_social_identities`, `v2_users`, `owners`. Always dry-run first; no PITR, irreversible.
- [ ] **marketplace_index** — never direct-bulk-write; heal only via `POST /api/marketplace/refresh-draft/{draftId}`.
- [ ] **One-time web2 returning-user import:** run `~/pull-web2-users.sh` pointed at prod (Boris via `!`, prod-read guard) → populates `web2_social_identities` (503 old-prod users). Keep `~/web2-social-users.json` out of repos (PII).

---

## PHASE 9 — VRF BOOTSTRAP / RESTART

- [ ] **Fresh prod env (clean bootstrap):** round 1 cold-opens automatically on the first draft; set `merkle_rounds/1.firstBatchNumber=1`. Verify `merkle_rounds/1` reaches `merkleCommitted` (10k leaves + on-chain root match) within minutes.
- [ ] ⚠️ **Only if prod inherits a partially-revealed round** (staging-style): the first ~500 draft types are predictable → MUST restart. No restart endpoint exists. Safe procedure (coordinate with Richard or add+delete a small atomic admin route): (a) `PreOpenNextMerkleRound` cold-opens a NEW round number, (b) set `merkleRoundState={currentRoundNumber:<new>, nextBatchIndexInRound:0}`, (c) delete `batch_proofs/*`, (d) verify new round `merkleCommitted`. Do NOT hand-edit state alone (`ensureRoundCommitted` guards inconsistent state). Confirm-before-deploy on-chain.
- [ ] Counter recovery if `draftTracker` wiped: `merkleRoundState`→(R,B); `merkle_rounds/R.firstBatchNumber`=F; est `FilledLeaguesCount≈(F+B)*100` → skip-draft-counter to estimate.

---

## PHASE 10 — DNS + PRIVY DOMAIN (de-risk early, NOT launch day)

- [ ] Add `sbsfantasy.com` + `www` in `sbs-prod` Vercel Domains tab → paste the A/CNAME into GoDaddy. Vercel auto-issues SSL.
- [x] ✅ **Privy custom auth domain** `privy.sbsfantasy.com` CNAME → `cmorgobsv00a50cjwqzyuao2z.api.privy.systems` (resolving).
- [x] ✅ **Privy App-domain TXT** `_acme-challenge.privy` = `WjYO45K2x14Bt4fV0QUsizSQcK1YO1RqpRUTviIgoFQ` — **typo fixed 2026-06-18** (was lowercase `l`, now capital `I`), verified byte-exact at authoritative NS. ⏳ awaiting Privy cert issuance (re-check: `curl -sS -o /dev/null -w "%{ssl_verify_result}" https://privy.sbsfantasy.com/` → 0 = done).
- [ ] ⚠️ **This Privy domain is the fix for the mobile-Safari web2 signup bug** (first-party cookies). Only takes effect when the app is served from `sbsfantasy.com`. Verify mobile signup works on the real domain (behind the wall) before launch.

### Going-forward staging system (set up once)
- [ ] Add `staging.sbsfantasy.com` → staging Vercel project (same-site with `privy.sbsfantasy.com` → real first-party cookies, matches prod behavior).
- [ ] **Make staging private:** reuse the `PRELAUNCH_MODE` wall + bypass key on the staging project (or Vercel password protection) — `staging.*` is publicly enumerable via Certificate Transparency, so "no one will guess it" is not security.
- [ ] Add both `sbsfantasy.com` and `staging.sbsfantasy.com` to Privy allowed origins.

---

## PHASE 11 — FUNCTIONAL QA ON HIDDEN PROD (via `sbsfantasy.com/enter?key=…`, mobile + desktop)

- [ ] **Login parity:** web2 (Gmail/X embedded) AND web3 (external wallet) both → clean `/r/Name` referral, claim promo/spin, real-time bells synced to a 2nd device.
- [ ] ⚠️ **Mobile Safari web2 signup** works on the real domain (the bug this whole DNS effort fixes).
- [ ] **Buy:** card (MoonPay, sandbox off) AND USDC-on-Base — pass mints, balance updates, USDC-arrival watch fires.
- [ ] **Draft:** lobby → fill (bots) → live draft → type reveal → Team card appears on Teams + Marketplace (esp. **Team #1 / slot 0**).
- [ ] **Wheel:** spin on the real VRF/Merkle period → proof page valid → JP/HOF badge/pass.
- [ ] **Marketplace:** list/buy/offer (gasless), newest teams visible (watch the stale-low-supply latent risk on a fresh contract).
- [ ] **Winnings:** verify (Didit/Persona, W9 at $2k+) → withdraw. ⚠️ **Launch gap:** no automated win→prize-record writer — winners show $0 until an admin `grant-prize`. Decide: build the writer or run manual admin grants.
- [ ] **Bells/notifications** real-time + no duplicates; **JP/HOF reveal**; **founder-draft** flow.
- [ ] **Prelaunch gate** itself: public sees `/coming-soon`, `/api/*` 404s, `/enter?key=` lets you in, `/exit` clears.
- [ ] Keep `/api/crons/audit-integrity` running on prod (pass-counter vs spendable; money/fairness).

---

## PHASE 12 — LAUNCH FLIP (Tuesday)

- [ ] Move `production` branch to the desired sha (or fire the prod deploy hook); confirm Vercel built.
- [ ] Flip `PRELAUNCH_MODE=false` on `sbs-prod` → redeploy.
- [ ] Smoke-test the public path immediately (login + buy + draft) on phone AND desktop.
- [ ] **Rollback plan:** flip `PRELAUNCH_MODE=true` → instant. Cloud Run rollback = `update-traffic` to previous revision (WS server has no git source — traffic rollback only).

---

## ⚠️ KNOWN LAUNCH GAPS / RISKS (decide before flip)

1. **No automated prize pipeline** — winners see $0 until manual admin `grant-prize`. No Go `/owner/{id}/prizes` endpoint.
2. **No Go season-scoring endpoints** (leaderboard/prizes/standings 404 — same on old prod).
3. **Backend-URL fallback** silently hitting OLD prod `w5wydprnbq` = empty data (highest "looks fine, returns nothing" risk).
4. **Capture cron** higher prod risk under many unattended/auto drafts (fix gates on `isDraftClosed` — confirm present).
5. **Privy pinned exact 3.28.0; lockfile removed** (peer conflicts) — regen with Richard pending.
6. **Render-loop self-DDoS** rule — no Privy-derived callback in a fetch-`useEffect` dep array. Cap deploys 2–3/hr.
7. **Owner-wallet multisig handoff** recommended before prod volume.

---

## OPEN ITEMS (as of 2026-06-18)
- [ ] Privy `privy.sbsfantasy.com` cert issuance (TXT fixed; awaiting Privy).
- [ ] 2026 season data loaded (Phase 2).
- [ ] Decide prize-pipeline: automated writer vs manual grants.
- [ ] Caleb backend PR#2 live + phone+desktop smoke test (~10% confidence remaining).
- [ ] Final launch TIME confirmed (code = 4:20pm PT).
- [ ] Privy lockfile regen with Richard.

*Built 2026-06-18 from a 4-pass audit of the staging codebase, memory, and backend/contract/VRF/data layers. Verify each item live before acting — this is real money.*
