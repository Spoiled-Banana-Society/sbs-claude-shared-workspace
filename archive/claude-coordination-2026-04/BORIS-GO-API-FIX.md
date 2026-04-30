# Go API Fix Needed: League Routing

## The Problem
When multiple wallets join fast drafts on staging, they land in **different leagues** instead of the same one. This makes it impossible for two people to draft together.

**Example:** Richard joins → gets `2024-fast-draft-127` (1/10). Boris joins → gets `2024-fast-draft-128` (1/10). They're never in the same draft.

## Root Cause
**File:** `models/leagues.go` — `JoinLeagues()` function

The join logic starts at `draftTracker.FilledLeaguesCount + 1` and iterates forward looking for a league to join. When it finds a league document that doesn't exist yet (or is empty), it creates/joins it.

The problem: if a league at position N is partially filled (e.g. 2/10), and there's an empty/nonexistent league at position N-1, the second user joins N-1 instead of N. The iteration doesn't prioritize **partially-filled** leagues.

## What Needs to Change
The `JoinLeagues` function should prefer the first **partially-filled** league (1-9 players) over an empty one. Specifically:

1. Iterate through leagues starting from `FilledLeaguesCount + 1`
2. If a league has 1-9 players → **join it** (preferred)
3. If a league has 0 players → skip it, keep looking for a partially-filled one
4. If no partially-filled league is found after checking a reasonable range → fall back to creating/joining the first empty one

**Simplified approach:** Just find the first league with `NumPlayers > 0 && NumPlayers < 10` and join that. Only create a new league if none exist with players.

## Key Code Location
```
models/leagues.go — around line 200-250
```

The transaction that reads/writes the league document:
```go
leagueRef := utils.Db.Client.Collection("drafts").Doc(l.LeagueId)
err = utils.Db.Client.RunTransaction(..., func(ctx context.Context, tx *firestore.Transaction) error {
    doc, err := tx.Get(leagueRef)
    // ... checks NumPlayers, appends user, increments count
})
```

## RTDB Write (Already Working)
After a successful join, the API writes to RTDB — this part works fine:
```go
ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", l.LeagueId))
ref.Set(context.TODO(), map[string]interface{}{"numPlayers": l.NumPlayers})
```

The frontend reads this via a server-side proxy (`/api/drafts/league-players`) using the Firebase Admin SDK.

## How to Test
1. Clear all unfilled leagues: fill them with bots via `POST /staging/fill-bots/fast?count=N&leagueId=ID`
2. Wallet A joins a fast draft → should get a fresh league (1/10)
3. Wallet B joins a fast draft → should join the SAME league (2/10), not a new one
4. Check RTDB: both should be in the same `2024-fast-draft-XXX`

## Deploy
```bash
gcloud run deploy sbs-drafts-api-staging --source /path/to/sbs-drafts-api-main --region us-central1 --project sbs-staging-env
```

## Other Context
- League IDs are `2024-fast-draft-{N}` or `2024-slow-draft-{N}` (the year is 2024 in staging, not 2025)
- `draftTracker.FilledLeaguesCount` is currently around 135, but actual Firestore docs for filled leagues only go up to ~128
- The frontend polls RTDB every 2.5s for player count during filling
- Richard's frontend changes are all deployed to Vercel staging at `banana-fantasy-sbs.vercel.app`
