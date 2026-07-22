# Deposit Bankroll Phase 1 — SHIPPED DARK (2026-07-21)

FYI — Richard's session shipped Phase 1 of the deposit bankroll tonight. Deploy commit `cc2ca107` on sbs-frontend-v2. **The entire feature is OFF in production** — it only activates when the Vercel env var `NEXT_PUBLIC_DEPOSIT_ENABLED` is set to exactly `true` (it is not set today).

## What's in it (all flag-gated)
- **`lib/deposits.ts`** — the flag + `$25` entry price + Add Funds presets ($25/$50/$100/$200).
- **`AddFundsModal`** — funds the user's OWN wallet with USDC via the existing Privy/MoonPay onramp and stops there (no mint). It's BuyPassesModal's funding leg without the mint tail. Mount-only-while-open (useFundWallet crash rule respected everywhere).
- **`useDepositEntry` + `DepositEntryModal`** — when a user has ZERO passes but ≥ $25 wallet USDC, entry CTAs on home / buy-drafts / drafting page offer one-tap "Fast/Slow Draft · $25" instead of the buy modal. Under the hood it's the EXISTING permit+mint purchase path (silent `useMintDraftPass` mint, registered 'paid') followed by the normal shared join. No new payment path, no treasury, pass_origin untouched. Pass-first ordering preserved — the deposit branch is only reachable at zero passes.
- **Header balance chip** — wallet USDC + "+" button that opens Add Funds. Pure read of the existing 30s-polled useAuth balance; zero fetching of its own (Rule #0 clean — no new useEffect-with-fetch anywhere in the diff).
- Double-tap double-buy guarded client-side with a synchronous in-flight ref; live balance pre-flight before the silent mint so short wallets get a clear error instead of a hang.

## What's live-visible NOW (not flag-gated, Richard's call 7/21)
- The header pass-ticket (mobile + desktop) is **hidden when the count is 0** — a "0" ticket only advertised having nothing.

## Card-fee credit at deposit time — BUILT (second deploy `b48f6737`, same night)
Per Richard's decision, the $25-fees→free-pass accrual + the fronted first-purchase bonus now fire at DEPOSIT time. New pieces (all flag-dark with the rest):
- **`POST /api/deposits/card-credit`** (Privy-authed, rate-limited, 404s while the flag is off) + **`lib/purchases/creditCardDeposit.ts`**. AddFundsModal calls it fire-and-forget once USDC verifiably arrives (skipped when the Privy widget reports a `manual`/external-transfer funding method).
- Server verifies the on-chain half itself: scans recent USDC `Transfer` logs INTO the caller's wallet (~50 min window), sender ≠ self, amount ≈ claim, credits from the VERIFIED amount. Idempotent per transfer (`card_fee_credits/deposit_<txHash>_<logIndex>` markers, existence-checked inside the Firestore transaction).
- Uses the SAME `cardFeeCreditCents` accumulator and once-only `cardFeeFrontGranted` flag as card-mint — no double-fronting between deposit and pass-purchase paths, and both feed one $25 meter. Fee = new `feeForDepositUsd()` in lib/pricing.ts (interpolates your measured MoonPay table by amount/$25; flat qty-1 fee below $25 since MoonPay's minimum dominates there). Reward mint mirrors bookkeepPaidMint 4b/5b: paid-type pass, `failed_mints` record on mint failure, same `promo-card-free-draft` toast. ⚠️ KEEP IN SYNC note added — this is a third copy of the credit semantics, matching the codebase's card-mint-stays-untouched convention.
- **WEB2 ONLY (third deploy `dd184fb3`):** the credit is gated to Privy EMBEDDED wallets — server 403s external-wallet (web3) callers via new `isEmbeddedWalletOf()` in lib/privyServer.ts (reads `wallet_client_type`/`connector_type` from the Privy user API), and the client skips the call for non-embedded wallets. Web3 users fund their own wallets, so an inbound transfer proves nothing about card fees — they accrue nothing here (they still get one-tap entry; their per-entry MetaMask confirm is the Option A flow).
- **Accepted residual risk (documented in the file header):** we still can't see MoonPay's side, so a WEB2 user could still self-send USDC to their embedded wallet and have it read as a card deposit. Bounded: front is once per user ever (shared flag), and the accumulator needs ~$435 of claimed deposits per pass. Marker docs record sender + amount for audit. Same trust class as the client-claimed `paymentMethod` on card-mint today.

## Remaining before flag flip
1. Set `NEXT_PUBLIC_DEPOSIT_ENABLED=true` in Vercel + redeploy, then a real-wallet staging pass: Add Funds → fee credit lands → one-tap entry → join.
2. e2e suites are environmentally broken on Richard's machine (mock-auth gate + cold-compile timeouts — identical failures on clean HEAD before the diff). Lint + tsc clean; Rule #0 verified by inspection.

Nothing needed from you.

## UPDATE — LIVE as of 2026-07-21 late night
Richard flipped it on: `NEXT_PUBLIC_DEPOSIT_ENABLED=true` set in Vercel production + hook rebuild (deployment hfg77bb85, Ready). Verified live: `/api/deposits/card-credit` now returns 401 (auth) instead of the flag-off 404. Users now see the balance chip + Add Funds; zero-pass users with $25+ USDC get one-tap entry. First real card deposit + one-tap entry still unexercised — watch `payment.card.fee_credited` logs with `via: deposit` for the first one.

## Test-entry exclusion — 2026-07-22 03:54 UTC
Richard did a REAL one-tap balance entry to test the deposit flow (web3 wallet 0xC0F982492c323Fcd314af56d6c1A35Cc9b0fC31E): $25 USDC into the contract tx 0x0966336a5a008d033f486ac4a788abe9b242fbaddf6c3a49ae9c4ae549d18cc0, pass #2833 minted tx 0x019d9fb7bbdcab8796c744b866ee6a46b5b8eeb2cdc490fd79cb4a21cfb2c2c4. ⚠️ This $25 is TEAM TEST money — pull it out of prize-pool accounting (same treatment as the $950 prelaunch-mint exclusion) / take $25 back out of the prize pool safe.
