# Dev Handoff — banana-fantasy (staging)

Snapshot of what's shipped in the last ~2 days, what's still open, and
where things live. Read this first before opening the codebase.

**Live staging:** https://banana-fantasy-sbs.vercel.app
**Repos:**
- Frontend (this branch / what you'll touch): `repos/banana-fantasy/`
- Vercel deploy mirror: `Spoiled-Banana-Society/sbs-frontend-v2` (auto-mirrored by `scripts/deploy.sh` — don't push direct)
- Go API (read-only ref locally): `~/Downloads/sbs-drafts-api-main`
- WebSocket server: not in this workspace (Boris owns)

**Branch model:** Richard works on `richard`, Boris on `boris`, deployable code merges into `main`. Use `scripts/deploy.sh "<msg>"` to push to Vercel — it has a sync-verification gate so you can't overwrite the other branch's work.

---

## Build / lint state

```
npx tsc --noEmit       → clean
npx next build         → clean
npx next lint          → 0 errors, 29 pre-existing warnings
                         (all <img>/missing-deps in untouched files)
```

Vercel "Ready" deploy hash is current as of this commit.

---

## What was shipped (last 2 days)

### Auto-draft position limits
- **Frontend:** caps how many of each position the auto-picker can pick on your behalf. Defaults `QB:3 RB:7 WR:7 TE:3 DST:3`. Manual picks bypass.
- **UI:** `/rankings` page → "Auto-draft position limits" collapsible at the top. ± steppers, autosave, "Reset to defaults".
- **Files:**
  - `lib/positionLimits.ts` (constants, types, `applyDefaults`)
  - `hooks/usePositionLimits.ts`
  - `components/rankings/PositionLimitsPanel.tsx`
  - `app/api/user-positional-limits/route.ts` (GET/POST, top-level Firestore `userPositionalLimits` collection)
  - `hooks/useDraftEngine.ts` `autoPickForPlayer` accepts `positionLimits` param + relax-when-stuck fallback
- **Status:** Boris already shipped the Go-side mirror (`models/position-limits.go`) so live AFK + bots respect caps too.

### Rankings page (`/rankings`)
- **Now persists.** Was UI-only — reorders are POSTed to `/owner/{wallet}/drafts/state/rankings` (the dev's existing Go endpoint). On mount, loads via `Rankings.getRankings(wallet)`.
- **Loads from Go API directly** (was hitting `/league/rankings/global` which doesn't exist server-side and always 404'd).
- **Visual match:** stacked black cards with position-color L+R borders, drag indicator on hover, BYE/ADP/RANK/MOVE columns flush right — copied from the dev's old `RankingItemComponent.tsx` design.
- **Position filter:** ALL / QB / RB / WR / TE / DST buttons. Filter is purely visual; reorders within a filter still persist to the full list at the right index.
- **Reset to defaults** button → DELETEs the saved doc; Go API auto-seeds from current ADP on next read.
- **Files:** `app/rankings/page.tsx`, `utils/api.ts` (`Rankings.getRankings/updateRankings/removeRankings`).
- **Nav:** added `/rankings` link to `components/layout/Header.tsx` desktop nav.

### Spectator (admin can watch any draft)
- **Public URL per draft:** `/spectate/[draftId]` — redirects to `/draft-room?id=…&mode=live&wallet=0x000…000&spectate=true`. Renders the LIVE draft room with a `SPECTATOR` badge; pick / queue / leave actions are no-oped via the `spectateParam` flag in `app/draft-room/page.tsx`.
- **Sidebar follows clicks:** in spectator mode, the right "MY TEAM" panel switches to whatever drafter you last clicked (defaults to current drafter).
- **Status line:** "On the clock: {drafterName} · Pick N/150" instead of "Draft starting in 0:00".
- **Admin browser:** `/admin` → **Spectate** tab (sidebar, Records group). Auto-refresh 5s, filter by speed/level. Click "Spectate ↗" to open the URL.
- **Completed drafts:** `/admin` → **Drafts** tab (Manage group). Replaces the old broken DraftsPanel that filtered on Firestore status fields that don't exist.
- **Files:** `app/spectate/[draftId]/page.tsx`, `app/api/spectate/{draft-state,active-drafts}/route.ts`, `components/admin/{SpectateBrowser,CompletedDraftsList}.tsx`.

### Jackpot Hit promo modal
- **Click-to-reveal flow.** Modal stays as rules + progress + REVEAL button by default. Click REVEAL → modal body swaps to a winner-picker animation that cycles through the 10 drafter names (`sha256(draftId) mod 10` — same algo as the server-side credit gate). Settles on the winner; button changes to CONFIRM.
- **Real drafter names** fetched via new `/api/promos/jackpot-reveal?draftId=…` (looks up `users/{ownerId}.username` via Firestore admin).
- **Preview route:** `/preview/jackpot-winner` mocks the flow with fake names so we can iterate visually without filling a real JP draft.
- **Files:** `components/modals/PromoModal.tsx` (`renderJackpotContent` + `startJackpotReveal`), `components/promos/JackpotWinnerCycle.tsx`, `app/api/promos/jackpot-reveal/route.ts`.

### Other promo work
- `lib/db-firestore.ts` `recordJackpotHit` now credits **only 1 of 10** drafters (deterministic via `sha256(draftId) mod 10`), reads `draftOrder` from Go API to gate which user gets credit.
- Position-based bonus tiers: slot 1-25 → 10 spins, 26-50 → 5 spins, 51-100 → 1 spin.
- Hidden from carousel (data + claim routes still exist): `spin-share`, `add-to-home-screen`. Edit `HIDDEN_PROMO_TYPES` in `components/home/PromoCarousel.tsx` to flip back on.

### Pass refund on leave
- Leaving a filling draft now refunds the Firestore `draftPasses` / `freeDrafts` counter via new `/api/owner/refund-pass`. Go API's `RemoveUserFromDraft` was already returning the card to the user's pool but the user-facing counter was stuck. `refreshBalance()` ticks the header back up immediately.
- New activity event type: `draft_left`.
- Files: `app/api/owner/refund-pass/route.ts`, leave handlers in `app/draft-room/page.tsx` + `hooks/useDraftingPageState.ts`, type union in `lib/activityEvents.ts`.

### Faster auto-pick
- Was 2-3s click-to-pick; now ~500ms. Three changes in `app/draft-room/page.tsx` + `hooks/useDraftLiveSync.ts`:
  1. `handleToggleAutoDraft` flips airplane mode locally first, then PATCHes prefs in parallel (was awaiting the PATCH).
  2. Dropped 500ms `setTimeout` before the auto-pick `submitPickREST`.
  3. Dropped 300ms retry `setTimeout` in the duplicate-pick recovery path.
- Bots still pick at 4-5s — that's WS-server-side, intentional for now per Richard.

### Draft-room URL hygiene
- `setDraftId(...)` now updates the URL via BOTH `window.history.replaceState` (synchronous URL bar update) AND `router.replace(...)` (Next history sync). Was flaky with one alone — `replaceState` updated the bar but Next still thought the URL was id-less; `router.replace` was lazy in some browsers.
- Result: enter a draft → URL has `?id=2024-fast-draft-NNN&…` within 1-2s of join.

### Standings team nicknames
- Hover any team card on `/standings` → pencil icon → click → inline rename. Empty name clears back to "League #NNNN".
- Per-user, per-league. Single Firestore doc per wallet at `userTeamNicknames/{wallet}` with a `nicknames: { [leagueId]: name }` map.
- Files: `app/api/owner/team-nicknames/route.ts`, `hooks/useTeamNicknames.ts`, `components/standings/TeamCard.tsx`.

### JP/HOF tint persists into drafting
- Red (jackpot) / yellow (hof) radial-gradient background was disappearing the moment the slot reveal resolved into 'drafting' phase (lived in `DraftRoomReveal` only). Now mirrored into `DraftRoomDrafting` at slightly softer alpha so it persists for the full draft.

---

## Open / waiting on someone

### Waiting on Boris (WebSocket server)
- Bot pick speed (4-5s → ~1s) — Richard says this is fine for now, can punt. No note left for Boris.

### Waiting on dev
- **Auth on new endpoints:** `/api/owner/team-nicknames` and `/api/owner/refund-pass` are unauthenticated (match the existing pattern of `/api/owner/use-pass`). Tighten with Privy auth before prod volume.
- **Marketplace listing rule (server-side enforcement):** flagged in CLAUDE.md — currently client-only (`team.passType === 'free'` + `isDraftingOpen()` blocks listing). Needs server gate before real volume.
- **`/api/admin/revoke-7702`:** one-off endpoint from the EIP-7702 incident. Should come out — see NOTES-FOR-RICHARD.md April 26 for context.
- **Marketplace `pass_origin` overlay** is the live source of truth (NOT the Go API's `passType` field which doesn't return the right value). See NOTES-FOR-BORIS.md April 22 for details.

### Known caveats
- **`spectate active-drafts` probes 30 IDs/speed:** acceptable for an admin tool but inefficient. Could be replaced with a Firestore composite query keyed on `pickNumber`/completion flag if Boris adds those fields.
- **Position filter on rankings reorders the underlying full list:** dragging within a filter changes the absolute rank. That's intentional (matches what saves to Go) but can be surprising.
- **Standings team nicknames are per-user:** Boris's standings won't show your custom names. By design.

---

## Conventions

- **Never `git add -A` or `git add .`** — always specific files. Stale-file regressions have happened multiple times in this codebase.
- **Always `cd ~/sbs-claude-shared-workspace && git fetch origin && git merge origin/main` before committing** to pull the other branch's deployed work.
- **Deploy via `scripts/deploy.sh "<msg>"`** — never push direct to `sbs-frontend-v2`. The script runs Mode A + B sync checks and triggers the Vercel deploy hook in one go.
- **Hardcoded staging URLs in server-side code:** the `banana-fantasy-sbs` Vercel project only ever talks to staging Go API. Server routes that hit the Go side should hardcode `https://sbs-drafts-api-staging-652484219017.us-central1.run.app` (see `app/api/spectate/draft-state/route.ts`) — `lib/staging.ts.getDraftsApiUrl()` is client-only (gates on `typeof window`).

---

## Where to look first

| Looking for… | Start here |
|---|---|
| Live draft state from API | `lib/draftApi.ts` (client) / `lib/staging.ts` (URL helper) |
| Auto-pick logic | `hooks/useDraftEngine.ts` `autoPickForPlayer` |
| Draft room UI | `app/draft-room/page.tsx` (1900+ lines, well-organized by section comments) |
| Reveal + slot machine | `components/drafting/DraftRoomReveal.tsx` + `SlotMachineOverlay.tsx` |
| Drafting view (banner + tabs) | `components/drafting/DraftRoomDrafting.tsx` |
| Promo modal | `components/modals/PromoModal.tsx` |
| Wheel | `app/api/wheel/spin/route.ts` (server) + `hooks/useWheelData.ts` (client). Force a result with `?forceWheel=jackpot` URL param. |
| Admin shell | `app/admin/page.tsx` — single-page tabbed layout |

