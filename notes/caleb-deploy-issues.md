# Deploy review: issues found in the audit deploy, what we reverted, and why

**Bottom line:** the frontend half of the audit deploy introduced 4 draft regressions, 1 security hole, 2 money/integrity bugs, and a buried behavioral change. We reverted the **entire frontend** to the pre-deploy baseline and **kept the backend** (it's good). It was deployed without a live draft test — one end-to-end draft would have caught all 4 regressions. Details below, with file refs.

---

## 1. Draft regressions (all 4 user-reported, all frontend)

**#1 — "Reconnecting to draft" flash on every re-entry (desktop + mobile).**
Root cause: `getDraftInfo` (a PUBLIC read, no wallet in the path) was rerouted through the new authed BFF proxy (`/api/drafts-api` → Privy token fetch → Vercel serverless hop → JWT verify → 2nd hop to Go). The room's loading screen blocks on that read, so the added latency turned a previously-invisible gate into a visible flash. The read has **no wallet → zero security benefit** from the proxy; it's pure latency.

**#2 — Draft type shows "pro" before the reveal / slot animation skipped.**
Root cause: the reveal anchor was moved from the fresh, draft-scoped REST `draftStartTime` to the **raw RTDB node, with no stale-node guard** — even though the sibling pick-progress subscription right next to it explicitly has that guard. Staging reuses draft IDs, so the persistent `realTimeDraftInfo` node can hold a *previous* draft's start time, which collapses the reveal window → type paints early, animation skipped. It also writes that bad anchor into the shared draftStore that the draft room reads.

**#3 — Pre-draft countdown flickers 0 → 1 → 0 → 30.**
Root cause: `Math.floor` → `Math.round` in the draft-start countdown branch. The old floor showed a steady `0` in the final sub-second before start; round injects a phantom `1`. (The backend +1s grace + the display cap are fine and we kept that behavior — the rounding change was the bug.)

**#4 — End-of-draft lag on mobile: card already generated, roster slow to show.**
Root cause: the card-ready fetch (`/owner/{wallet}/drafts/{id}`, also a public read) was rerouted through the authed BFF proxy. It went from a fast direct GET to a slow, failure-prone path — any auth/key hiccup makes it retry 3s × up to 10 = **~30s "generating" hang** even though the card was already done server-side. Live logs from two real drafts confirmed the slow path.

---

## 2. Security hole INTRODUCED (not fixed)

**`app/api/owner/mint/route.ts` — user-callable, no payment check.**
This new route calls the Go mint endpoint with `{numberOfTokens}` / an arbitrary id range and **no verification of payment or on-chain ownership**. Any logged-in user could POST it and grant themselves draft passes for free. In prod the Go layer's on-chain ownership check contains it, and its only caller is dead code so it wasn't exploited — but it's a **live POST endpoint** and should never have been exposed. Removed in the revert.

---

## 3. Money / integrity bugs

**Promo firing lost its fallback.** `draft-complete` and `pick10` promos were moved to fire **only** on an RTDB push (the old 3s REST poll that also fired them was removed). If RTDB lags, is denied, or the node is missing, the promos **never fire** — users silently lose daily-draft credit and pick-10 spins. The old REST path was immune to RTDB availability.

**Empty draft-order cached forever.** `ensureDraftOrder` does `if (cached) return cached` — an empty array `[]` is truthy. If `getDraftInfo` returns `draftOrder: []` once (common right at fill), it's cached for the draft's whole life → wrong "N picks away" and **pick10 never fires** for that user.

**Lobby timer can show 31 / duplicate listener.** A second `subscribeRealTimeDraftInfo` was added on the same node the existing pick-progress effect already listens to, and its timer write (line ~838) is uncapped (`Math.ceil` → can show 31). Two listeners on one node + last-writer-wins on the timer field.

---

## 4. Buried behavioral change

**`queues/create-draft` was rewritten inside a "security" commit.** The clean `ensureSpecialDraftSeat()` call was replaced with a ~90-line inline mint/join/fill/poll flow that has **~23 seconds of blocking sleeps** (Vercel function-timeout risk) and **immediately fills the draft with bots** — which contradicts the special-drafts "real-user fill / lock-at-fill" design. This is a product-behavior change hidden in a security PR. (We kept the auth fix in that route — deriving the user from the session was correct — and reverted the rest.)

---

## 5. Process

- The backend branch initially **did not compile** (`draftInfo redeclared` / a double-advance from a bad merge) — it was never built or run before the merge. (Fixed later in PR#2.)
- The whole thing was **deployed without a live draft test.** One end-to-end draft on the real staging URL would have surfaced all 4 regressions immediately.

---

## What we KEPT (your work that's good)

- **The backend (rev 00154):** 30s timer (+1s grace), 1s auto-pick, idempotent pick handling (`ErrPickAlreadyProcessed` + Cloud Tasks name-dedup), and the CORS allowlist. Audited clean and live-validated on two real drafts — zero engine errors. The earlier double-advance was correctly removed before the final deploy.
- **The `joinDraft` missing-id guard** (throw instead of fabricating `${Date.now()}`) — a genuine bugfix; we re-added it on top of the baseline.
- **The intent** of the IDOR/wallet-auth security is correct and valuable — see below.

## What we DID

Reverted the **entire frontend deploy** to the pre-deploy baseline; **kept the backend**; preserved our own post-deploy promo fixes; re-added the `joinDraft` guard; removed the self-mint route. The draft system is back to the proven baseline + the backend's 30s/1s/freeze fixes.

## The security work — deferred, not rejected

The wallet-impersonation protection (`assertSessionWallet` + Go auth) is worth doing. But as shipped it was **dormant** (`DRAFTS_API_AUTH_ENABLED` off), so it added the BFF latency/failure surface **without turning on any actual protection** — worst of both. When we do it, it needs: the Go auth flag ON, the service key set in **both** Vercel and Cloud Run, `PRIVY_APP_SECRET` confirmed (web2 login breaks without it), and **every core flow live-tested** (pick/join/buy/leave × web2/web3 × desktop/mobile). It's a careful, separately-tested project — not bundled with unrelated changes.

---

## The rules going forward

1. **Never route public reads (no wallet) through the authed proxy.** Pure latency, zero security — it caused 2 of the 4 regressions.
2. **Never read realtime state from a raw RTDB node without the stale-node guard.** Staging reuses IDs.
3. **Never remove a REST fallback for money-affecting actions** (promo firing).
4. **Never bury product-behavior rewrites inside a security commit.**
5. **Never expose an unauthenticated mint/grant endpoint.**
6. **Always live-test a full draft before deploying draft changes.** One draft catches all of this.
7. **Build it before you merge it.**
