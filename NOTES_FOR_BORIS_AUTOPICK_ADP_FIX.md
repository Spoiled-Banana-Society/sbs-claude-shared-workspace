# Autopick ADP fix + board-gap invariant (7/27, Richard's session)

## 🔴 REVERT PLAYBOOK — if something looks broken overnight (Boris: tell your Claude "revert Richard's 7/27 changes per the notes" and it can run these verbatim)

**Diagnose FIRST (2 min) — symptoms that implicate these changes:**
- Draft-room board glitches / users stuck picking / fetch storms → suspect the FRONTEND change. Console/debug marker: `[GapResync]` lines in v2_debug_events (`node scripts/logs.mjs trace --minutes=60` in banana-fantasy), or WATCHDOG_RESYNC_FAILED spikes with `trigger: 'pickGap'`.
- Autopick complaints in drafts created AFTER Sun ~7:00 PM PT, sort toggle errors, or draft-creation failures → suspect the GO change. Log check: `gcloud logging read 'resource.labels.service_name="sbs-drafts-api-staging" AND (textPayload:"SnapshotADPForLeague" OR textPayload:"UpdateSortForDraft")' --limit 20`
- Anything else (payments, wheel, lobby, marketplace) → NOT these changes; don't revert.

**Revert FRONTEND (instant, no build):**
```
vercel rollback https://banana-fantasy-g7f7d2ccx-sbs.vercel.app
```
(g7f7d2ccx = last pre-change Production build. Richard's change is the single commit
`d93bbb8d` touching only hooks/useDraftLiveSync.ts — a git revert + deploy-hook fire
also works but the vercel rollback is faster and reversible.)

**Revert GO API (instant, traffic shift — do NOT redeploy from source):**
```
gcloud run services update-traffic sbs-drafts-api-staging --region us-central1 --project sbs-staging-env --to-revisions sbs-drafts-api-staging-00188-r2k=100
```
00188 = your dup-pick-guard + JackHOF revision from Sunday afternoon. ⚠️ Traffic-shift
ONLY — a fresh `gcloud run deploy` from YOUR source copy would also wipe rev 00188's
own fixes AND Richard's, and re-create the drift mess. ⚠️ Rolling back also removes the
live_activity.go zero-publish guard that rode along in 00189.

**Known-safe leftovers after a Go rollback (don't chase these):**
- Drafts created while 00189 was serving have a populated `ADP` array on their doc.
  Old code reads it fine → those drafts do ADP-based timeout autopicks even on 00188.
  That's the intended good behavior; not a bug signal.
- Frontend sort PUTs will 404 again on 00188 — they're caught client-side, harmless
  (that was the pre-existing state).

**Already fully cleaned up — nothing to do:** the test draft 2026-fast-draft-303
("BBB #317") Richard's session mistakenly created is deleted (Firestore + RTDB + bots +
test wallet), FilledLeaguesCount reverted 317→316, JP/HOF slot arrays untouched
(317 was never a special slot). Draft 302 (real users, BBB #316) was never touched.
If the Discord fill-alert bot posted a "BBB #317" fill message, delete it manually.

**Re-applying after a revert:** all changed source is in Richard's `~/banana-fantasy`
(commit d93bbb8d, pushed) and `~/sbs-drafts-api-deploy` (working tree, on his Mac).
Coordinate with Richard before re-deploying — he wants green-light-gated deploys now.

---


Triggered by AceJohn's Discord report tonight (draft 2026-fast-draft-300): his phone's board was 3 picks stale (showed DAL-WR1 available 22s after Wp34 took it), his tap 400'd, and the timeout autopick took MIN-WR1 from his rankings instead of SF-RB1 (top ADP) even though his list was sorted to ADP.

## Go API changes (deployed to sbs-drafts-api-staging from ~/sbs-drafts-api-deploy)

1. **`owner/owner.go` — the missing sort routes.** The frontend has always PUT
   `/owner/{w}/drafts/{id}/state/sort/{sortBy}` on every ADP/RANK toggle flip — the route
   never existed server-side (404 into the void), so the server auto-picker could never
   hear the user's choice. Added GET + PUT. Fetch-modify-write; only SortBy changes,
   AutoDraft + missed counters preserved.

2. **`models/leagues.go` — `SnapshotADPForLeague()`.** The `ADP` array on every
   `drafts/{id}` doc was empty (nothing ever wrote it), so `GetDraftADP` always returned
   an empty list and the ADP branch of `CalculateAutoPickForUser` has never fired once —
   every timeout autopick fell back to user rankings. New drafts now get the live-ADP
   order (from `playerStats2026/rankings`, which your hourly cron keeps current) stamped
   at creation. **Old/in-flight drafts intentionally untouched** — their ADP stays empty
   → exact old behavior until they finish. Also wired into the special-draft creation in
   `staging/staging.go`.

3. **`models/draft-actions.go` — early-return defusal.** Both ranking loops in
   `CalculateDefaultPickForUser` did `return` (abort the WHOLE calc) if any ranked
   playerId was missing from the draft's player map. Now `continue` + log. Dormant
   landmine for the 2026 pool rollover.

4. **Ride-along:** your working copy had an uncommitted guard in `models/live_activity.go`
   (skip publishing count=0 when RTDB reads errored) — it shipped with this deploy.

⚠️ **Pull before your next Go deploy or you'll revert all of the above** (same drill as
00183/00184). The canary for a revert: sort PUTs going back to 404 in the API logs.

## Frontend change (banana-fantasy, deployed via hook)

`hooks/useDraftLiveSync.ts` — board-gap invariant. RTDB only delivers the LATEST
lastPick after a connection gap, so a backgrounded phone rejoins with intermediate picks
missing from its board (AceJohn's ghost player). Now: any detected pick that jumps more
than one past the applied high-water mark triggers ONE single-flight background summary
rebuild. No UI blocking, no toast (Richard's call), Rule #0 safe (scalar deps, no Privy
callbacks, single-flight guard).

## Behavior after this

- Post-deploy drafts: filter=ADP → timeout autopick takes top live ADP; filter=RANK →
  top of user's rankings. Both directions verified on staging (see main session log).
- Pre-deploy drafts: unchanged (rank fallback), by design.
- AceJohn's RANK≠ADP confusion was NOT a bug: he saved rankings 7/9 01:33 UTC (log-proven
  POST), the rerank cron correctly froze him as customized. "Reset to ADP order" unfreezes.
