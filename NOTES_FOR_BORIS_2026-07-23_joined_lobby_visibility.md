# Fix: joined filling lobbies now show on every device (2026-07-23)

**Symptom (live, 7/23 ~7pm):** users (vertig0, AceJohn, UsedCarSales) reporting
"I joined a draft but it doesn't show up on my app / can't see the one I'm in
(3/10)". Admin Spectate confirmed the seats were REAL — vertig0 was in #232 +
#233, AceJohn in #232. Nothing lost; purely a client display gap.

**Root cause:** the `My Drafts` list (`banana-active-drafts`) is localStorage-only.
It's written at join time on THAT device and never re-read from the server, so a
seat taken on another device/session — or a join whose local write raced — is
invisible even though it exists in `owners/{wallet}/usedDraftTokens`. The only
server call in that path (`pruneMissingDrafts`) can remove rows but never add
missing ones.

**Fix (frontend only, no Go change):**
- New `GET /api/owner/active-drafts?wallet=` — reads `owners/{wallet}/usedDraftTokens`
  (carries `LeagueId` — stamped by the join, cleared on leave), batch-reads those
  league docs, returns the wallet's **still-FILLING** lobbies only.
  - Filling-only is deliberate: a filled league doc can't be told apart from a
    completed one without a per-draft Go state call, and drafting rows are already
    synced by the draft room. So we surface exactly the reported gap and never leak
    completed drafts. (Drafting-state cross-device hydration = possible follow-up.)
  - Field names are the Go struct PascalCase (`DisplayName/NumPlayers/IsLocked/
    MaxPlayers/DraftType`, token `LeagueId/PassType/CardId`) — firestore Set()
    ignores json tags. Same names bot/league + passLedger already use.
- `draftStore.hydrateActiveDrafts()` merges missing lobbies in — **add-only**
  (never overwrites a live row), rate-limited 1/15s so refocus churn can't
  self-DDoS (Rule #0). Called on mount + focus in `useActiveDrafts`.

**Files:** `app/api/owner/active-drafts/route.ts` (new), `lib/draftStore.ts`,
`hooks/useActiveDrafts.ts`. tsc + next lint clean. Committing ONLY these 3 —
there's other in-flight uncommitted work in the tree (Live Draft Activity line)
left untouched.

Deploying frontend now via clean-worktree Vercel CLI (git-committed code only).
