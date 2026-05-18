# Draft Revert Log — 2026-05-18

Reverting yesterday's (2026-05-17) draft-related changes after timer freeze
bugs in production. Boris wants to revert to the state right before
`fee9e84`, then selectively restore pieces once drafts are stable.

Target baseline: `fee9e84^` (i.e., the commit immediately before "My Drafts:
poll live list + newest-first sort").

Backup branches: `backup-pre-revert-2026-05-18` on both repos preserve the
pre-revert HEAD if anything needs to be cherry-picked back.

## FRONTEND — banana-fantasy

### Reverted (11 commits, in chronological order)

| Commit  | Time (MT)         | Title                                                                      | Files                                                                                                |
| ------- | ----------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| fee9e84 | 05-17 12:13       | My Drafts: poll live list + newest-first sort                              | hooks/useDraftingPageState.ts                                                                        |
| bc536fc | 05-17 12:36       | League # resolution: retry on race + tighter 2s list poll                  | hooks/useDraftingPageState.ts, hooks/useLeagueNumberForSlot.ts                                       |
| de435cf | 05-17 16:31       | My Drafts: garbage-collect drafts no longer in API response                | hooks/useDraftingPageState.ts                                                                        |
| 764a6f2 | 05-17 16:35       | My Drafts: SSE push (sub-200ms), demote poll to 15s safety net             | **app/api/drafts/my-drafts/stream/route.ts (NEW — deleted)**, hooks/useDraftingPageState.ts          |
| 13a7cad | 05-17 16:45       | Draft room: replace 'Draft starting in 0:00' with 'Other players finishing the draft…' | components/drafting/DraftRoomDrafting.tsx                                                  |
| ae9a253 | 05-17 16:52       | Draft room: airplane mode honors server's missed-picks count on entry      | app/draft-room/page.tsx                                                                              |
| 9a2f3da | 05-17 17:04       | Draft room: airplane mode consistent on re-entry + logging                 | app/draft-room/page.tsx                                                                              |
| eb33115 | 05-17 17:11       | Drafting: structured logs at key lifecycle events                          | app/draft-room/page.tsx, hooks/useDraftLiveSync.ts                                                   |
| f33ee17 | 05-17 20:35       | Redesign draft sidebar toggle + roster row alignment                       | components/drafting/DraftRoomDrafting.tsx, .last-richard-sync                                        |
| a9a47be | 05-17 20:50       | Move draft sidebar toggle into tab row as labeled button                   | components/drafting/DraftRoomDrafting.tsx, components/drafting/DraftTabs.tsx                         |
| 47e41e7 | 05-17 21:49       | Live-update draft room player count via Firebase RTDB                      | app/draft-room/page.tsx, scripts/inspect-rtdb-numplayers.mjs                                         |

### Kept (still on main after revert)

| Commit  | Title                                                            | Why kept                            |
| ------- | ---------------------------------------------------------------- | ----------------------------------- |
| 65410f4 | Stop showing wrong league numbers derived from slot ids          | Per Boris — league # work, safe     |
| 2bf6a6e | DraftRow label: use live-resolved league # (not stale contestName) | Per Boris — league # work, safe   |
| 73d608e | Admin: detect frozen mid-draft via RTDB PickEndTime              | Admin observability only, not draft logic — useful for diagnosing the freeze |
| 225fb03 | Stop duplicate badge notifications                               | Badges, not drafts                  |
| 41599aa | Retry deploy after Sentry token scope expansion                  | No code change                      |
| 712b35d | Pick up rotated SENTRY_AUTH_TOKEN (with event:admin scope)       | No code change                      |

## BACKEND #1 — Go API (sbs-drafts-api-deploy → sbs-drafts-api-staging)

### Reverted (1 commit)

| Commit  | Time (MT)    | Title                                                      | Notes                                                                                                                                                |
| ------- | ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ee9da45 | 05-17 22:11  | Speed up draft join handler — instant Randomizing + parallel setup | Reordered RTDB writes during 10th-player-joins path: numPlayers pushed BEFORE `CreateLeagueDraftStateUponFilling`; user-token setup parallelized. **Strong suspect for the freeze.** |

After revert, redeployed as revision `sbs-drafts-api-staging-00116-fj9` via:
`gcloud run deploy sbs-drafts-api-staging --source . --region us-central1 --project sbs-staging-env --quiet`

### Additional uncommitted revert — `models/draft-state.go` (the actual freeze cause)

Deeper audit found that yesterday had **5 Go API deploys** (00112, 00113, 00114, 00115, 00116), not 1. The git history only captured `ee9da45` (deployed in 00115); the others contained uncommitted working-tree changes.

Comparing the live working tree against rev 00112 source (pulled from
`gs://run-sources-sbs-staging-env-us-central1/.../1778999048...zip`),
only two files actually differ in content:

| File | Status | Reason |
| --- | --- | --- |
| `models/draft-state.go` | **Reverted to rev 00112** | Yesterday's edit re-introduced `PfpInfo` storage on every pick slot. The rev 00112 comments explicitly warn this caused the 1 MB Firestore doc-size overflow → fill aborted → 10th-joiner rollback. **This is the freeze.** Backup: `models/draft-state.go.pre-revert-2026-05-18.bak`. |
| `models/draft-token.go` | **Kept** | Adds `LeagueDisplayName` backfill from the draft doc — pairs with the kept frontend commits `65410f4` + `2bf6a6e` (league # work). Reverting would break the frontend league # fix. |

Other files with yesterday mtimes (`main.go`, `staging/staging.go`, `batchproof/*`, `draft-actions/*`, `draft-state/drafts.go`, `models/draft-actions.go`, `models/owner.go`) have identical content to rev 00112 — touched but no net change. No action needed.

Final state redeployed as `sbs-drafts-api-staging-00118-...` (revert of `draft-state.go` + everything else matches rev 00112 effective behavior).

## BACKEND #2 — WebSocket server (SBS-Football-Drafts-main → sbs-drafts-server-staging)

**Not git-tracked.** Two new revisions deployed yesterday after fee9e84:
- `sbs-drafts-server-staging-00035-nmv` (2026-05-17 23:09 MT)
- `sbs-drafts-server-staging-00036-9j6` (2026-05-17 23:53 MT)

**Action:** Cloud Run traffic rolled back to **revision `sbs-drafts-server-staging-00034-96w`** (2026-05-13 22:57 MT — last known-good).

Command used:
`gcloud run services update-traffic sbs-drafts-server-staging --to-revisions=sbs-drafts-server-staging-00034-96w=100 --region us-central1 --project sbs-staging-env`

### Files reverted on disk in `~/SBS-Football-Drafts-main/`

Source for revision 00034 was retrieved from
`gs://run-sources-sbs-staging-env-us-central1/services/sbs-drafts-server-staging/1778648136.345499-43c71d3182604df48e90c22afcc0655b.zip`
(uploaded 2026-05-12 22:55 MT, deployed 2 min later as revision 00034).

All 7 yesterday-modified files restored to that exact rev34 state. Originals
saved alongside as `<file>.pre-revert-2026-05-18.bak`. `go build ./...` runs
clean after the revert.

| File                          | Lines reverted | Notable                                                          | Backup                                                    |
| ----------------------------- | -------------: | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `main.go`                     | 10             |                                                                  | `main.go.pre-revert-2026-05-18.bak`                       |
| `websockets/event.go`         | 2              |                                                                  | `websockets/event.go.pre-revert-2026-05-18.bak`           |
| `websockets/timer.go`         | 2              | **Timer logic — strong freeze suspect**                          | `websockets/timer.go.pre-revert-2026-05-18.bak`           |
| `websockets/draft-manager.go` | 6              | Draft lifecycle                                                  | `websockets/draft-manager.go.pre-revert-2026-05-18.bak`   |
| `websockets/draft.go`         | 18             | `GoToNextPickInDraftInfo` got `lastPick *models.PlayerInfo` param | `websockets/draft.go.pre-revert-2026-05-18.bak`           |
| `utils/db.go`                 | 40             |                                                                  | `utils/db.go.pre-revert-2026-05-18.bak`                   |
| `models/draft-info.go`        | 62             |                                                                  | `models/draft-info.go.pre-revert-2026-05-18.bak`          |

**Verified clean revert:** each rev34 file mtime predates 2026-05-13 (the
00034 deploy date), so the diffs reverted are purely yesterday's edits — no
collateral loss of intermediate changes between 5/13 and 5/17 12:13.

A future `gcloud run deploy sbs-drafts-server-staging --source .` is now safe;
it will reproduce the equivalent of revision 00034.

To re-implement later:
1. Inspect the `.bak` files in `~/SBS-Football-Drafts-main/` — each is the
   exact pre-revert version.
2. `diff <file> <file>.pre-revert-2026-05-18.bak` shows what was reverted.
3. Re-apply selectively, then `gcloud run deploy sbs-drafts-server-staging --source . --region us-central1 --project sbs-staging-env`.

## BACKEND #3 — Firebase Functions (sbs-staging-functions)

**No files modified after 2026-05-17 12:13.** No revert needed.

## How to bring something back later

1. `cd ~/banana-fantasy` (or `~/sbs-drafts-api-deploy`)
2. `git cherry-pick <commit-from-backup-branch>` — commits still exist on
   `backup-pre-revert-2026-05-18` branch and in reflog.
3. For the SSE push (`764a6f2`), the new file `app/api/drafts/my-drafts/stream/route.ts`
   is gone after revert; cherry-pick will re-create it.
