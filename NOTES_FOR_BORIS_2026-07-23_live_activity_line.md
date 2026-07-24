# Live draft-activity line — shipped 7/23 (dark), FYI + two things to know

Richard asked for a "keep waiting" nudge: **"5 drafts going · a draft is on Round 14"** —
people sitting in a lobby see a draft is about to wrap and know those players roll
into the next room. Same string on every surface, all driven by ONE value.

## How it works (one value, four readers)
- **Go (rode along in rev 00185):** `models/live_activity.go` + 2 lines in `main.go`.
  Every 10s a background goroutine scans the last ~100 fast-draft RTDB nodes
  (`realTimeDraftInfo`), counts in-progress ones (`isDraftComplete==false`, started),
  takes max `roundNum`, writes `stats/liveDraftActivity` = `{count, round, updatedAt}`.
  READ-ONLY against draft state; off the pick path; panics recovered; a dead
  aggregator = stale `updatedAt` = every reader hides the line (fail-closed).
  Kill switch without redeploy: env `LIVE_ACTIVITY_AGGREGATOR=off`.
  Slow drafts and wheel-won specials are excluded by construction (only
  `2026-fast-draft-N` ids are scanned).
- **Frontend (dark):** shared `LiveDraftActivityLine` component subscribes to that one
  RTDB node — placed in the lobby (under the Drafts header) and the draft-room
  filling state (under "Waiting for players…"). No fetch anywhere near it (Rule #0
  safe). Gated by `NEXT_PUBLIC_LIVE_ACTIVITY_ENABLED === 'true'`, default off.
- **Fill-alert feed (`/api/bot/league`):** appends the line as a SNAPSHOT after the
  odds. It is kept OUT of the change-detection `base`, so a round ticking up can
  NEVER cause an extra Discord/X ping — it only rides along when a ping was
  already going out. Your banana-dedup ledger is untouched.

## The two things to actually know
1. **RTDB rules were updated on BOTH instances (staging + prod) 7/23.** Added
   `stats/liveDraftActivity: .read true, .write false`. While in there I found
   `database.rules.json` in the repo was MISSING `globalChatPing` + `presence`
   that exist in the live rules — if anyone had blind-applied the repo file, chat
   pings/presence would have broken. The repo file is now synced to live reality.
   Rule of thumb going forward: GET live rules and merge, never PUT the file blind.
2. **Go deploy 00185 came from a drift-checked copy.** Before deploying I verified
   `~/sbs-drafts-api-deploy` (Richard's machine) was byte-identical to
   `repos/sbs-drafts-api-deploy` (== deployed 00184), so your wedge fixes
   00183/00184 are all still in. Your own `~/sbs-drafts-api-deploy` may still be
   behind — pull the workspace before YOUR next Go deploy or you'd revert
   00183/00184 AND this.

## Status / rollout
- Go aggregator: deployed 7/23 (verify marker: `[live-activity] published` in logs;
  node visible at `https://sbs-prod-env-default-rtdb.firebaseio.com/stats/liveDraftActivity.json`).
- Frontend: shipped dark. Flag flip = add `NEXT_PUBLIC_LIVE_ACTIVITY_ENABLED=true`
  in Vercel + redeploy (it's a NEXT_PUBLIC var, build-baked).
- Known nuance (accepted): a draft in its 60s fill-countdown counts as "going" for
  ~a minute (its RTDB node exists at round 1 pre-picking). Richard ok'd the
  imprecision — "couple picks behind is fine".

— Richard's Claude, 7/23
