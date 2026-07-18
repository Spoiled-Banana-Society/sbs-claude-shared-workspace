# Draft watchdog shipped — Go rev 00178 (2026-07-16, Richard's Claude)

**⚠️ Pull `repos/sbs-drafts-api-deploy/` before your next Go deploy** — rev 00178 is live on staging Cloud Run and the workspace copy matches it. Deploying older source would remove the watchdog.

## Why
BBB #162 (2026-fast-draft-156) froze on 7/15 with 5 picks left: Firestore returned DeadlineExceeded 3× on the `drafts/.../state/info` write mid-pick-145. The pick itself recorded fine, but the request died between the RTDB advance and the Firestore advance, and the next pick's auto-draft Cloud Task was never scheduled. Same failure family as the 6/10 draft-1381 freeze — the alert you added then fired, but nothing self-heals, so it stayed frozen all night.

## What shipped (4 files, additive — no existing behavior changed)
- `models/draft-watchdog.go` (new) — the sweep. Every minute it checks the ~30 newest **fast** drafts (slow excluded per Richard). Any draft whose pick clock is dead 45s+ gets rebuilt from the pick summary (the append-only source of truth): re-asserts the last pick's three idempotent writes, rewrites BOTH state docs to match, fresh full pick window for the on-clock user, re-schedules the standard auto-draft task. All steps idempotent; a failed repair is retried by the next sweep.
- `utils/cloudtasks.go` — added `CreateNamedCloudTask` (named tasks + AlreadyExists=success, custom headers).
- `models/draft-actions.go` — extracted `resolveAPIBaseURL()` out of `buildAutoDraftURL` (pure refactor, same behavior).
- `draft-actions/draft-actions.go` — `POST /draft-actions/admin/watchdog/sweep` gated by `X-Admin-Key` (existing `ADMIN_API_KEY`). `?dryRun=true` = report only.

## Trigger: self-re-arming Cloud Task chain (not Cloud Scheduler)
Each sweep first arms the next TWO per-minute sweeps as named tasks (`draft-watchdog-sweep-<unixMinute>`, deduped) on the existing auto-draft queue — so one lost/crashed sweep can't kill the chain. Cloud Scheduler would be nicer long-term but needed an interactive gcloud login Richard's machine couldn't do headless; if you add a Scheduler job later it can safely coexist (sweeps are idempotent no-ops when healthy). If the chain ever dies (e.g. queue purge), re-seed with one curl:
`curl -X POST "$API/draft-actions/admin/watchdog/sweep" -H "X-Admin-Key: $ADMIN_API_KEY"`

## Guardrails
- **`2026-fast-draft-156` exclusion is now INERT** — Richard's 5 collected picks were entered 7/16 ~1:51pm PT and the draft closed cleanly (10× close.card_done, zero errors; the rev-00179 counter-sync healed the stale state/info doc 145→150 in production). Delete the `watchdogExcludedDrafts` entry in `models/draft-watchdog.go` whenever you next touch the repo — it does nothing now (complete drafts are skipped before the exclusion check).
- 48h zombie cutoff (never revives old wreckage), fast-prefix only, 30-draft window, structured `watchdog_*` ERROR events on every action so repairs show in the admin Logs feed.
- Verified live: dry-run + real sweep both report 156 as `excluded_skipped` and everything else healthy; 156 confirmed byte-identical before/after.

## UPDATE same day — pick-path hardening also shipped (Go rev 00179)
Richard spotted that the frozen pick was a HOUSE BOT's (onBotTurn log confirms: `pick rejected 2026-fast-draft-156 0x4a875da7... 400 DeadlineExceeded on state/info`). Bots pick via the manual `/actions/pick` route, which — unlike the auto-pick task path you hardened after 6/10 — had no transient-failure recovery. Richard asked to close that exposure, so rev 00179 adds three surgical changes:
1. **`submitPick` builds `PickNum`/`Round` from RTDB realTimeDraftInfo** (same doc ProcessNewPick validates against) instead of Firestore state/info — a doc divergence can no longer auto-reject every pick. The now-unneeded `ReturnDraftInfoForDraft` read was removed from the handler.
2. **`ProcessNewPick` syncs draftInfo counters FROM realTimeDraftInfo** after the advance (assignment, not independent `++`) — any divergence self-heals on the next successful pick instead of persisting one-apart forever.
3. **`scheduleAutoDraftTask` moved to immediately after `realTimeDraftInfo.Update`**, BEFORE the fallible `draftInfo.Update` — a state/info timeout can no longer eat the next pick's timer. Note: if `draftInfo.Update` fails now, the caller still gets an error/400 even though the pick fully stood (recorded + advanced + timer armed) — cosmetic mismatch, flagged so you're not surprised by a "rejected" bot log for a pick that's on the board.
With these three, a repeat of 7/15 (same Firestore blip, same bot pick) costs nothing: draft keeps drafting, docs re-converge one pick later, watchdog never needed. Verified live on real picks after deploy.

## Still open (your call, next Go deploy)
- The earlier Go ride-alongs (too-early pick guard etc.) are still queued.
