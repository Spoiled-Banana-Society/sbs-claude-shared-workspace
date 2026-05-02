# Disaster Recovery Runbook

**Owner:** SBS engineering. **Pager:** Boris (`@boris`) → Richard (`@richard`).
**Last reviewed:** 2026-05-02.

This runbook covers incidents that hit the live Banana Best Ball 4 stack:
Vercel (Next.js frontend + API routes), two Cloud Run services
(`sbs-drafts-api-staging|prod`, `sbs-drafts-server-staging|prod`),
Firestore + Firebase Realtime DB, and the BBB4 NFT contract on Base
mainnet (`0x14065412b3A431a660e6E576A14b104F1b3E463b`).

For every incident: open a thread in the SBS Discord ops channel,
note the request ID(s) you're investigating, and link the relevant
Sentry / Cloud Logging URLs.

---

## 0. First five minutes (any incident)

1. Check Vercel deployment status: https://vercel.com/spoiled-banana-society/sbs-frontend-v2
2. Check Cloud Run revision health:
   `gcloud run services describe sbs-drafts-api-staging --region us-central1`
3. Check Sentry: https://sentry.io/ — filter by environment + last 30 minutes.
4. Check Cloud Logging:
   `gcloud logging read 'severity>=ERROR' --limit 50 --project sbs-staging-env`
5. Check Discord ops channel for active reports.

---

## 1. "Nothing loads" / Vercel deploy broken

**Symptom:** Frontend returns 500/blank/build-error.

**Steps:**
1. Vercel dashboard → most recent deployment.
2. If build failed → revert: Vercel UI "Promote to Production" the prior
   green deploy. Takes ~30 seconds.
3. If runtime crashing → check Sentry for the error pattern.
   Common causes: missing env var (fail-loud helpers in `lib/appConfig.ts`
   crash startup), wrong `FIREBASE_SERVICE_ACCOUNT_JSON`.
4. Fix env var in Vercel dashboard → trigger redeploy.

**Mean time to recovery (MTTR):** 5 min (rollback) / 15 min (env-var fix).

---

## 2. Card / USDC purchases failing

**Symptom:** Users report "couldn't buy passes" or MoonPay completes but no NFT.

**Steps:**
1. Check `https://sbs-drafts-api-staging-…run.app/` returns 200 (or prod equivalent).
2. Check admin wallet ETH balance for gas:
   `curl https://banana-fantasy-sbs.vercel.app/api/purchases/admin-wallet`
   → `{ healthy: true, balance: "..." }`. If `balance` < `0.0005 ETH`, refill.
3. Check Sentry for `card-mint.*` events. Common patterns:
   - `card-mint.permit_failed`: user's USDC permit signature was bad/expired
   - `card-mint.transferFrom_failed`: insufficient USDC balance
   - `card-mint.mint_failed_after_payment`: USDC pulled but mint reverted
     → check `failed_mints` Firestore collection for the user — admin can
     replay manually
   - `card-mint.credit_failed_after_mint`: NFT minted on chain but Firestore
     credit failed → on-chain is source of truth, balance route will
     reconcile within minutes via Alchemy writethrough
4. If MoonPay-side issue: ask user for the MoonPay transaction ID, check
   Privy dashboard for the funding event.

**MTTR:** 5 min (admin wallet refill) / 30 min (failed_mint replay) / case-by-case (MoonPay disputes).

---

## 3. Draft room frozen / picks not registering

**Symptom:** Users in a draft can't pick or see other picks.

**Steps:**
1. Check WS server health:
   `curl https://sbs-drafts-server-staging-…run.app/`
2. Check WS server logs for the affected `draftId`:
   `gcloud logging read 'resource.labels.service_name="sbs-drafts-server-staging" AND jsonPayload.draftId="…"' --limit 50 --project sbs-staging-env`
3. Look for these structured events (added in Phase 11):
   - `manual_pick_rejected_late|wrong_address|wrong_turn`: client tried to
     pick when shouldn't — user error, not server
   - `timer_advance_failed`: WS server couldn't advance turn — drain to
     next user via admin endpoint
   - `manual_pick_failed`: pick rejected by Go API
4. If WS is unreachable but HTTP works: WS server probably crashed.
   Cloud Run will restart automatically. Check revision status.
5. Stuck pick: admin can force-advance via
   `POST /draft/{draftId}/cleanUpDraft` (X-Admin-Key required) — this is
   a clean-slate reset; user gets free re-entry.

**MTTR:** 2 min (WS restart) / 10 min (manual draft cleanup).

---

## 4. VRF batch stuck (won't reveal draft type)

**Symptom:** Drafts complete but the JP/HOF/Pro reveal never fires.

**Phase 11 added auto-recovery + structured logging.** Search Sentry/Cloud
Logging for:
- `batchproof.recovery.attempt_ok`: recovery succeeded automatically
- `batchproof.recovery.attempt_failed`: this attempt failed; auto-retry
  pending (up to MaxRecoveryAttempts=5)
- `batchproof.recovery.given_up`: severity=ERROR, **manual intervention required**

**Steps for `given_up`:**
1. Note the `batchNumber` from the log line.
2. Call manual recovery:
   ```
   curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
     https://sbs-drafts-api-staging-…run.app/admin/batchproof/recover/{batchNumber}
   ```
3. If recovery still fails: check on-chain VRF subscription has LINK,
   check VRF coordinator's pending requests in BaseScan, manually fund
   if needed.

**MTTR:** Auto-recovery (5 min) / manual (30 min if VRF state weird).

---

## 5. KYC / Withdrawal rejected unexpectedly

**Symptom:** User has Tier 1 KYC but withdraw returns 403.

**Steps:**
1. Pull user's KYC record:
   ```
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://banana-fantasy-sbs.vercel.app/api/eligibility?userId={wallet}
   ```
2. If `tier1Verified: false` despite Didit completion: check Didit webhook
   was received (Sentry: `didit.webhook.received` event) and processed
   (`didit.webhook.verified`).
3. If webhook missing: Didit dashboard → resend webhook for the user's
   session. Verify HMAC signature succeeds (`didit.webhook.invalid_signature`
   means `DIDIT_WEBHOOK_SECRET` is wrong).
4. Manual override if needed:
   ```
   curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
     https://banana-fantasy-sbs.vercel.app/api/admin/kyc-verify \
     -d '{"userId": "0x...", "tier": "tier1", "verified": true}'
   ```
   This is logged via `admin.kyc_verify.ok` for audit.

**MTTR:** 5 min (webhook resend) / 10 min (manual override).

---

## 6. Database (Firestore) outage or data corruption

**Symptom:** All routes return 503 or wildly wrong data.

**Steps:**
1. Check Firebase Console status: https://status.firebase.google.com/
2. If Google-side outage: there is no recovery action. Post status to
   users via Discord. App degrades gracefully to local fallbacks where
   possible (e.g., active drafts list reads from localStorage).
3. If single-document corruption (rare): manual repair via Firebase Console
   or `gcloud firestore` exports + targeted reimport.

**Recovery point objective (RPO):** Whatever Firebase guarantees
(generally <1s). **Recovery time objective (RTO):** Out of our control
during a Google outage.

---

## 7. Admin wallet drained / private key compromised

**This is the worst-case incident.** `BBB4_OWNER_PRIVATE_KEY` controls
mints + VRF commits. If exposed:

1. **Immediately:** rotate the key on Cloud Run (set new
   `BBB4_OWNER_PRIVATE_KEY` env var on both services + redeploy).
2. **Within 1 hour:** call `transferOwnership(newOwner)` on the BBB4
   contract from the OLD key (if still controllable) to a fresh address,
   then point `BBB4_OWNER_PRIVATE_KEY` at the new address.
3. **Long-term mitigation:** migrate to a 2-of-3 Safe multisig (see
   `project_contract_baseuri_freeze` memory + the `multisig` future task).

**Why this matters:** A single compromised key currently = total mint
authority. Multisig migration is the #1 long-term security investment.

---

## 8. SA key leaked / git history scrub needed

**Symptom:** Internal alert that a service-account JSON appeared in a
git diff or pasted snippet.

**Steps:**
1. GCP Console → IAM → Service Accounts → identify which SA
2. Click the SA → "Keys" tab → "Disable" the leaked key (this is the
   fast-path; takes <1 min)
3. Generate a new key, update wherever the SA is used:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` on Vercel
   - `triggersServiceAccount.json` if it's the firebase-triggers SA
4. Once the new key is verified working, "Delete" the old key
5. Optional: `git filter-repo` history scrub + force-push (talk to team
   first; rewrites everyone's clones)

**Known historical leaks (must rotate before prod cutover):**
- `firebase-triggers SA` — leaked in `~/sbs-drafts-api-deploy` git history
- `firebase-adminsdk-fbsvc@sbs-staging-env` — was inlined as
  `STAGING_SA_B64` in `lib/firebaseAdmin.ts` (removed in Phase 7 but
  still in git history)

---

## 9. Useful commands

**Tail Cloud Run logs in real time:**
```bash
gcloud logging tail 'resource.labels.service_name="sbs-drafts-api-staging"' \
  --project sbs-staging-env
```

**Find a request by ID across services:**
```bash
# Same X-Request-ID flows from Next.js → Go (Phase 13)
gcloud logging read 'jsonPayload.request_id="abc123"' \
  --project sbs-staging-env --limit 50
```

**Replay a stuck card-mint:**
```bash
# 1. Find the failed mint in Firestore
gcloud firestore export gs://… # or browse Firebase Console
# 2. Look for failed_mints/{purchaseId} entries with retryable: true
# 3. Manually re-trigger the mint via /admin/* endpoints if needed
```

**Force a Vercel redeploy (e.g., after env-var change):**
```bash
cd ~/banana-fantasy && git commit --allow-empty -m "force redeploy" \
  && git push origin main
```

---

## 10. Escalation

If you can't resolve within MTTR target, escalate:
1. Discord ops channel `@here` with: incident timeline, current symptom,
   what you've tried, request IDs
2. Boris direct (Signal/phone if Discord is silent)
3. Richard direct
4. Last resort: post status to user-facing Discord, degrade gracefully
   (e.g., disable purchases via env-var feature flag rather than crash)

Document every incident post-hoc in `docs/incidents/{date}-{slug}.md` so
the team learns. Even small ones — a 2-min outage on a Saturday is a
real signal that something needs hardening.
