# Go API deployed: watchdog now covers slow drafts (rev 00192) — PULL BEFORE ANY GO DEPLOY

**2026-08-05, from Richard's session.** `sbs-drafts-api-staging` rev **00192-s6w** is live. One file changed: `models/draft-watchdog.go`. Your `~/sbs-drafts-api-deploy` copy is now BEHIND — if you deploy Go without picking this up, you revert the watchdog upgrade. Grab the live source zip (drift-check style) or copy the file from my machine before your next Go deploy.

## Why
BBB #343 (`2026-slow-draft-26`, ticket-3340) wedged today at pick 115: KielyOtherside's pick landed in the summary, but the roster write died on Firestore DeadlineExceeded, so the turn never advanced. Two gaps let it sit for hours:
1. The watchdog only swept `2026-fast-draft-*` — slow drafts had no guard at all.
2. Even sweeping, the dead-clock trigger can't see this shape: the 8h clock keeps ticking after a lost advance.

Bonus discovery: ProcessNewPick's three pick writes fan out concurrently, so a REJECTED pick can still land its roster append. Kiely's later rejected JAX-DST attempt polluted their roster, which would have blocked even the watchdog's own roster re-assert (13 > 12 capacity error).

## What changed in draft-watchdog.go
- Sweep now covers both lanes: newest 30 fast + newest 30 slow (`listRecentDraftIds`, one collection pass).
- New WEDGE trigger: clock alive, current pick ≥120s old, and the summary already holds the current pick number → advance was lost, repair now instead of waiting for clock death. Costs one summary read per slow draft per sweep (~$1/mo); fast lanes never reach it (their dead clock always trips first).
- Repair windows are pause-aware on slow lanes (`SlowDraftPickEndUnix`), and pickLength fallback is 28800 for slow.
- New repair step 0a `evictRosterPhantoms`: drops roster entries the summary doesn't credit to that owner (the JAX-DST case). Summary is authority; dry-run reports without writing.
- New repair step 0b `releasePlayerStateOrphans`: releases playerState holds corroborated by neither summary nor any roster (the mirror failure — summary write lost, playerState landed — which permanently blocks a slot via the conflict guard). Same refusal rule as ForcePlayerStateToSummaryPick: anything on a roster is never touched.

## Verified after deploy
- Dry-run sweep over all 60 live candidates: 60 healthy, zero false positives.
- BBB #343 itself was hand-repaired earlier today (phantom evicted + idempotent pick replay through the normal endpoint); it's flowing again — details in Richard's session memory `project_bbb343_kiely_halfcommitted_pick115`.

— Richard's Claude
