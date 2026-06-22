# 🎲 VRF / MERKLE / PROOF SYSTEMS — full redeploy map

**Purpose:** when prod redeploys the proof contracts + Chainlink VRF (the wiped `system_config`), this is the exact map of all three systems — flow, server, real-time, UI, sizes — so it reproduces **identically** with zero broken flows. All the *code* is unchanged (staging-as-prod); what gets recreated is the **contracts + `system_config` docs** (via the admin deploy routes, same format) + the **runtime data** (rounds/periods, created as drafts/spins happen). Verified by reading the code 2026-06-22 — file:line cited.

## The 3 systems + their `system_config` + VRF subscriptions
| System | `system_config` docs it needs | VRF subscription | Pre-randomize size |
|---|---|---|---|
| **Draft batch proof** | `batchProof`, `batchProofMerkle`, `merkleRoundState` | **#1 (draft/reveal)** | round = **10,000** drafts |
| **Wheel** | `wheelProof`, `wheelAssignmentJournal`, `wheelPeriodState` | **#2 (wheel)** | period = **100,000** spins |
| **Jackpot hit promo (#4)** | *(none of its own)* — borrows the **wheel** period's sealed seed | **rides on #2 (wheel)** — no 3rd sub | n/a (late-bound) |

→ **Only 2 Chainlink VRF subscriptions** needed (draft + wheel). The jackpot promo reuses the wheel's. **Sizes stay exactly as today: draft 10k, wheel 100k — do NOT change** (10k draft is single-doc / 1MB-safe and already covers ~8× last year; 100k wheel is sharded). Bumping the draft over ~14k overflows Firestore's 1MB doc limit.

---

## SYSTEM 1 — DRAFT BATCH PROOF (provably-fair 94 Pro / 5 HOF / 1 JP per 100)
**Flow** (`lib/batchProof.ts`, Go `~/sbs-drafts-api-deploy/batchproof/merkle.go`):
- Constraint: every **100 drafts** = exactly 94 Pro, 5 HOF, 1 Jackpot (`batchProof.ts:4`, `BATCH_SIZE=100`).
- VRF-commit-merkle variant: a round = **`MerkleRoundSize = 10000`** drafts (`merkle.go:42`) = 100 windows × 100. One on-chain ceremony per round: commit salt-hash + request VRF, then the HOF/JP positions per batch derive from the VRF randomness.
- Leaves stored as **one array** in `merkle_rounds/{roundN}.merkleLeaves` (10k × 66 chars ≈ 660KB, under 1MB). `merkleRoundState` = `{currentRoundNumber, nextBatchIndexInRound}`.

**Real-time:**
- **SSE:** `/api/drafts/proof-feed/stream` — pushes `event: snapshot` with `{roundNumber, merkleRoot, merkleRootTxHash}` + per-draft entries. **Gates display on the VRF-committed type** (`proof-feed/stream:122-159`): a draft only shows once its written `Level` matches the VRF-committed type — "sealed source of truth."
- **Poll:** `BatchProofBanner` (`components/drafting/BatchProofBanner.tsx`) fetches `/api/batch-proof-merkle-contract` + `/api/batches/current` + `/api/batches/{N}/proof`, **every 30s** (`setInterval(load, 30_000)`).

**UI placements:** `BatchProofBanner` on **`app/draft/page.tsx`** (the draft page); `components/drafting/LobbyProofBadge.tsx` (lobby); `components/drafting/DraftProofExplainerModal.tsx` (the "i" explainer). The live proof feed shows on the draft page.

**Reads from `system_config`:** `batchProof` + `batchProofMerkle` (contract addresses) + `merkleRoundState`. Proof-feed reads `merkle_rounds/{currentRoundNumber}` (`proof-feed/route.ts:244-257`).

**Gotchas to preserve:** the proof-feed's VRF-commit gating (don't show a level until committed); batch boundary `firstBatchNumber + 100 - 1` (`batches/[n]/proof:289`); the round is single-doc (keep 10k).

---

## SYSTEM 2 — BANANA WHEEL (100k-spin sealed period)
**Flow** (`lib/wheelPeriod.ts`, `app/api/wheel/spin/route.ts`, `lib/wheelAssignmentJournal.ts`):
- **One period covers the WHOLE contest** (Boris 2026-06-12): `MAX_SPINS_PER_PERIOD = 100_000` (`wheelPeriod.ts:27`). At period open, all 100k outcomes are pre-derived from the period's VRF randomness + merkle root, **committed on-chain**. Keeper cron auto-rolls to a next period only if the cap is ever hit.
- Each spin: atomic `claimSpinIndex` increments `spinCount` (`wheelPeriod.ts:334` `FieldValue.increment(1)`), index `0..maxSpins-1`, outcome derived deterministically. Assignment journal commits `(spinIndex, wallet)` leaves on-chain in **batches of 100** (`ASSIGNMENT_BATCH_SIZE=100`).
- **Leaves are SHARDED** (`wheelPeriod.ts:163-169` `LEAF_SHARD_SIZE = 10_000`): `wheel_periods/{N}/leaves/{shardId}`, 10 shards for 100k (each ~660KB). `wheelPeriodState` = `{currentPeriodNumber}`.

**Real-time:**
- **Poll:** `WheelProofBanner` (`components/wheel/WheelProofBanner.tsx`) fetches `/api/wheel/period` **every 30s** (`setInterval(load, 30_000)`), shows "*sealed by VRF + Merkle root, X/100000 spins verified*".
- **Spin:** the spin API **returns the result INSTANTLY**; the merkle proof is fetched **lazily after the wheel lands** + the tree is cached (`wheel/spin/route.ts:606` — the perf fix). ⚠️ **NEVER rebuild the 100k-leaf proof inside the spin response** (that was the ~3s latency bug, fixed 2026-06-13).
- **JP/HOF win:** `app/banana-wheel/page.tsx` polls the live queue (`setInterval`, `:116`) until the winner's seat appears, then shows the "X/10 + Join Lobby" win modal.

**UI placements:** `components/wheel/BananaWheel.tsx` / `SpinWheel.tsx` (the wheel); `WheelProofBanner.tsx` (the verified banner); `WheelProofExplainerModal.tsx` (explainer); `app/wheel-result/[spinId]/page.tsx` (per-spin result/share); `components/admin/WheelProofAdminPanel.tsx` (admin).

**Reads from `system_config`:** `wheelProof` + `wheelAssignmentJournal` (contracts) + `wheelPeriodState`. Period data in `wheel_periods/{N}` (+ `/leaves/{shard}`).

**Gotchas to preserve:** the instant-return + lazy-proof + tree-cache (latency fix); leaf sharding (10k shards); atomic `spinCount` increment; badges unlock at **fill/reveal**, never at spin; lock-at-fill / no-exit on special drafts.

---

## SYSTEM 3 — JACKPOT HIT PROMO (#4)
**What it is** (`db-firestore.ts:2855` `JACKPOT_HIT_PROMO_ID='4'`, rules at `:2860` + `mock/promos.ts:121`):
- 1 Jackpot draft per 100. **Jackpot hits within first 25 drafts of the cycle → 1 of the 10 paid drafters wins 10 free spins; within first 50 → 5 free spins. Cycle resets every 100 drafts.**

**Flow** (`db-firestore.ts:2996-3108`, `lib/jackpotDrawProof.ts`):
1. When a jackpot draft hits: `getSealedDrawSeed()` reads the **active wheel period's** sealed `{salt, vrfRandomness, saltHash}` from `wheel_periods/{N}` (`jackpotDrawProof.ts:47`).
2. `deriveDrawWinnerIdx(seed, draftId, paid.length)` = `sha256(salt + vrfRandomness + 'jp-draw:'+draftId) % paidCount` → picks the winner among the **paid** participants (`:65`, `db-firestore.ts:3003`).
3. Winner gets the reward (10 or 5) free spins.
4. `postDrawReceiptOnchain` / `ensureDrawReceipt` posts an **instant self-send tx on Base** with the canonical draw record (draft, paid wallets in slot order, winner, period + salt hash) — permanent in seconds, sub-cent.

**⭐ The wheel tie (this is the "wired differently" part):** the jackpot draw **borrows the wheel period's pre-committed VRF randomness** for its fairness proof (un-grindable: salt hash + VRF were locked on-chain before the draft existed). It does **NOT** have its own VRF. **Fallback:** if no wheel period is active, `getSealedDrawSeed()` returns null and the draw falls back to a draftId-only basis — **so a draw is never blocked** (just less provably-fair). So the promo works with OR without the wheel; strongest proof when the wheel period is active.

**Real-time ping:** `pushStreamEventBg(userId, 'promo-jackpot-hit', {draftId, awardedCount})` (`db-firestore.ts:3108, :3178`) → `userEventStream` event type `'promo-jackpot-hit'` (`:42`) → `eventNotifications.ts:54` creates the bell notification (dedupeKey `promo-jackpot-${draftId}`). Winner sees it real-time + a bell.

**Reads from `system_config`:** none directly — depends on the **wheel** period (`wheel_periods/{N}.salt/vrfRandomness`). So redeploy the wheel first.

---

## 🚀 REDEPLOY ORDER (so every flow reproduces identically)
1. **Chainlink VRF: create + fund 2 subscriptions** — #1 draft/reveal, #2 wheel. (Jackpot uses #2.)
2. **Deploy draft contracts** → admin `deploy-batch-proof-vrf-commit` (+ merkle) with sub #1 → writes `system_config/batchProof` + `batchProofMerkle` + `merkleRoundState`. Round size stays **10,000**.
3. **Deploy wheel contracts** → admin `deploy-banana-wheel-proof` + `deploy-wheel-assignment-journal` with sub #2 → writes `system_config/wheelProof` + `wheelAssignmentJournal` + `wheelPeriodState`.
4. **Add all deployed contracts as VRF Consumers** + confirm LINK-funded.
5. **OPEN a wheel period** (admin `wheel-period/open`) → generates the 100k sealed leaves + salt + VRF randomness. **Do this before any jackpot draft can hit**, so jackpot draws get the strong (wheel-seed) proof instead of the fallback.
6. **Start the draft merkle round** (first batch ceremony) as drafts begin.

## What makes the real-time/UI identical
- **All code is unchanged.** The banners poll every **30s** (`/api/wheel/period`, `/api/batches/*`); the draft proof-feed is **SSE** (`/api/drafts/proof-feed/stream`, gated on VRF-commit); the wheel win + jackpot pings are **server events** (`promo-jackpot-hit`, queue poll). None of that changes.
- It all just reads the **recreated `system_config` docs** (same format, written by the same admin routes) + the fresh **rounds/periods**. So if the deploy writes `system_config` correctly and a wheel period is opened, **every banner, feed, win modal, and ping behaves exactly as today.**

## Must-not-regress checklist
- [ ] Draft round stays **10,000** (single-doc, 1MB-safe).
- [ ] Wheel period stays **100,000** + **sharded leaves** (10k shards).
- [ ] Wheel spin: **instant return + lazy proof + tree cache** (no 100k rebuild in the spin response).
- [ ] Proof-feed only shows a draft level once **VRF-committed**.
- [ ] Jackpot draw: wheel-seed when a period is active, **draftId fallback** otherwise (never blocks).
- [ ] `promo-jackpot-hit` ping fires once (dedupeKey) → bell, real-time.
- [ ] Open the **wheel period before** jackpots can hit.
