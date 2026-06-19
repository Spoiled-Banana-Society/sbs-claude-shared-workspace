# 🍌 SBS Fantasy — PROD LAUNCH CHECKLIST (BBB4)

**Launch target:** Tue 2026-06-23, 4:20pm PT (`NEXT_PUBLIC_LAUNCH_AT=2026-06-23T16:20:00-07:00`)
**Strategy:** Stand up the FULL real app at `sbsfantasy.com` behind the prelaunch wall (`PRELAUNCH_MODE=true`), test everything privately via `/enter?key=…`, then launch = flip `PRELAUNCH_MODE=false`. No DNS change or migration at launch moment — all risk de-risked days early.

**How to use:** Work top-to-bottom; phases are dependency-ordered. `[ ]` = todo. ⚠️ = real-money risk, do not skip. Every "verify" step must actually pass before moving on. This is a real-money launch — nothing done "from memory," everything verified live.

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
