# 2026-07-21 — Deposit bankroll plan (PRE-BUILD — Boris wants your holes poked before any code)

Boris asked for a deposit-style experience (DK/Underdog feel) without us becoming
a money transmitter. Plan below is agreed with him in principle; **nothing is
built yet**. Please review, especially the two correctness traps at the bottom.

## The model in one line

The user's bankroll is the USDC **in their own wallet** (Privy embedded for
web2). "Enter draft" = one-tap silent-signed `USDC.transfer(treasury, $25)` +
server-side pass mint in the background. We never hold funds — it's factually
non-custodial, so no money-transmitter surface (one lawyer sanity-check
pre-launch anyway).

## Why

- Kills per-draft MoonPay friction: one card charge funds N drafts. MoonPay's
  ~$4 fee minimum makes four $25 buys cost ~$16 vs ~$4.50 for one $100 deposit.
  (Yes — bulk pass buying has the same fee math and already exists; users
  demonstrably don't bulk-buy. Deposits win on willingness: parking withdrawable
  money ≫ pre-committing to 4 passes.)
- Instant re-buys ("draft again", one tap) — the DFS liquidity lever.
- Removes mint/allowance/nonce from the entry hot path → the stale-allowance
  409 class and most payment-time drift disappears.
- Go engine unchanged. A pass is still a pass; only how the $25 reaches us moves.

## Flow

1. **Deposit**: Add Funds (presets $25/50/100/200 + custom) → existing MoonPay
   integration minus the mint step, USDC straight to the user's wallet. Web3
   users can just send USDC in. On the Alchemy transfer-in webhook: balance
   bell + **gas top-up** (~$0.15 ETH from the gas wallet if the wallet has
   none; idempotent per deposit tx, daily cap so it can't be farmed). Privy
   paymaster sponsorship later replaces top-ups.
2. **Balance**: header chip = live wallet USDC (React Query; refetch on focus
   and after entries). No ledger of ours — the chain is the ledger.
3. **One-tap entry**: where a pass is needed and balance ≥ $25, primary CTA
   becomes "Enter draft · $25" (legacy Buy passes stays secondary).
   - web2 embedded: Privy silent-sign, no popup (we already silent-sign in
     drafts). web3 external: same tx, normal confirm.
   - Frontend POSTs txHash → new API route: verify transfer on-chain →
     `reserveTokensToWallet` → `registerMintedTokens(passType 'paid')` → normal
     join flow (useEnterDraft).
   - **Durable retry queue**, Firestore doc keyed by txHash:
     verifying→minting→registering→done. Any Go/Firestore blip retries — a paid
     transfer can never strand (today's bot-orphan circuit breaker lesson,
     designed in). txHash key ⇒ double-submit safe.
4. **Withdraw** (phase 3): "Send USDC" + the Coinbase offramp prototype, with a
   deliberate confirm (no silent signing outbound).

## Phases

1. Staging flag, web2 embedded only: deposit + balance + one-tap entry + gas top-up.
2. Web3 external wallets.
3. Withdraw UI / offramp.
4. Polish: paymaster, variable entry prices, marketplace buys from balance.

## ⚠️ Correctness traps — please double-check my reading

1. **pass_origin classifies FREE by existence.** `listFreeOriginTokenIds`
   returns every pass_origin doc for a wallet; the reconciler stamps those
   tokens 'free'. Deposit-entry passes are PAID → they must either write **no**
   pass_origin doc, or we add an origin (e.g. 'deposit_paid') and exclude it in
   the free-origin lookup + reconcile. Otherwise one reconcile silently flips
   paid passes to free (breaks promos/revenue/ripeness).
2. **Purchase-event hooks.** First-purchase dual-track, 2-spins-per-pass,
   ripeness counts, revenue reports all key off "pass purchased" today (card /
   USDC contract path). The deposit-entry mint MUST fire the same purchase
   event or these silently miss every deposit buy.
3. **Treasury ops**: this flow is a plain transfer to the treasury address (not
   the contract mint path) — needs periodic sweep to Gnosis + inclusion in
   money-on-hand accounting.
4. Free-draft hard rule unaffected: these are paid passes.

## Open questions for you

- Any Go-side assumption that a paid pass always originates from the contract
  purchase path (webhooks, revenue jobs, Caleb's audit branch)?
- Where do you want the treasury address pointed — existing revenue EOA or
  straight to Gnosis?
- Anything in the prod-cutover plans this collides with?

— Boris's Claude
