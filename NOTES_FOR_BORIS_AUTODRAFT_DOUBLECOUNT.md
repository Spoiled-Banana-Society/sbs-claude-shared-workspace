# Boris — backend fix: auto-draft "double-count" bug (2026-06-24)

From Richard's Claude. This is the backend half of a two-part fix for the
"my pick got auto-drafted when I didn't want it to" reports. The **frontend
half is already shipped** (see bottom). This note is the **Go backend** part —
it needs a `gcloud run deploy` to staging, which is your lane.

---

## TL;DR

When a pick times out, the auto-draft Cloud Task can run **twice** for the
**same pick** (Cloud Tasks is at-least-once, and our handler holds the request
open while it `time.Sleep`s, which invites redelivery). The current deployed
handler increments `NumPicksMissedConsecutive` **before** it confirms this run
actually made the pick — and it **no longer re-checks draft state after the
sleep**. So both copies of the job bump the counter → **one timeout pushes the
counter up by 2** → `AutoDraft` flips on → and at a **snake turn** (your two
back-to-back picks) the second pick fires **instantly with no clock**.

**Fix:** after the sleep, re-fetch draft state and bail if the pick already
advanced — *before* touching the counter. This restores a guard that an older
version of this handler had and the current deployed version dropped.

---

## Symptom (what users reported)

- A user with **one device** (no multi-tab), at the **turn** later in the draft,
  let **one** pick time out — and his **second** back-to-back pick auto-drafted
  immediately with no timer. He insists he had not auto-drafted before.

That's exactly what the double-count produces: he only needed the counter to
reach 2, and one timeout did it because the job ran twice.

---

## Root cause (confirmed in live logs)

File (deployed = `sbs-drafts-api` **`staging` branch**):
`draft-actions/draft-actions.go` → `func (dra *DraftActionResources) autoDraft(...)`

The timer-expiry branch (the `else` of `if userInfo.AutoDraft`) currently does:

1. **Top of handler (BEFORE the wait):** `if realTimeDraftInfo.CurrentPickNumber > currentPickNumber { return 200 "already completed" }`  ← the *only* idempotency check
2. `time.Sleep` until `PickEndTime`
3. `userInfo.NumPicksMissedConsecutive++`  ← **counter bumped here**
4. `if NumPicksMissedConsecutive >= 2 { userInfo.AutoDraft = true }`
5. `UpdateSortForDrafter(...)`  ← **counter PERSISTED here**
6. `ProcessNewPick(...)`  ← can fail "already drafted / not the owner"

The race: a redelivered duplicate of pick N's job passes step 1 (pick N not
made yet), sleeps, wakes — and with **no re-check after the sleep** it runs
steps 3–5 even though the first run already made pick N during the sleep. So
the duplicate **persists a second increment** before failing harmlessly at
step 6. Net: **+2 to the counter from one timeout.**

(Why persist-before-`ProcessNewPick` exists: `ProcessNewPick` spawns the
goroutine that schedules the NEXT pick's task, and that scheduler re-reads
`userInfo` to decide instant-vs-full-clock. For a snake-turn back-to-back pick
the next pick is the same user, so the counter must be persisted first or the
scheduler reads the stale value. **Keep that behavior** — the fix below does.)

### Log evidence (staging, project `sbs-staging-env`)

```bash
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="sbs-drafts-api-staging"
  AND (textPayload:"autoDraft error (ProcessNewPick" OR textPayload:"already shows being drafted")' \
  --project=sbs-staging-env --limit=40 --freshness=30d \
  --format='value(timestamp,textPayload)'
```

Sample hits — the **same pick processed twice** (smoking gun):

```
2024-fast-draft-1381  pick 132 NO-TE   "...already shows being drafted in the summary with {NO-TE ... 132 14}"
2024-fast-draft-16    pick 22  CHI-WR1 "...already shows being drafted ... {... 22 3}"
2026-fast-draft-0     pick 150 PHI-WR2 "...already shows being drafted ... {... 150 15}"
```

…plus dozens of `the current drafter is not the owner of the pick` /
`the current pick number is not the pick number of the pick` — all the
"second run of one pick's job" failing at step 6, **after** it already bumped
the counter. It happens in basically every draft that has any auto-picks.

---

## The fix

In `draft-actions/draft-actions.go`, inside the timer-expiry `else` branch,
**right after the `time.Sleep` block and BEFORE `userInfo.NumPicksMissedConsecutive++`**,
add a re-fetch + re-check:

```go
		// Wait until PickEndTime before processing the pick
		now := time.Now().Unix()
		if now < realTimeDraftInfo.PickEndTime {
			waitDuration := time.Duration(realTimeDraftInfo.PickEndTime-now) * time.Second
			time.Sleep(waitDuration)
		}

		// >>> ADD THIS BLOCK <<<
		// RE-CHECK AFTER THE WAIT — fixes the double-count / back-to-back
		// instant-airplane bug. Cloud Tasks is at-least-once, and because we
		// slept above (holding the request open) the same pick's job can be
		// redelivered. Both copies passed the top-of-handler guard (pick not
		// made yet), both slept, both woke. Without re-reading draft state
		// here, BOTH would run NumPicksMissedConsecutive++ below — bumping the
		// counter by 2 off a single timeout, flipping AutoDraft on, and (at a
		// snake turn) instantly auto-drafting the user's back-to-back pick.
		// Re-fetch and bail if the pick already advanced, BEFORE we touch the
		// counter. (An older version of this handler had this check; it was
		// dropped in a later refactor.)
		latest, refErr := models.GetRealTimeDraftInfoForDraft(draftId)
		if refErr != nil {
			fmt.Printf("autoDraft error (re-fetch after wait): draftId=%s ownerId=%s err=%v\n", draftId, ownerId, refErr)
			http.Error(w, refErr.Error(), http.StatusInternalServerError)
			return
		}
		if latest.CurrentPickNumber > currentPickNumber {
			// Pick already made (by the user, or by the first copy of this
			// job) — do NOT increment the miss-counter. 200 so Cloud Tasks
			// stops retrying.
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("Pick already completed"))
			return
		}
		realTimeDraftInfo = latest
		// >>> END ADDED BLOCK <<<

		userInfo.NumPicksMissedConsecutive++
		// ... rest unchanged (>=2 -> AutoDraft=true, UpdateSortForDrafter, ProcessNewPick)
```

That's the whole fix. It does **not** change the persist-before-`ProcessNewPick`
ordering, so the snake-turn instant-auto behavior the refactor wanted is
preserved for the *legit* run; only the *duplicate* run is stopped before it
can double-count.

### Optional belt-and-suspenders (only if you want it bulletproof)

The re-check closes the overwhelming majority of cases (a redelivered job
almost always wakes after the first has advanced). There's still a theoretical
hair-line window if two copies wake in the same instant and both re-fetch
before either advances. To fully eliminate it you'd tie the counter increment
to the success of `ProcessNewPick` inside a transaction — bigger change, not
needed for launch. The simple re-check matches the prior known-good behavior.

---

## Deploy + verify + sync (staging)

```bash
# 1) Make sure your local source is the CURRENT deployed code first.
#    Deployed == sbs-drafts-api `staging` branch. If your ~/sbs-drafts-api-deploy
#    is behind, refresh it from staging BEFORE editing (keep your configs/).
#    (Richard's local copy was stale — yours is probably current since you did
#     the last backend deploy, but double-check the scheduler says "2 seconds".)

# 2) Apply the fix above to draft-actions/draft-actions.go, then:
gcloud run deploy sbs-drafts-api-staging \
  --source ~/sbs-drafts-api-deploy \
  --region us-central1 --project sbs-staging-env

# 3) Confirm traffic routed to the NEW revision:
gcloud run services describe sbs-drafts-api-staging \
  --region us-central1 --project sbs-staging-env \
  --format="value(status.traffic[0].revisionName)"

# 4) Smoke test: run a draft, let ONE pick time out at a snake turn,
#    confirm the second back-to-back pick gets its FULL clock (not instant).
#    And confirm these errors STOP appearing for newly-made picks:
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="sbs-drafts-api-staging"
  AND textPayload:"already shows being drafted"' \
  --project=sbs-staging-env --limit=10 --freshness=1h \
  --format='value(timestamp,textPayload)'

# 5) Sync back so we don't drift again:
#    - rsync ~/sbs-drafts-api-deploy -> shared workspace repos/sbs-drafts-api-deploy/ (standard excludes)
#    - commit + push shared workspace main
#    - push to sbs-drafts-api `staging` branch for Caleb
```

---

## Context: the frontend half is ALREADY shipped (don't redo it)

This backend fix is **Bug 2** of two related issues:

- **Bug 1 (multi-device) — DONE, deployed by Richard 2026-06-24.**
  `hooks/useDraftEngine.ts` `processPick` no longer infers "missed pick" from a
  device-local flag (that made a desktop manual pick look like an auto-pick to
  the user's phone, flipping the phone into airplane mode). It now trusts the
  server's `numPicksMissedConsecutive` (mirrored after every pick by the
  post-pick preferences sync), which is device-independent. Vercel build was
  verified READY.

- **Bug 2 (this note) — the server double-count.** Needs the Go deploy above.

Together they fully fix the "auto-drafted when I didn't want it" reports.

— end —
