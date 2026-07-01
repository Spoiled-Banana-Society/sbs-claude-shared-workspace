# On-deck SMS alerts for FAST drafts — ✅ DEPLOYED 2026-06-30 (sbs-drafts-api-staging rev 00169-7j4)

> Deployed from a clean go1.20 build copy because local ~/sbs-drafts-api-deploy has an
> unfinished go1.25 upgrade that can't build with the go1.20 Dockerfile. That upgrade WIP
> was left untouched. The GitHub `staging` branch is frozen at 2026-06-14 and was NOT updated.
> Details + safe-deploy recipe: memory `reference_go_backend_deploy_reality_2026_06_30`.


## What & why
Fast drafts (30s/pick) send a per-pick SMS via OneSignal saying **"You're on the clock…"**
to the player whose turn it just became. 30s is too little time to react to an
alert sent AT your turn. Change: for FAST drafts, alert the **on-deck** player
(the pick before theirs) with **"Your pick is next…"**. Slow drafts unchanged.

This is the Go API path `NotifyPickReminderSMS` (models/sms_notify.go), fired from
`ProcessNewPick` (models/draft-actions.go). It was NOT the Cloud Function
(onPickAdvance) — that's a separate Discord/Telegram/push system that gates fast off.

## The change (already applied in ~/sbs-drafts-api-deploy, NOT yet deployed)
- `models/sms_notify.go`: added `NotifyOnDeckSMS()` — copy: `Your pick is next in "<league>" — get ready. Open the SBS app.` Same eligibility gate (`OwnerEligibleForSmsPickReminder`) so opt-outs are respected.
- `models/draft-actions.go`:
  - In `ProcessNewPick`, the reminder now branches: **slow** → `NotifyPickReminderSMS(nextDrafter)` (on the clock, unchanged); **fast** → `NotifyOnDeckSMS(onDeck)` where onDeck = drafter of the NEXT pick (skips bots + the final pick).
  - Added helper `onDeckOwnerForNextPick(draftInfo)` — mirrors the existing snake index math for pick N+1; returns "" past pick 150.
- Coverage: picks 3–150 get a one-pick-early "your pick is next"; picks 1–2 are already covered by the draft-start blast (`NotifyDraftStartingSMS` → all members). The on-clock player no longer gets an at-your-turn SMS on fast (that's the point — they were alerted a pick early).

## NOT done / caveats
- **Not compiled** here (no local Go toolchain) and **not deployed** (gcloud auth expired). Cloud Run's source build compile-checks it, so a typo fails the build rather than reaching prod. Field/type usage was verified against the structs.
- No dedup on this SMS (same as the existing reminder). If `ProcessNewPick` ever double-runs, the on-deck SMS can double-send — pre-existing exposure, unchanged.
- Deployed backend truth = `sbs-drafts-api` `staging` branch; deploy source `~/sbs-drafts-api-deploy` verified to match it before editing.

## Deploy steps (Richard or mod)
```bash
# 1. Drift check — should show ONLY draft-actions.go + sms_notify.go differing (the new change)
diff -rq ~/sbs-drafts-api-deploy/ ~/sbs-claude-shared-workspace/repos/sbs-drafts-api-deploy/ \
  --exclude=.git --exclude=node_modules --exclude=configs --exclude=.env --exclude=.DS_Store --exclude=*.bak

# 2. Auth (interactive — run with ! prefix in the session)
gcloud auth login

# 3. Deploy the REST API (this compiles the Go)
gcloud run deploy sbs-drafts-api-staging --source ~/sbs-drafts-api-deploy \
  --region us-central1 --project sbs-staging-env

# 4. Verify traffic routed to the new revision
gcloud run services describe sbs-drafts-api-staging --region us-central1 \
  --project sbs-staging-env --format="value(status.traffic[0].revisionName)"

# 5. AFTER a good deploy: sync deploy-source → shared workspace + push, and push staging branch for the dev
rsync -av --exclude=.git --exclude=node_modules --exclude=.env --exclude=.env.* --exclude=configs \
  --exclude=*.bak --exclude=vendor --exclude=*.log --exclude=.DS_Store --exclude=sbs-drafts-api \
  ~/sbs-drafts-api-deploy/ ~/sbs-claude-shared-workspace/repos/sbs-drafts-api-deploy/
cd ~/sbs-claude-shared-workspace && git add repos/sbs-drafts-api-deploy/ && git commit -m "Sync sbs-drafts-api: on-deck SMS for fast drafts" && git push origin <branch>
cd ~/sbs-drafts-api-deploy && git push origin staging
```

## How to test after deploy
Join a FAST draft (with an SMS-eligible number on your account). You should get
"Your pick is next…" when the player before you goes on the clock — NOT at your
own turn. Slow drafts should still say "You're on the clock."
