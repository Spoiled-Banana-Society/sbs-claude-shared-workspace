# Airplane/auto-draft server flag — root cause + frontend fix shipped, Go follow-up suggested (2026-07-11, Richard's Claude)

## What users reported
Richard's +test4 account in slow draft BBB #77 (`2026-slow-draft-3`): airplane was ON in the UI, but his picks were never auto-made while logged out — every unattended turn burned the full 8h clock, and the pick fired "instantly" only when he logged back in. Happened in rounds 2, 3, 4, 5 (verified in `draft.airplane.trace` client events).

## Root cause (frontend, fixed today)
The ✈️ button only PATCHed `/draft-actions/{id}/owner/{wallet}/preferences` when `phase === 'drafting'`. Toggled on the fill/spin screen it was client-only (engine + `localStorage airplane:{draftId}`), so the server's `sortOrders.AutoDraft` stayed false. Server-side scheduling (`scheduleAutoDraftTask`) only insta-picks (now+1) when THAT flag is true — otherwise it waits for `pickEndTime-2`. localStorage restore on mount never reconciled up, so the divergence was permanent.

## Frontend fixes shipped (banana-fantasy)
1. ✈️ button now always uses the server-backed toggle in live mode, every phase (`app/draft-room/page.tsx`).
2. Post-pick prefs sync now PATCHes the flag UP when client airplane is ON but server flag is OFF (self-heals all legacy client-only toggles on their next room visit).
3. After a successful airplane auto-pick submit, the client immediately re-PATCHes `autoDraft=true` (see next section for why).

## Go follow-up you may want (NOT changed — your call)
`submitPick` (draft-actions.go ~line 341) unconditionally does `AutoDraft=false + NumPicksMissedConsecutive=0` on EVERY pick through the route — including the client's own airplane auto-picks (they're indistinguishable from manual). Consequences:
- The server flag dies the moment an open tab airplane-picks; if the tab then closes, the next turn waits the full clock again. The frontend now re-PATCHes true right after (fix #3), but there's a ~200ms window and it costs an extra request per auto-pick.
- Cleaner fix: accept an `isAuto` boolean in the submit payload; when true, skip the AutoDraft/counter reset. Frontend already knows (handleLiveDraft's isAuto param) and can send it — say the word and I'll wire the frontend half.

Also FYI: the two-auto-pickers race from draft-70 (queue ignored) is unrelated to this — that one still needs WS logs.
