# Contract Swap & Clean-Slate Runbook

How to swap the BBB4 draft-pass NFT contract to a new address, wire it everywhere
using the **same systems** (nothing about the flows changes — only the address +
a data reset), and start clean. Written from the staging rehearsal on 2026-06-12
(old V1 `0x14065412…463b` → V2 "BBB4 Staging" `0x781B2E6f…0D73F`).

**Golden rule:** the only things that change are (1) the contract address, (2) old
draft/pass/team **data** gets wiped, (3) the VRF randomization is restarted, (4) the
dashboard counter resets. **No flow logic changes.** Mint, paid/free tagging,
pass_origin, league numbering, draft fill, reveal, marketplace, My Teams, OpenSea,
withdrawals — all identical, just pointed at the new contract with fresh data.

---

## 0. Prerequisites

- The owner/admin wallet key is `BBB4_OWNER_PRIVATE_KEY` — **Sensitive in Vercel
  (cannot be pulled), and not stored as a readable Cloud Run value.** So the
  contract deploy runs **server-side** from an admin route (the server already has
  the key at runtime). See Step 1.
- Firestore service account for scripts: read at runtime from `.env.production`
  (`FIREBASE_SERVICE_ACCOUNT_JSON`, base64) — already on Boris's Mac. Scripts do
  `node scripts/<x>.mjs` from `~/banana-fantasy`.
- Terminal line-wrap mangles long pasted commands → wrap any multi-token command
  in a short `~/foo.sh` and run `bash ~/foo.sh`, or put a `#!/usr/bin/env node`
  shebang + `chmod +x` so a wrapped bare path still executes.

---

## 1. Deploy the new contract (server-side, key never leaves Vercel)

Contract source: `contracts/SBSDraftPassBBB4V2.sol` — identical to V1 plus the
OpenSea-conduit auto-approval (gasless listing/offers) behind an owner kill-switch.
Constructor is parameterized `(name_, symbol_, usdc)` so the **same source** deploys
staging and prod with only the name arg changing.

1. Compile: `npx -y solc@0.8.20 --base-path . --include-path node_modules --optimize --bin --abi -o /tmp/bbb4v2-build contracts/SBSDraftPassBBB4V2.sol`
2. Regenerate the TS artifacts the admin route uses (see `lib/onchain/bbb4v2Artifacts.ts` — bin+abi inlined).
3. Ship the one-time admin route `app/api/admin/deploy-bbb4v2/route.ts` (requireAdmin-gated, staging-only guard — change for prod). It does `action:'deploy'` then `action:'init'` (setBaseURI + flipMintState + smoke-mint #0 + verify conduit auto-approve).
4. From a logged-in admin browser tab, run the console snippet (build it with `pbcopy` — copying from chat/terminal mangles it) that POSTs `{action:'deploy'}` then `{action:'init', address}`. It returns the new contract address.
5. **Delete the admin route after use.**
6. Verify on-chain: name, owner, mintIsActive, TOKEN_PRICE_USDC, `isApprovedForAll(any, OpenSeaConduit)===true`, kill-switch toggles.

> Note: `reserveTokens` smoke-mints token #0 to the admin during init. That makes the
> first real user mint **#1** (clean "start at 1"), with #0 as the admin reserve.

---

## 2. Swap the address everywhere (ONE source of truth)

Single constant drives everything:
- `lib/contracts/bbb4.ts` → `DEFAULT_BBB4_CONTRACT_ADDRESS` (the only real edit).
  `lib/opensea.ts` re-exports it as `BBB4_CONTRACT`; `hooks/useAuth.tsx` imports it.
- Also update: `COLLECTION_SLUG` in `lib/opensea.ts` (get the new slug from
  `GET https://api.opensea.io/api/v2/chain/base/contract/{addr}` right after first mint),
  `app/security/blockaid/page.tsx`, `scripts/backfill-index-from-drafttokens.mjs`,
  and the `BBB4 Contract:` line in both CLAUDE.md files.
- Do NOT set the `NEXT_PUBLIC_BBB4_CONTRACT` env override (server/client mismatch
  footgun) — change the code default instead.
- `grep -rn "0x14065412\|<old addr>"` after, confirm zero stale refs. `npm run build`
  (not just tsc), then `~/reconcile.sh` + `~/ship.sh`.

Verify live: `curl .../security/blockaid | grep <new addr>` and
`curl .../api/marketplace/nft/0` shows `"contract":"<new addr>"`.

---

## 3. External configs (dashboards)

- **OpenSea collection** — auto-created on first mint; set the collection fee + art
  in the OpenSea dashboard. New slug goes into `COLLECTION_SLUG` (Step 2).
- **Alchemy transfer webhook** — re-point its contract filter to the new address in
  the Alchemy dashboard (keeps on-chain transfers reconciling). Not required to
  prevent the dup-pass bug (Step 4 handles that), but do it.
- **Old contract wind-down** — `flipMintState` OFF on the old contract (so stale
  links can't keep minting) + `withdrawUSDC` residual.

---

## 4. Full clean-slate wipe ⚠️ (the part that prevents ghost/dup bugs)

Script: `scripts/_wipe-staging-rebuild.mjs` (dry-run default; `--go` to execute via
`bash ~/wipe.sh` / `bash ~/wipe.sh --go`). **Always dry-run first**, eyeball the
counts, then `--go`. No PITR — irreversible.

**WHY this matters (root cause):** a fresh contract reuses low token ids (1,2,3…).
Every Firestore store keyed by the bare on-chain id still holds prior-era rows for
those same numbers → ghosts + the duplicate-pass bug. The Go engine
(`draft-token.go:317`) even registers a new mint under a **synthetic cardId** when
its id collides with a stale **global `draftTokens`** row — that synthetic
`<unixsecs><tokenId>` form is the leading-zero ghost root. So every id-keyed store
MUST be cleared.

**Deletes:**
- `drafts` (keeps `draftTracker` doc) + RTDB `drafts/` node
- `draftTokens` ← GLOBAL collision registry (the dup-pass source)
- `draftTokenMetadata` ← prior-era finalize/render docs
- `marketplace_index`, `pass_origin`
- every wallet's `validDraftTokens` + `usedDraftTokens` (collectionGroup — bulk, not
  per-wallet; staging had ~17.7k wallets)
- per-user `promos`, `badges`, `draftHistory`, `standings`

**Resets to 0 (every account, not just yours):**
- `draftPasses` (paid) **AND `freeDrafts` (free)** AND `jackpotEntries`. The header
  shows `draftPasses + freeDrafts`, so missing `freeDrafts` leaves a stale count
  (this bit us — it's a separate field on the same user doc). All recompute from the
  now-empty ledger via `recountFromInventory`, so the reset sticks.
- `drafts/draftTracker.FilledLeaguesCount` → 0 (dashboard 0/100, next League #1).

**PROTECTED (never touched):** `system_config/*` (VRF config), `merkle_rounds` (VRF —
Step 5 handles), the wheel (`wheelSpins`, `pendingWheelWinnings`, period config —
separate provably-fair system), `web2_social_identities` (prod-pulled), and the user
**accounts** themselves.

> Bots regenerate on demand (`fill-bots` → `MintDraftTokenInDb`), so wiping all bot
> wallets does NOT break draft-fill testing.

### 4a. Phase-2 — stores the first pass missed (script `_wipe-staging-phase2.mjs`, `bash ~/wipe2.sh [--go]`)

The main wipe missed several BBB4-stale stores that still surfaced old-contract
passes/teams in the UI. Clear these too:
- **`v2_queues`** (docs `jackpot`/`hof`/`*-fast`/`*-slow`) — the wheel JP/HOF **filling
  lobbies**. Stale wheel-won seats (old token ids) sit in `rounds[].members[]` and
  show in the marketplace Passes view via `/api/marketplace/wheel-passes`. Reset each
  doc's `rounds: []` (keep the queue docs so the wheel fills fresh rounds).
- **`nft_league_map`** — token-id→league map (ghost risk on reused ids).
- **`active_offers`, `active_listings`, `marketplace_activity`, `marketplace_watchlist`**
  — marketplace state.

### 4b. ⛔ DO NOT DELETE (verified during the staging rehearsal)

A blind "delete everything" would have destroyed unrelated products. These look
draft-ish but are NOT BBB4 — leave them:
- **`cards` + `cardMetadata`** (10,000 each) = the **Genesis** NFT collection.
- **`playoffCards` + `playoffCardMetadata`** (15,000 each) = **Playoff Season 1** collection.
- **`scores`, `stats`, `opponents`, `playerStats*`** = scoring reference data (all seasons).
- **`2023DraftTokens` + `2023DraftTokenMetadata`** = old BBB Season-1 archive (separate era).
- **Financial/audit:** `transactions`, `withdrawalRequests`, `claims`, `v2_purchases`,
  `bbb4_usdc_sweeps`, `onramp_attempts`, `kyc_attempts`.
- **Logs:** `v2_error_events`, `v2_debug_events`, `v2_activity_events`, `notification*`,
  `alchemy_webhook_events`.
- **Protected/config:** `system_config`, `merkle_rounds`, `wheel_periods`, `wheelSpins`,
  `web2_social_identities`, `batch_proofs`, `v2_users` (accounts), `owners` (docs).

> To find any future stragglers: `scripts/_list-all-collections.mjs` dumps every
> collection + size, and `_categorize-collections.mjs` peeks sample docs to tell
> BBB4-draft data apart from other collections. Always categorize before deleting.

### 4c. Wheel mints use the new contract automatically — no separate wiring

The wheel's JP/HOF + free-draft mints (`app/api/wheel/spin/route.ts`) call the SAME
`reserveTokensToWallet` (→ `BBB4_CONTRACT_ADDRESS`) as every other mint path (purchase,
card, staging-mint, admin grant). So swapping the one constant (Step 2) points the wheel
at the new contract too. "Preserving the wheel" only kept its fairness DATA (spins,
period, commit) — never its mint target.

> **PROD difference:** a brand-new prod env on a brand-new contract has NO prior-era
> rows, so most of this wipe is a no-op there. It's mandatory only when swapping a
> contract on an env that already has draft history (like staging).

---

## 5. Restart the VRF randomization (fresh 10k round) — ON-CHAIN, do with care

**When it matters:** only for the real contest's *fairness*. Drafts work fine without
it (they reveal types from whatever round is committed) — so it's NOT needed to test
flows on staging. It IS needed before a real contest so the 10k JP/HOF/Pro distribution
is freshly committed and unpredictable.

**System model (`batchproof/manager.go`, variant `vrf-commit-merkle`):**
- 1 round = `MerkleWindowCount` (100) batches = 10,000 drafts.
- `merkle_rounds/{N}` holds the committed round (salt, VRF randomness, 10k leaves, root).
- `system_config/merkleRoundState` = `{currentRoundNumber, nextBatchIndexInRound}`.
- `batch_proofs/{batchN}` = cached batch→round pointers (fast path in `resolveRoundForBatch`).
- Cold-open flow (`ensureRoundCommitted`): GenerateSeed → `RequestRandomnessAndCommitMerkle`
  (on-chain VRF request + salt-hash commit) → wait VRF fulfill → build merkle tree →
  `commitRoundMerkleRoot` (on-chain). Auto-triggered at batch boundaries via
  `PreOpenNextMerkleRound`. There is **no admin "restart round" endpoint**.

**The desync after a wipe:** `draftTracker.FilledLeaguesCount` → 0, but `merkleRoundState`
still points mid-round (e.g. index 5) and `batch_proofs/0..N` still map to the OLD round.
So fresh drafts would REUSE the old round's already-revealed batches → predictable types.

**Safe restart procedure (do NOT hand-edit state alone — that risks a Firestore-vs-chain
"inconsistent state"):**
1. Open a NEW round number on-chain (the contract tracks rounds by number; never reuse a
   committed round number). Use `PreOpenNextMerkleRound` — it cold-opens round `current+1`,
   commits salt-hash, requests VRF, waits fulfillment, commits the merkle root. This is the
   only correct way to get a fresh randomized 10k committed.
2. AFTER that round doc exists/committed, set `merkleRoundState =
   {currentRoundNumber: <new>, nextBatchIndexInRound: 0}`.
3. Delete `batch_proofs/*` so the fast path doesn't re-map batch 0 → the old round.
4. Verify: `merkle_rounds/<new>` status `merkleCommitted`, 10k leaves, on-chain root matches;
   first test draft maps to the new round index 0.

**How to trigger #1 safely:** there's no existing endpoint, so EITHER (a) coordinate with
Richard (built the batch-proof system), OR (b) add a small admin route that calls
`PreOpenNextMerkleRound` + applies #2/#3 atomically, deploy to the Go API
(`sbs-drafts-api-staging`), trigger once, then remove. Treat as a confirm-before-deploy
on-chain step.

> **PROD difference:** on a brand-new prod env the batch-proof contracts get deployed fresh
> (`deploy-batch-proof-merkle`) and round 1 cold-opens on the first draft — no "restart"
> needed, it's a clean bootstrap. The restart dance above is only for re-randomizing an env
> that already ran drafts (like staging).

### 5a. The VRF/proof site surfaces are INDEPENDENT of the NFT contract

Verified during the rehearsal: **no** drafting/proof surface references the NFT pass
contract — the swap can't break any of them. The proof system uses its own contracts
(`0x38c0…`, `0x5907…`, wheel-proof, jackpot-draw) and its own data, and the in-draft
reveal gets `draftType` from the Go draft state, not the NFT. Surfaces to smoke-check
after a swap (they should all just work): drafting reveal (`SlotMachineOverlay`,
`PackReveal`, `DraftRoomReveal`, `BatchProofBanner`), `/proof/[draftId]`, `/proof-feed`,
`/spin-proof/[spinId]`, `/wheel-batches`, `WheelProofBanner`, and the
`/api/drafts/[id]/merkle-proof` + `/api/batches/[n]/proof` routes. The wipe must KEEP
`batch_proofs`, `merkle_rounds`, `system_config`, and the wheel for these to stay valid.

---

## 6. Verify all flows (nothing changed, all working)

- Mint #1 → "Draft Pass #1"; draft it → "Team #1" (same number — `lib/opensea.ts`
  builds both from tokenId, no offset).
- Pass → draft fill → slot-machine reveal → team card with roster/picks.
- Marketplace (buy/sell/offer — gasless for external wallets via the relay), My Teams,
  OpenSea collection, dashboard counts, withdrawals (USDC + prize records — never
  touches the NFT contract).
- Confirm no ghosts: fresh low ids resolve to their own data, no dup pass records.

---

## Numbering reference (the "are the numbers aligned?" answer)

Three independent counters by design — do NOT try to force them equal:
1. **Token id / pass #** — the NFT. `Draft Pass #N` and `Team #N` are BOTH built from
   the token id (`lib/opensea.ts:284`), so one token keeps the same N pass→team. ✓
2. **League #** — global draft sequence ("BBB #N" = the Nth draft). Assigned by the
   draft engine, unrelated to token id.
3. **Team seat** — slot 1–10 within a league.

The historical "numbers off / same-id confusion" was NOT a display bug — it was stale
id-keyed data (era reuse → ghosts; collision → synthetic ids → dup pass count). Step 4
is the cure. `canonTokenId()` (6 decoders) is the in-code backstop.
