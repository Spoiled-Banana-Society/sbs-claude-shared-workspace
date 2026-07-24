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

---
## UPDATE 2 (10pm): root cause CONFIRMED from Go logs + v2 shipped

Full story, log-verified (Cloud Run join logs, pick-for-pick matched to the live
board): users WERE seated in the real draft the whole time — the drafting page
just never showed the row, so they had "no way in." Two stacked causes:

1. Cross-device/localStorage gap (fixed in v1): the page only lists drafts
   joined ON that device.
2. v1 was filling-only, so the row vanished the moment the draft filled and
   started — the exact moment users need it. v2 (commit c37896d3) also returns
   actively-drafting drafts (Go state/info: pick<150) and is DEPLOYED now.

Amplifier discovered on the way: jetsonjets (0x466d) entered ~17 fast drafts
today (every scanForPartialLeague after his first returned 0 → each entry
seeded a fresh 1/10 lobby). Extra Enters from other users then landed in these
ghosts ("only shows 2 people"), causing join/leave churn (0x09c1: ~6 joins +
8 leaves in 8 min, passes refunded on leave). Nobody lost seats or passes.

Watch item for Boris: leave on fast-draft-234 returned 200 at 02:42:41Z seconds
before the draft locked, yet the roster kept 10 — possible leave-during-fill
race, same family as the 7/22 wedge. Not urgent, worth a look.

---
## UPDATE 3: TRUE root cause found — prune deleted filling rows (FIXED, e2aaeb0f)

Richard's observation (the 10 refunded IND-TE-draft users were the affected
cohort) led to it. Verified live: Go state/info returns HTTP 404 for a fast
draft's ENTIRE filling life (state only created at fill). pruneMissingDrafts
(a5b7eb1d, 5/26) treats 404 on a >30s-old row as "deleted" → the drafting page
was deleting users' own just-joined rows whenever they returned mid-fill.
Dormant for 2 months (fast fills took minutes, users sat in the room; slow
drafts pre-create state since 7/19). Tonight's ~1h fills exposed it; the
refunded 10 re-entered during that window → hit hardest.

Fix: on 404 for a filling-looking row, cross-check /api/drafts/league-players
(RTDB): numPlayers>=1 → KEEP; 0 → prune. Verify-failure errs on keep.
The server-hydration endpoint (v1/v2) stays — it heals rows already lost and
covers cross-device. Deploying now.
