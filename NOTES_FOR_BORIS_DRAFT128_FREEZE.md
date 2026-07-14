# 2026-07-13 — Frozen draft 2026-fast-draft-128 (BBB #133): root cause + data cleanup + fixes needed

**TL;DR:** A brand-new house bot (`+ New` button) filled the 10th seat ~1s before its `owners/{wallet}` doc was written. `CreateEmptyRosterState` silently **skips** any member whose owners doc read fails (`continue`), so the draft started with a 9-entry roster map. The bot's first pick (pick 8) nil-derefed in `UpdateRosterFromPick`, **panicked and killed the Go API process mid-pick** — summary written, draft never advanced. Cloud Tasks then retried the auto-pick forever, crashing an API instance on every retry. NOT a dup-seat; the 7/12 join-path rework held.

## Exact timeline (UTC, from Cloud Run logs + Firestore createTime)
- 23:32:58.356 — bot `0x4a875da7…` (minted seconds earlier via `+ New`) seats as 10th member (join tx log shows 9 existing)
- 23:32:58.584 — `[fill-timing]` fill commit → `CreateLeagueDraftStateUponFilling` runs, builds roster map, owners read for the new bot = **NotFound → skipped**
- 23:32:59.677 — `owners/0x4a875da7` doc created (~1.1s too late; the two older bots' docs were days old — that's why draft-122 was fine)
- 23:34:56 → 23:35:07 — bot's pick 8 (SF-RB1, via onBotTurn) → `panic: nil pointer` in `models.UpdateRosterFromPick` (draft-state.go:966), `ProcessNewPick.func2` goroutine → **process death**, 503. Pick 8 in summary, `state/info`/RTDB stuck on pick 8.
- 23:35:24 onward — Cloud Tasks auto-draft retries each panic at draft-state.go:970 → repeated instance crashes (risk to unrelated live drafts on the same instance).

## Data cleanup I did (NO code changes)
- **All 10 passes restored** by replicating `RemoveTokenFromLeague()` per token: `draftTokens/{id}` unstamped, `validDraftTokens` restored, `usedDraftTokens` + `drafts/…/cards/{id}` deleted, metadata LEAGUE-NAME blanked. Paid stayed paid (1877, 2230), free stayed free. Verified via `/owner/{w}/draftToken/all`. Script: `repos/banana-fantasy/scripts/_restore-128-passes.mjs`.
- **Draft neutralized:** RTDB `realTimeDraftInfo` → `isDraftComplete:true, isDraftClosed:true, pickNumber:151`; Firestore `state/info.CurrentPickNumber:151`. The autoDraft handler's "pick already completed → 200" guard drains the Cloud Tasks retries; onBotTurn bails on the complete flag.
- **Draft hidden, counter intact:** drafts doc + state kept (JP/HOF audit). `draftTracker` untouched — FilledLeaguesCount stays 133, batch 33/100, 1 JP + 4 HOF remaining. No member's token list references the draft anymore.

## Fixes needed (please review — none applied yet)
1. **`CreateEmptyRosterState` (models/draft-state.go ~299):** never `continue` on owners read failure — the doc only supplies the PFP. Create the roster entry with an empty PFP instead. A missing avatar must never cost a seat. (This also covers ANY transient Firestore error at fill time — real users are exposed to that too, not just bots.)
2. **`UpdateRosterFromPick` (draft-state.go ~949):** nil-check `data.Rosters[address]` and create an empty entry instead of dereferencing. Belt for #1's suspenders.
3. **`ProcessNewPick.func2` goroutine (models/draft-actions.go:150):** add `defer recover()` — an uncaught panic in a goroutine kills the whole process; one bad pick should never take down every live draft on the instance.
4. **Bot `+ New` flow:** create/ensure the `owners` doc BEFORE the Go join call (frontend fill route, 'new' mode) so a fresh bot can never race draft-state creation again. Until this ships, Richard is using `+ Bot` (existing pool bots) only.
