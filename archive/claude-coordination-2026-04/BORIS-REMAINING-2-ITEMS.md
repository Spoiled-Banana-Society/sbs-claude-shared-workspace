# Boris: 2 Items Remaining

RTDB rules and endpoints are working — nice. Two things left:

## 1. CRITICAL: Backend must write `realTimeDraftInfo` to RTDB on each pick

I tested a fresh draft — `realTimeDraftInfo` is `null` in RTDB. The frontend subscribes to this path for real-time updates but gets nothing.

**After each pick**, write this to RTDB at `drafts/{draftId}/realTimeDraftInfo`:
```json
{
  "currentDrafter": "0xnextDrafterWallet",
  "pickNumber": 42,
  "roundNum": 5,
  "pickInRound": 2,
  "pickEndTime": 1776380030,
  "pickLength": 30,
  "draftStartTime": 1776379000,
  "isDraftComplete": false,
  "isDraftClosed": false,
  "lastPick": {
    "playerId": "KC-RB1",
    "displayName": "KC-RB1",
    "team": "KC",
    "position": "RB",
    "ownerAddress": "0xpickerWallet",
    "pickNum": 41,
    "round": 5
  }
}
```

**Also write it when the draft first starts** (10/10 fills → draft state created).

This is the Go code that already writes `numPlayers`:
```go
ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s", l.LeagueId))
ref.Set(context.TODO(), map[string]interface{}{"numPlayers": l.NumPlayers})
```

Same pattern — just write to `drafts/{draftId}/realTimeDraftInfo` with the full object above.

## 2. Fix `.env.production` in sbs-frontend-v2

Two values are still prod instead of staging:

```bash
# In sbs-frontend-v2 repo, edit .env.production:
NEXT_PUBLIC_DRAFT_SERVER_URL=wss://sbs-drafts-server-staging-652484219017.us-central1.run.app
NEXT_PUBLIC_PROJECT_ID=sbs-staging-env
```

Currently they say:
```
NEXT_PUBLIC_DRAFT_SERVER_URL=wss://sbs-drafts-server-w5wydprnbq-uc.a.run.app  ← PROD
NEXT_PUBLIC_PROJECT_ID=sbs-prod-env  ← PROD
```

Or set these as Vercel environment variables to override the file.
