# Prod cutover — handoff for Boris (night of 2026-06-22)

**Strategy (agreed):** promote **staging in place** to prod — the `banana-fantasy` Vercel project + `sbs-staging-env` GCP. We are NOT building on `sbs-prod-env`. Old 2025 prod data on `sbs-prod-env` stays untouched (archived separately for winnings).
**Launch:** Tuesday June 23, 4:20 PM PST. **Do NOT point `sbsfantasy.com` at this until then.** Staging stays on its current URL through launch.

---

## ✅ What we did tonight

### 1. Full backup (verified)
- Full Firestore export of `sbs-staging-env` → `gs://sbs-staging-prelaunch-cutover-backup/staging-cutover-2026-06-22/`
- 5.4 GB, 1024 output files, state `SUCCESSFUL`. **Everything is recoverable from here.**

### 2. Surgical data wipe (done + verified)
Goal: clear the **visible test content + old VRF**, keep what the live site needs, leave invisible history alone.

**KEPT (site needs these — all verified present with data):**
`playerStats2026` (draft board), `seasonConfig`, `scoringChangeStaging`, `tokenCommunities`, `promoCodes`, `web2_social_identities` (492 returning users), `v2_contests` (prize layout), `counters`, `supply`, `SBSTotalSupply`, `gameweekTracker`, `auth`, `admin_state`, `badgeState`.

**CLEARED (verified empty):**
`leagues`, `drafts`, `draftTokens`, all `marketplace_*`, `wheelSpins`, `wheel_periods`, **`system_config` (the old VRF config — gone)**, `prizes`, `synthetic_prizes`, `v2_users`, `usernames`, `pass_origin`, `v2_purchases`, `v2_referral_codes`, `withdrawalRequests`, `founderDrafts`, on/offramp + kyc attempts, test leaderboards.

**Also deleted (an earlier broad pass — Richard OK'd, it's invisible + backed up):** genesis `cards`/`cardMetadata`, `2023DraftTokens`, `2024/2025DraftPlayoffData`, genesis leaderboards, `bbb3_holders`, `adminErrorRunbooks`/`adminResolvedErrors`, some crisp/dm/cron junk. **Left alone:** `owners`, `transactions`, `playoffCards`, `socialUsers` (legacy thirdweb), debug/error logs — all invisible on the new site.

> ⚠️ **Gotcha:** `recursiveDelete`/BulkWriter crashed twice on a clock-rollover bug ("Request time should not be before the last token refill time") during the midnight date change. Use **manual batched deletes** (page + `batch.delete`), not `recursiveDelete`, if you wipe more.

---

## 🟡 Current state
- **Owner/admin wallet for prod:** `0x91889eEc7F2Bc357A33e41d75E29813DC969475b` (Richard has the key). On Base it has **0.0999 ETH and ZERO LINK.**
- **NFT contract:** Richard deployed a **new prod BBB4 contract tonight** — we need its address (see below). App currently falls back to the hardcoded staging V2 `0x781B2E6fE9A615C2680A51Ef88f309ddC2e0D73F`.
- **VRF:** old `system_config` is wiped → reveal/wheel/spin are uninitialized until we redeploy (see below).
- **`v2_queues`** (jackpot/HOF special-draft queue) still has docs — may hold stale test members that get auto-seated into a draft when any trigger fires. **Reset before launch.**

---

## ⬜ What's LEFT to do (in order)

### A. VRF — the one real blocker (needs YOU, Boris)
All 4 proof contracts are deployable straight from our repo (bytecode in `lib/contracts/*Artifact.ts`, deploy routes at `app/api/admin/deploy-*`, signs with `BBB4_OWNER_PRIVATE_KEY`, Base coordinator `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634`). Claude can run all 4 deploys + write the `system_config` docs **once a funded subscription exists.** What's needed from you:

1. **LINK + a subscription.** Two choices:
   - **Reuse your staging subscription:** tell us the **subscription ID**, and **add our 4 new prod proof contracts as consumers** (only the sub owner — your `0xe0d0…` wallet — can do this). Prod would run on your LINK. *Quick, but fragile for launch.*
   - **Fresh prod subscription (recommended for go-live):** send some **LINK to `0x91889…` on Base** (and tell us roughly how much staging burned), then Claude creates + funds + wires a clean prod subscription owned by the prod wallet.
2. **Confirm the Base keyHash (gas lane)** you used on staging. (We're also pulling it from the backup.)

### B. Point the app at the new prod NFT contract
- Set `NEXT_PUBLIC_BBB4_CONTRACT` = the new prod contract address on the `banana-fantasy` Vercel project. (Richard has the address.)

### C. Flip to prod
- **Frontend (Vercel `banana-fantasy`):** `NEXT_PUBLIC_ENVIRONMENT` staging→prod, `PAYMENTS_ENABLED`=true, unset `TEST_HELPERS_ENABLED`.
- **Backend (Go API / WS on Cloud Run):** `ENVIRONMENT`=prod, and move traffic off the pinned revision to the prod-mode one.

### D. Reset `v2_queues` (clear stale special-draft members).

### E. Smoke test: one real mint → draft → confirm a team NFT comes out. No bot-fill while testing (TEST_HELPERS off).

### F. Launch day only: move `sbsfantasy.com` → this deployment + flip PRELAUNCH off. **Not before Tue 4:20 PM PST.**

---

## 🙏 Quick asks for Boris (the unblockers)
1. **LINK:** send LINK to `0x91889…` on Base, OR give us your VRF subscription ID **and** add our 4 prod contracts as consumers. Which do you prefer?
2. **How much LINK** did the staging VRF actually burn? (sizing prod)
3. **Base keyHash** you used.
4. Sanity-check the keep/delete wipe list above — anything you expected to survive that you don't see?
