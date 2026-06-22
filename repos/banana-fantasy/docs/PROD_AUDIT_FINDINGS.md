# 🔍 PROD vs STAGING — AUDIT FINDINGS (for Richard)

**Date:** 2026-06-22 · **Method:** direct reads of the live prod stack (Vercel env + deployed bundle, prod Firestore + RTDB via the `sbs-prod-env` service account, RTDB rules API, Cloud Functions / Cloud Run / Privy APIs). Every item below was read from **real prod**, not inferred. Frontend **code is provably identical to staging** (git SHA diff = 1 env-driven line in `lib/opensea.ts`), so there are **no per-page code bugs** — every gap is **config / data / infra**.

> Scope note: this is a **structural** audit (dependencies verified wired), **not** a live transaction test. A single real mint+reveal+draft on prod is still required to fully validate the on-chain path.

---

## ✅ SECTION A — CONFIRMED ISSUES (100%, must fix)

### A1. `system_config` is EMPTY in prod — the entire on-chain reveal/wheel system is uninitialized (read twice, 0 docs)
Staging has 6 docs, prod has **none**: `batchProof`, `batchProofMerkle`, `merkleRoundState`, `wheelProof`, `wheelAssignmentJournal`, `wheelPeriodState`.
**Proven impact:** `getWheelProofContractAddress()` returns null; `drafts/[draftId]/merkle-proof`, `proof-feed`, and the wheel routes all read missing docs.
**Breaks:** team **reveal/cards**, the **wheel**, **spin promo**, drafting **merkle proofs**.
**This is the biggest one and needs the owner wallet (gas) + LINK.** `BBB4_OWNER_PRIVATE_KEY` is already set on prod Vercel ✅. Do it in this order:

**STEP 1 — Chainlink VRF (do this FIRST; the contracts can't deploy without it).** ⛓️ *This is the "VRF stuff."*
The reveal + wheel contracts use Chainlink VRF v2.5 for on-chain randomness. On staging, `system_config/batchProof` shows a `vrfCoordinator`, `vrfSubscriptionId`, and `vrfKeyHash`. Prod needs its **own**:
  1. Go to **vrf.chain.link** → **Base** network.
  2. Create **2 subscriptions** — one for **batch-proof/reveal**, one for the **wheel** (they're separate).
  3. **Fund each with LINK** (a few LINK each — these are real LINK tokens, a real cost).
  4. Record, for each: the **subscription ID**, the **Base VRF coordinator** address, and a **keyHash** (gas lane).

**STEP 2 — Deploy the 4 contracts via the admin pages** (each writes its `system_config` doc; uses `BBB4_OWNER_PRIVATE_KEY`; needs Base ETH for gas):
  - **Deploy BatchProof VRF** → pass `{vrfCoordinator, subscriptionId (reveal one), keyHash, initialOwner}` → writes `system_config/batchProof`
  - **Deploy BatchProof Merkle** → writes `system_config/batchProofMerkle` + `merkleRoundState`
  - **Deploy Wheel Proof** → pass the **wheel** subscription → writes `system_config/wheelProof`
  - **Deploy Wheel Assignment Journal** → writes `system_config/wheelAssignmentJournal` + `wheelPeriodState`

**STEP 3 — Back in the Chainlink VRF dashboard:** add each deployed contract address as a **"Consumer"** of its subscription, and confirm the subscription is LINK-funded. (The contracts can't request randomness until they're added as consumers.)

✅ Done when: prod `system_config` has all 6 docs, and both VRF subscriptions show the contracts as funded consumers.

### A2. RTDB security rules don't match — prod missing 2 read paths
Prod rule paths: `drafts`, `userEvents`. Staging also has `presence` and `globalChatPing`. **Prod is missing those two.**
**Proven impact:** frontend subscribes to `/presence` (`lib/api/firebase.ts:336`, online-dot indicator) and `/globalChatPing` (`:356`). With no `.read` rule, prod **silently denies** these (your 2026-06-20 incident pattern).
**Breaks:** online/presence indicators + global-chat ping.
**Fix:** deploy prod RTDB rules to match staging (add the `presence` + `globalChatPing` read rules). `firebase deploy --only database` against `sbs-prod-env`, or paste them in the Firebase console.

### A3. Firebase Functions — new-system functions not deployed to prod
Read the live function list on both projects via the Cloud Functions API. Staging runs them; prod's list does **not** include these four:
- **`onDraftFilled`** — fires when a draft fills (draft-completion handling)
- **`scheduledUpdateADP`** — cron that refreshes player ADP data
- **`scheduledUpdateRosters`** — cron that refreshes rosters
- **`sbs-error-sink`** — error-logging sink

(`onPickAdvance` + `onQueueUpdate` DO exist in prod by name — verify they're the **new** versions, not old-prod leftovers.)
**Breaks/risks:** draft-fill handling + stale ADP/roster data + lost error logs.
**Fix:** deploy the new-system Functions to `sbs-prod-env` — the same source/deploy you used for staging (`firebase deploy --only functions --project sbs-prod-env`, or your usual functions pipeline).

### A4. Missing Vercel env vars on `sbs-prod` (confirmed by name diff vs staging)
| Var | Impact | Fix |
|---|---|---|
| `EMAIL_FROM` | **Email sends nothing** — code requires both key+from (`channels.ts:94`); Resend key is set but this isn't | set = staging's verified `sbsfantasy.com` sender |
| `CRISP_KEY` / `CRISP_IDENTIFIER` / `CRISP_TIER` | **Support chat dead** | copy all 3 from staging |
| `WHEEL_JPHOF_MINT_PASS` | wheel JP/HOF winners get **no real NFT / special draft** — staging has it **ON** (proven: 2 jackpot NFTs in prod-staging `pass_origin`) | set `=1` |
| `NEXT_PUBLIC_DISCORD_INVITE_URL` | "join SBS Discord" prompt renders empty | set `=https://discord.gg/4q4ZgXuMN4` |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram account-**linking** (sending alerts already works) | copy from staging + register the bot webhook at the prod URL |

### A5. Firestore singletons missing in prod (seed them)
| Doc | Staging value | Fix |
|---|---|---|
| `draftTracker/tracker` | `{FilledLeaguesCount:0, UnfilledLeaguesCount:0}` | seed |
| `counters/banana_user_number` | `{next:10020}` | seed (pick prod start number) |
| `supply/tracker` | `{cards:0, paidPeels:0, paidMashes:0, freePeels:0}` | seed |

### A6. Low-priority but confirmed-missing (not launch-blocking)
- **`SENTRY_AUTH_TOKEN`** (Vercel) missing — only uploads readable stack traces at build time. `NEXT_PUBLIC_SENTRY_DSN` **is** set, so errors are still captured. Set it for nicer Sentry traces; not urgent.
- **`NEXT_PUBLIC_BBB4_BATCH_PROOF_ADDRESS`** (Vercel) missing — admin-tooling convenience only; the real source is `system_config/batchProof` (A1). After A1, optionally set this to the deployed BatchProof address.
- **Code branch drift (cleanup):** the OpenSea-slug env-drive lives on the `production` branch but not `main` (staging still hardcodes `bbb4-staging`). Prod works (the env var is set), but merge that one line to `main` so the branches don't diverge.

---

## 🟡 SECTION B — VERIFY (couldn't confirm from outside — please check)
- **Alchemy Transfer webhook** → confirm in Alchemy Notify it points at `https://sbsfantasy.com/api/webhooks/alchemy/transfer` watching the **prod contract**. *(Backstop only — reconciler is source of truth — low severity.)*
- **Didit KYC webhook** → confirm it points at `https://sbsfantasy.com/api/verify/webhook`.
- **Cloud Tasks queue `auto-draft-queue`** exists on `sbs-prod-env` (I got a 403 reading it).
- **Old-prod Functions** still deployed on `sbs-prod-env` (`statsEngine`, `gameweekUpdateFunction`, `scoreTriggers-*`, `draftTokens-on*`, etc.) → confirm they're **disabled/paused** so they can't interfere with the new system.
- **`founderSchedule/next`** — seed only if running a Founder Draft at launch (staging: Wed Jun 24 6PM PST).
- **`marketplace_index`** empty (0 vs staging 310) → likely populates as drafts happen; confirm the index builder runs after the first prod draft.
- **Go API `BBB4_OWNER_PRIVATE_KEY`** — staging Go API has it, prod Go API doesn't. Frontend mints (and has the key), so likely fine — verify the Go API doesn't need it for an owner op.

---

## 🟢 SECTION C — CHECKED & CLEARED (NOT issues — do NOT chase)
- **Code** — identical to staging (1 env-driven line in `lib/opensea.ts`; opensea slug var is set on prod, not falling back to staging). ✅
- **Privy auth** — prod frontend app `cmorgobsv00a50cjwqzyuao2z` (same as staging); prod backend secret **tested live against Privy API → HTTP 200 VALID**. Not broken. ✅
- **Alchemy RPC** — same key as staging, on Base. ✅
- **Webhook routes 404 on a bare probe** — **staging behaves identically** (by design); not a prod bug. ✅
- **Firebase** — prod → `sbs-prod-env` (verified from bundle). ✅
- **Backend** — `sbs-drafts-api-prod` + `sbs-drafts-server-prod` deployed & HTTP 200; `ENVIRONMENT=prod`, prod Redis (`10.255.71.211`), prod RTDB. ✅
- **Data seeded** — `playerStats2026` (3) + `web2_social_identities` (492, matches staging). ✅
- **Config matched** — `promoCodes`, `scoringChangeStaging` (64), `tokenCommunities` (25). ✅
- **`seasonConfig`** missing in prod, but I found **no code reader** anywhere (frontend/Go/Functions) → likely no impact; flagged only to double-check.
- **Old-prod DATA preserved** (`draftTokens` 12k, `owners` 5.6k, `drafts` 1478) — intentional, never delete. ✅

---

## Recommended order
1. **A1** (system_config / on-chain — Boris's wallet) — unblocks wheel + reveal + spin-promo at once
2. **A2, A3** (RTDB rules + Functions deploy)
3. **A4, A5** (env vars + singletons — quick)
4. **Section B** verifications
5. **One live mint + reveal + draft** on prod (proves the on-chain path + Alchemy webhook) → then flip `PRELAUNCH_MODE=false`
