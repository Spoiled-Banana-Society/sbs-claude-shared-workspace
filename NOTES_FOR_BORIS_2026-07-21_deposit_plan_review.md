# 2026-07-21 — Deposit plan review: holes poked, answers to your 3 questions. Verdict: GO, with 4 pre-build items

Richard reviewed the plan (`NOTES_FOR_RICHARD_2026-07-21_deposit_bankroll_plan.md`) and we ran two deep code sweeps (Go API + frontend/cutover docs). Plan is sound. Answers + findings below.

## Decisions from Richard

- **Web3 = Option A**: external wallets pay per-entry straight from MetaMask with a normal confirm each time. No "move funds into embedded wallet" path.
- **Pass-first priority is mandatory**: entry CTA must consume an unused pass before ever charging $25. Button label always states the spend: "Enter draft (1 pass)" vs "Enter draft · $25".
- Depositing while holding passes is fine — balance and passes are independent.
- Existing passes: no migration. Deposit entry mints a pass under the hood anyway, so passes remain the inventory unit; deposits are just a new way to buy one at entry time. Passes stay the vehicle for all free/promo grants.

## Q1 — Go-side assumptions about paid-pass origin: NONE. Zero Go changes needed. ✅

Verified in `~/sbs-drafts-api-deploy` (workspace mirror byte-identical on all relevant files):

- `POST /owner/{ownerId}/draftToken/mint` (`owner/owner.go:20`, handler `:145-182`) accepts `PassType` verbatim; `MintDraftTokenInDb` (`models/draft-token.go:252+`) normalizes anything ≠ "free" to "paid".
- The ONLY on-chain check is `ownerOf(tokenId) == ownerId` (prod only, `draft-token.go:258-269`) — ownership, not payment. `reserveTokens` mints straight to the user, so it passes.
- No webhooks/listeners/revenue jobs/payment verification anywhere in Go. `main.go` mounts only draft/draft-actions/league/owner/staging. Contract wrapper is read-only (`ownerOf`, `numTokensMinted`).
- Pass consumers (`selectTokensByType` `models/leagues.go:51-87`, refund path `draft-token.go:509-547`) treat PassType purely as a pool label. A reserveTokens-minted pass registered 'paid' enters the paid pool, spends and refunds correctly.
- Registration is idempotent + **first-writer-wins** on PassType (dedup guards `draft-token.go:271-318`). ⇒ our 'paid' registration must land before any reconcile touches the token; a later differing call is skipped, not corrected.
- Referrals: `PromoCode` on the mint request pays the referrer 2.5% (`owner.go:185-215`, `models/owner.go:99-120`) — independent of passType. Recommend deposit registrations carry the code so referrals keep working; omit it if not.

## Trap #1 (pass_origin free-flip) — real but AVOIDABLE BY DESIGN, no reconciler changes needed ✅

Confirmed mechanics: `listFreeOriginTokenIds` (`lib/onchain/passOrigin.ts:75-82`) returns **every** pass_origin doc regardless of origin type; `reconcilePasses.ts:347-352` stamps anything in that set 'free'. BUT — card-mint and bookkeepPaidMint write **no pass_origin doc at all**; paid is defined by absence.

**⇒ Simplest safe design: the deposit route writes NO pass_origin doc.** Track treasury/audit in a separate collection (e.g. keyed by deposit txHash — the durable-retry-queue doc you already planned can double as the audit record). Trap vanishes. If you insist on an origin tag instead, the change list is: `passOrigin.ts:6` (union), `:75-82` (filter to free origins), `reconcilePasses.ts:347`, `marketplace/listings/route.ts:406` (free backstop must not block listing), `countFreeOriginsByWallet` callers.

## Trap #2 (purchase-event hooks) — real, and it's the bulk of the build ⚠️

10 side-effects fire on every purchase today, living in the **hand-duplicated pair** `app/api/purchases/card-mint/route.ts` + `lib/purchases/bookkeepPaidMint.ts` (NY route): registerMintedTokens 'paid' · writeDraftPassMetadata (grey image) · card-fee bonus block (card-only — deposits correctly skip it) · recountFromInventory writing the **`pass_purchased` activity event** · notifyPassPurchased bell · incrementMintPromos (first-purchase spins + Buy-10/Buy-2) · incrementReferralPromos · logOnrampCompleted (card-only) · PURCHASE_COMPLETED log · stream toast (card-only).

- Admin-dashboard revenue = sum of `metadata.totalPrice` over `pass_purchased` events (`lib/admin/metricSources.ts:29-31`). Deposit route MUST emit it with totalPrice or deposit revenue is invisible to the whole dashboard.
- Ripeness + jackpot paid-count key off the pass staying typed 'paid' (`db-firestore.ts:3848`, `:3354/:3417/:3524`) — safe given trap #1 handled.
- **Pre-build ask: consolidate the 10 steps into ONE shared function first** (card + NY + deposit all call it). A third hand-synced copy of that block is how we get silent divergence. Half-day refactor, pays forever.

### Revenue/classification scripts break on deposits (the "all revenue flows through the contract" assumption, in code)

- `scripts/_rev-to-date.mjs` — counts USDC `Transfer` **to the contract**. Deposit USDC → treasury never appears. Needs a treasury-inflow leg.
- `_stats-prelive-classify.mjs` / `_stats-prelive-onchain.mjs` — classify PAID by USDC-in-same-tx-as-mint. Deposit mints are bare reserveTokens ⇒ bucketed OWNER-MINT/$0. Need a deposit-aware bucket (join vs the deposit-queue docs by txHash).
- `_stats-prelive-mints.mjs` — `paid = paymentMethod 'usdc'|'card'`. Pick the deposit `paymentMethod` value deliberately (suggest a distinct `'deposit'`) and widen every consumer; distinct beats reusing 'usdc' for auditability.

## Q2 — Prod-cutover collisions: none direct; checklist additions ✅/⚠️

Nothing in `NOTES_FOR_BORIS_PROD_CUTOVER.md` contradicts the design. Additions it needs:

1. **Treasury inflow accounting**: `skimBbb4Usdc.ts` sweeps the contract only; deposit funds at the treasury are invisible to `bbb4_usdc_sweeps`. Money-on-hand needs a treasury line.
2. **NEW Alchemy webhook** for USDC → user wallets (balance bell + gas top-up). Existing webhook filters to the BBB4 contract only (`webhooks/alchemy/transfer/route.ts:83`). Own subscription + signing key, set on the right Vercel project.
3. **Gas top-up wallet**: prod owner wallet is thin (~0.1 ETH per cutover notes) and already has a gas floor guard. Per-deposit ETH drips need their own funded wallet + cap sizing.
4. **Smoke test leg**: deposit → one-tap entry → confirm pass survives a reconcile as 'paid' → confirm pass_purchased + promo hooks fired.
5. **Safe migration gets MORE urgent**: deposits add a second high-frequency server-signed action (reserveTokens per entry + gas drips) on `BBB4_OWNER_PRIVATE_KEY`. Fold into the multisig plan.

## Q3 — Treasury address: Richard leans GNOSIS SAFE directly

Skips building a sweep job; one less hot EOA holding revenue. ⚠️ The sweeps found **three different treasury addresses** across our docs/code (`skimBbb4Usdc.ts:30` default vs two others in NOTES-FOR-BORIS). Given the address-poisoning hit on the ops wallet, whatever we pick must be ONE authoritative address, copied full-string from the Safe UI itself — never from tx history or old notes. Your call to confirm.

## Net-net

GO. Pre-build order: (1) consolidate purchase bookkeeping into one function, (2) deposit route = txHash-keyed durable queue → reserveTokens → register 'paid' (NO pass_origin doc) → shared bookkeeping with `paymentMethod: 'deposit'`, (3) update the 3 revenue scripts, (4) you + Richard lock the treasury address. Then phase 1 behind the staging flag as planned.

— Richard's Claude
