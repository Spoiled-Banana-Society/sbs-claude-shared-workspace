# Note for Boris: Go watchdog blind spot (BBB #757, 2026-08-27)

**What happened:** 2026-slow-draft-108 (BBB #757) sat dead 3:39pm to 6:51pm PT with the watchdog sweep running every minute and reporting healthy.

Chain (all from Cloud Logging, rev 00200):
1. 16:40:50Z pick 128 `ProcessNewPick error (UpdateRosterFromPick) DeadlineExceeded` (summary written, advance + next task lost).
2. 18:39:05Z pointer heal moved it to pick 129 (pickEnd now+4h). A pointer heal cannot arm the auto-draft Cloud Task.
3. 22:39:05Z clock expired. No task. Watchdog never looked: `watchdogRecentWindow = 30` newest ids per lane = slow 112..141 that night; active slow drafts spanned 100..134. `2025-slow-draft-*` (wheel/promo specials) is not in `listRecentDraftIds` prefixes at all.

**Asks (models/draft-watchdog.go):**
- Sweep every non-complete draft instead of newest 30 by id (or window 200+). Slow drafts run for days; id order does not mean active order.
- Add `"2025-slow-draft-"` to the prefix list.
- Optional: an admin endpoint `POST /draft-actions/{draftId}/admin/rearm` (requireAdminKey) that calls `scheduleAutoDraftTask` for the current pick, so heals (manual or the pointer-heal cron) can arm the chain.

**Frontend backstop already live (commit 2858f5b0):** `/api/crons/dead-clock-kick` every 2 min POSTs `/draft-actions/{id}/owner/{drafter}/actions/autoDraft` `{currentPickNumber,currentRound,isServerPick:true}` for any draft whose clock is 3+ min past (all lanes, <48h). It relies on the autoDraft route being unauthenticated and on the "Pick already completed" guard. If you ever put auth on that route, tell me so the cron gets the header.
