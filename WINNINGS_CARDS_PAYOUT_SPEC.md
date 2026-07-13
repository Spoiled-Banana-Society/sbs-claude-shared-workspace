# Winnings, Balance & Payout — Build Spec (deploy AFTER Boris's revert)

**Status:** Designed, NOT built. Deploy target = season start. Do not start until Boris's codebase
revert/rework is done and merged (deploys are blocked right now). Author: Richard + Claude, 2026-06-18.

---

## 1. Why this exists (the bug we're fixing)

Today the Wallet page (`app/winnings/page.tsx`) shows ONE number =
`unifiedAvailable = availableBalance (pending prizes in our ledger) + cashableWalletUsdc (on-chain
wallet USDC)` (line ~57). But:

- For web2 (embedded) users the only button is "Cash out to bank," and it's **capped at the wallet
  USDC only** (`maxAmount={cashableWalletUsdc}`, line ~567). The prize portion has **no self-serve
  path** — the "Withdraw all" trigger is hidden for embedded users (line ~235 ternary).
- Result: page advertises e.g. $110 but the user can only ever pull the $10 wallet portion. The
  $100 of winnings is shown as available but is unreachable without manual admin payout.

Not a live problem yet (nobody has won prizes). Must be fixed before the season generates real money.

---

## 2. The model (READ FIRST — this is the key concept)

**Winnings live ON cards (teams), not in one pool.** Each card (drafted team / NFT) carries its own
won amount. A user's total "Winnings" = the **sum of money sitting on all their cards**, and it must
always reconcile exactly with the per-card numbers shown on the cards.

- Cards display their own winnings.
- A card can be **sold on the marketplace with its winnings still on it** — the buyer gets the card
  AND the money on it. So a card's sale price effectively includes its winnings.
- **Winnings follow the card.** When a card is bought, the new owner is the one who can withdraw the
  winnings on it (after the buyer's own KYC). The winnings ledger must therefore be keyed by
  card/tokenId and resolve to the CURRENT owner — not locked to the original winner.

Two pots, by user type:

| | Balance | Winnings |
|---|---|---|
| **Web2** | Privy embedded wallet USDC = leftover mint money + marketplace card-sale proceeds | money on their cards |
| **Web3** | the USDC in their own MetaMask/external wallet | money on their cards |

---

## 3. Display changes (Wallet page)

Stop showing the single summed "Available to withdraw" number. Split into two clearly-labeled lines:

- **Balance** — real, spendable + cashable now.
  - Web2: their Privy wallet USDC.
  - Web3: their external wallet USDC.
- **Winnings** — money on their cards, "Ready to transfer." Must equal the sum of per-card amounts.

The Winnings total on the Wallet page and the per-card amounts on the My Teams page must come from a
**single source of truth** (ledger keyed by tokenId, follows ownership) so they can never disagree.

---

## 4. Transfer flow (winnings → balance)

Same pipeline for both user types; only the final hop differs.

**Entry points (decided):**
- **Wallet page:** ONE "Transfer all winnings" button — sweeps EVERY card at once. No per-card
  selection here.
- **My Teams page:** open an individual card → a "Transfer winnings" button on that card moves
  just that card's amount.
- **Full amount only** in both cases. A card is never left partially drained (keeps the
  "sell card with its winnings" promise honest — a card's displayed amount must never silently
  change).

**Steps:**
1. User taps transfer → **KYC check** (one-time, Didit `tier1Verified`). Required for BOTH web2 AND
   web3. If not verified → verification modal first.
2. Request created and the affected card(s)' winnings flip to a **"Processing"** state (locked — see
   §5).
3. **We periodically approve** a batch and pay out **from our Safe → the user's own wallet**
   (Privy for web2, external wallet for web3). Manual/periodic approval is deliberate: human
   checkpoint before funds leave the treasury, no always-on auto-signing wallet, batched outflow.
4. User is **notified** it landed (in-app + push via OneSignal).
   - Web2: "Your winnings are in your wallet — cash out to your bank anytime." Then they cash out via
     the existing Coinbase off-ramp.
   - Web3: "Transfer complete" — it's literally in their MetaMask now; nothing more needed.
5. **Show an expected window** up front, e.g. "Transfers take up to 2–3 business days."

This reuses the EXISTING external-wallet prize pipeline (`/api/prizes/withdraw-all` → admin
withdrawals queue `components/admin/WithdrawalsPanel.tsx` → Safe batch → mark paid cascade in
`/api/admin/withdrawals/[id]`). The new work is: per-card keying, the two entry points, the display
split, the locks, and un-hiding the trigger for embedded users (destination = their Privy wallet).

---

## 5. Decided rules (the safety-critical ones)

1. **KYC required for web3 too** — same one-time check as web2. Prize money is a real payout; gate
   both. (Tax: existing W-9 gate at $2k cumulative still applies.)

2. **Lock winnings while a card is listed (or sale pending).** If a card is on the marketplace, its
   owner CANNOT pull its winnings into balance until it's sold or delisted. Prevents a sell/withdraw
   race where a buyer pays for winnings that got yanked. Extend the same lock to "transfer is
   processing" — a card mid-transfer can't be listed/sold.

3. **Winnings follow the card to the buyer.** New owner can withdraw them after their own KYC.
   Ledger keyed by tokenId + current owner, not original winner.

4. **Marketplace must visibly show "includes $X winnings"** on any card that carries winnings, so a
   buyer never mis-prices what they're getting.

5. **Reconciliation invariant:** Wallet "Winnings" total === sum of per-card amounts, always. One
   backend source feeds both views.

---

## 6. Web2 vs Web3 — the one real difference

- **Web2:** transfer moves winnings into their hidden Privy wallet (becomes "Balance"). They still
  need the Coinbase off-ramp to reach their bank. ~$2 Coinbase minimum applies (existing).
- **Web3:** "Balance" IS their external wallet. Transfer = send USDC straight to their MetaMask.
  No separate cash-out step — done once it lands.

---

## 7. Resolved edge cases + remaining copy items

**Resolved:**
- **Buyer KYC geo edge case:** if a buyer can't withdraw the winnings on a card (e.g. banned geo),
  that's fine — they can just **resell the card** with its winnings. No special blocking needed;
  resale is the escape hatch.
- **Gas:** Safe → wallet transfer gas is **covered by SBS** (trivial on Base). Keep the Safe funded.
- **Source of truth:** winnings are **tracked in OUR ledger** (keyed by tokenId, follows ownership),
  NOT held on the NFT/contract. The card carries a claim recorded by us, not on-chain USDC.

**Remaining (copy only, low-risk):**
- **Notification copy** (web2 vs web3 variants) — finalize wording.
- **Exact SLA wording** — "up to 2–3 business days" vs another figure.
- **What a $0-winnings card looks like** after transfer — it still exists and stays sellable (value =
  the team itself); confirm UI shows $0 winnings cleanly.

---

## 8. Do-not-forget when implementing

- This depends on Boris's reverted/reworked codebase — re-verify file paths/line numbers above
  against the new tree before editing; they reference the pre-revert code.
- Keep the manual periodic-approval model for v1. A conditional auto-sweep for already-KYC'd users is
  a possible v2 once payout patterns are known — not in scope now.
