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

## BACKEND — sbs-drafts-api-deploy

### Reverted (1 commit)

| Commit  | Time (MT)    | Title                                                      | Notes                                                                                                                                                |
| ------- | ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ee9da45 | 05-17 22:11  | Speed up draft join handler — instant Randomizing + parallel setup | Reordered RTDB writes during 10th-player-joins path: numPlayers pushed BEFORE `CreateLeagueDraftStateUponFilling`; user-token setup parallelized. **Strong suspect for the freeze.** |

After revert, redeployed via:
`gcloud run deploy sbs-drafts-api-staging --source . --region us-central1 --project sbs-staging-env --quiet`

## How to bring something back later

1. `cd ~/banana-fantasy` (or `~/sbs-drafts-api-deploy`)
2. `git cherry-pick <commit-from-backup-branch>` — commits still exist on
   `backup-pre-revert-2026-05-18` branch and in reflog.
3. For the SSE push (`764a6f2`), the new file `app/api/drafts/my-drafts/stream/route.ts`
   is gone after revert; cherry-pick will re-create it.
