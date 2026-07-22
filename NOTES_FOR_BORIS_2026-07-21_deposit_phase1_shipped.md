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

## Not done yet / open items
1. **Card-fee credit at deposit time** — Richard's decision was that the $25-fees→free-pass accrual (and the fronted first-purchase bonus) should move to deposit time. NOT implemented: Add Funds is client+Privy only; the server never learns a card deposit happened. Needs a server-side piece (webhook or verified report) before the flag flips, or we accept card depositors earning no fee credit at first.
2. **Go-live steps:** set `NEXT_PUBLIC_DEPOSIT_ENABLED=true` in Vercel + redeploy, then a real-wallet staging pass through Add Funds → one-tap entry → join.
3. e2e suites are environmentally broken on Richard's machine (mock-auth gate + cold-compile timeouts — identical failures on clean HEAD before the diff). Lint + tsc clean; Rule #0 verified by inspection.

Nothing needed from you; flag stays off until the card-fee question is settled.
