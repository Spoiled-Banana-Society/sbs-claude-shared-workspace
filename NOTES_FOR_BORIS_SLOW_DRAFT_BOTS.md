# FYI: slow-draft bot timing shipped (2026-07-21)

Richard's call: a house bot in a **slow draft** should answer at a random point while the
pause-aware clock still reads **between ~7:55:00 and 6:00:00 left** — hours into its 8h
window like a human, not 30–90 seconds in like the old path (which would have read as
instant answers around the clock, including overnight).

## What changed (functions, deployed from ~/sbs-staging-functions, synced to repos/sbs-staging-functions)

- **`onBotTurn`** (updated, deployed 7/22 02:46 UTC): for `pickLength >= 3600` it no longer
  sleeps-and-picks. It writes a task to Firestore **`botPickQueue/{draftId}`**
  (`drafter`, `pickNumber`, `targetClockSec`, `pickLength`) and exits. Fast-draft path is
  byte-identical to before (still 1–21s dials). The pick logic itself moved verbatim into a
  shared `submitBotPick()` — no strategy changes.
- **`botSlowPickWorker`** (NEW, 1st-gen pubsub cron, every 5 min, PT timezone): re-verifies
  against a fresh RTDB read (same drafter, same pickNumber, window open, never <2 min from
  the buzzer), computes clock-remaining with **`functions/slowDraftClock.js`** — a JS port of
  banana-fantasy `utils/slowDraftClock.ts` / your `models/slow_draft_clock.go` (keep all
  three in sync) — and submits the pick once the clock crosses the task's target. Because
  the clock freezes 22:00–05:00 PT, a target can only be crossed during active hours, and
  the worker also hard-skips ticks inside the pause window: **bots never pick overnight.**
  Failed submits keep the task and retry next tick; the engine buzzer remains the backstop.
- **Dials** (in `system_config/botBrain`, no redeploy needed): `slowPickMinClockSec: 21600`,
  `slowPickMaxClockSec: 28500`. `slowMin/MaxDelaySec` now only apply to the
  `pickLength <= 0` fallback path.

## One loose end

The staging firebase SA can't create Cloud Scheduler jobs, so the worker function is
deployed + ACTIVE and its pubsub topic exists, but the **scheduler job that fires it is
pending** a `gcloud auth login` on team@ (Richard is doing this). Until the job exists, a
bot in a slow draft would enqueue and then buzzer-pick at 0:00 via the engine — no freeze
risk, just ugly. No bots are in any slow draft today.

Offline verification: clock port checked against known PT-pause cases; 5-min-tick
simulation confirms firing times for turns starting 9am / 8pm / mid-pause / 9:50pm all land
inside the 6:00:00–7:55:00-left window and never during the pause.

— Richard's session, 2026-07-21
