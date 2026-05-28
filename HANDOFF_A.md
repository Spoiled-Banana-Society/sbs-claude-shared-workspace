# HANDOFF — Claude C (Social / Friends + Messaging feature)

> ⚠️ **READ THIS FIRST — coordinator assumptions are violated.**
> This session did its work in `~/sbs-claude-shared-workspace/repos/banana-fantasy`
> (branch `richard`), **NOT** in the `~/sbs-worktrees/c` worktree, and it
> **ALREADY DEPLOYED TO LIVE** before the Claude C / batch-deploy instructions
> were given. Do **not** re-deploy these 6 files expecting them to be unshipped —
> they are already on `sbs-frontend-v2` and the Vercel hook already fired.
> Nothing was built in `~/sbs-worktrees/c`; the `richard-c` branch only carries
> this handoff note.

---

## WHAT I DID

Built and shipped in-draft-room **friends + direct messaging** with notifications.
The friends/DM *engines* (`lib/friends.ts`, `lib/dms.ts`, hooks, API routes) and the
`UserPopover` component already existed — this work wired them into the draft room
and added notifications + mute controls.

- **Inline DM compose box** in `UserPopover`: the "Message" button used to navigate
  away to `/messages`; now it expands a little textarea + Send right in the popover
  (Enter sends, Shift+Enter newline, request-state hint, "Message sent ✓").
- **Reachable from the draft board/roster**: added a "👤 Add friend / message" chip
  in `RosterComponent` that opens `UserPopover` for the player whose roster you're
  viewing (only for other real humans, not self/bots).
- **Notifications**: two new types `friend_request` + `message_received`, and a new
  `SocialNotifier` component (mounted app-wide in `providers.tsx`) that rides the
  EXISTING 15s friends/DM polls and fires an in-app notification for new friend
  requests and any new message. **No new fetch loop** — render-loop-guard test passed.
- **Mute controls**: two separate toggles ("Friend Requests" / "Messages") appear on
  `/notifications` automatically (added `friends`/`messages` categories;
  `pushNotification()` already respects category prefs).

## FILES TOUCHED (6) — in repos/banana-fantasy
- `app/notifications/page.tsx`            (+2  — TYPE_CONFIG entries for new types)
- `app/providers.tsx`                     (+4  — mount `<SocialNotifier/>`)
- `components/NotificationCenter.tsx`     (+12 — new types/categories/labels/prefs)
- `components/draft/RosterComponent.tsx`  (+27 — popover chip + useDraftRoomUsers)
- `components/social/UserPopover.tsx`     (+110 — inline compose box)
- `components/social/SocialNotifier.tsx`  (NEW, 128 lines — background watcher)

## WHERE THE WORK LIVES (important — multiple locations)
1. **Shared workspace branch `richard`**: commit `74312f5` (already pushed to
   `origin/richard`). Done by a parallel session, content matches exactly.
2. **LIVE (`sbs-frontend-v2` main)**: I `git apply`-ed only this 6-file diff onto
   live HEAD `9fe3f258` → new live HEAD **`32cd2600`**, pushed, and triggered the
   Vercel deploy hook (job `12hMjPHdX2JZD0qmsbms`, was PENDING). Deployed surgically
   (not via deploy.sh) specifically so it would NOT revert Boris's live lobby work.
3. **This worktree (`~/sbs-worktrees/c`)**: nothing built here. `richard-c` only has
   this handoff note.

## WHAT TO CHECK (verification)
- Live build: confirm Vercel job `12hMjPHdX2JZD0qmsbms` finished green (one GET to
  `banana-fantasy-sbs.vercel.app` max — do NOT burst-curl, WAF rule).
- In a draft room: click a player → popover shows "Add Friend" + "Message"; Message
  opens an inline box; sending posts a DM; recipient gets an in-app 🔔 notification.
- `/notifications` → gear → "Friend Requests" and "Messages" toggles exist and mute.
- Quality gates already run: `tsc` 0 errors; `next lint` clean (pre-existing warnings
  only); `render-loop-guard` 4/4 pass. The 6 `draft-room.spec.ts` failures are
  **pre-existing** (fail identically on a clean baseline — they hit the real staging
  backend), NOT from this diff.

## RISKS / OVERLAP (coordinator must reconcile)
- **Already deployed** — do not double-deploy or assume unshipped (see top warning).
- **Workspace ↔ live drift is NOT resolved.** `sbs-frontend-v2` has Boris's lobby work
  (`DraftRoomDrafting/Filling`, `app/draft-room/page.tsx`, `lib/draftRoomLobby.ts`,
  `lib/api/firebase.ts`, `useDraftLiveSync.ts`) + the name-fix (`9fe3f258`) that are
  NOT in the shared workspace. A future `deploy.sh` (workspace→live mirror) would
  REVERT all of that — its Mode-B guard should abort it; trust that. Reconcile the
  workspace with live before any workspace-based deploy. (Memory:
  `project_workspace_behind_live_namefix`.)
- **Overlapping files** other letters might also touch: `NotificationCenter.tsx`,
  `app/providers.tsx`, `UserPopover.tsx`, `RosterComponent.tsx`, `notifications/page.tsx`.
  If another letter edits notifications, the draft room, chat, or the popover, merge
  carefully.
- **Config/memory changes I made (outside any repo):** removed the deploy-approval
  RULE #000 from memory and neutralized the `ask()` gate in `~/.claude/hooks/sbs-safety.sh`
  (prod guards left intact + syntax-checked) — per Richard's explicit request that he
  no longer approve deploys. Mode-B marker `~/.sbs-last-deploy-frontend-v2-head` set to
  `32cd2600`.
- **Backup stash** `stash@{0}` in the shared workspace holds a pre-existing
  `DraftRoomDrafting.tsx` change not in any commit — **do not drop it** until verified.
- **Not done:** phone *push* for new messages (needs backend Firebase Functions work);
  only in-app notifications are wired.
