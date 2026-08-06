# Alchemy Transfer webhook has NEVER delivered — needs a dashboard fix

**2026-08-05 (Richard's session)**

## What happened
tomalom69 (`0x615fe938…`) sent two draft passes wallet-to-wallet on 8/4 — NFT **3995** to roarstone (`0x2ca38068…`) and NFT **3996** to cdecarlo24 (`0x466d16ec…`). Neither side's SBS balance updated: the sender kept two phantom spendable passes, the recipients got nothing.

## Root cause
Out-of-app transfers (OTC sends, OpenSea-native sales, accepted offers) are only synced by the Alchemy "Address Activity" webhook → `/api/webhooks/alchemy/transfer` → `reconcilePassesForWallet`. **The `alchemy_webhook_events` collection is completely empty — Alchemy has never delivered a single event.** The endpoint itself is healthy: it's deployed, `ALCHEMY_WEBHOOK_SIGNING_KEY` is set (verified — an unsigned probe gets a proper 401), so the problem is on the Alchemy dashboard side. Neither of us can see the dashboard from Richard's machine, so one of you needs to log in and check. Most likely causes:

1. **The webhook still watches the OLD contract.** The signing key was added to Vercel ~105 days ago (≈April), well before the 6/22 swap to the live contract `0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80`. If the dashboard's tracked address is `0x781B2E6f…` (retired) or V1, we get nothing.
2. **The webhook URL uses `www.`** — `https://www.sbsfantasy.com/...` 307-redirects POSTs to the apex, and webhook senders don't follow redirects. It must be `https://sbsfantasy.com/api/webhooks/alchemy/transfer`.
3. Webhook deleted/disabled entirely.

If you recreate the webhook, Alchemy issues a NEW signing key — update `ALCHEMY_WEBHOOK_SIGNING_KEY` in Vercel prod env and redeploy, or the route will 401 every delivery.

## What's already done (no action needed)
- The three affected wallets were repaired by hand on 8/5, verified against on-chain `ownerOf` first: tomalom69 3→1 passes, roarstone +1, cdecarlo24 +1. Go re-homed the tokens under synthetic card ids with `RealTokenId` set correctly (script: `banana-fantasy/scripts/_fix-tomalom-otc-transfer.mjs`, dry-run default).
- **New cron shipped: `/api/crons/reconcile-pass-transfers` (every 5 min)** — scans BBB4 Transfer events straight from the chain (cursor in `config/passTransferScan`) and runs `reconcilePassesForWallet` on every wallet in a non-mint transfer. This closes the hole from our side even if the dashboard never gets fixed; the webhook, once fixed, just makes sync instant instead of ≤5 min. Both are idempotent, so they coexist fine.

## Why this mattered beyond cosmetics
A phantom pass is **spendable** — entry gates on `owners/{w}/validDraftTokens`, which is exactly the record that goes stale. A seller could use a pass they'd already sold. The cron shrinks that window to ≤5 min.
