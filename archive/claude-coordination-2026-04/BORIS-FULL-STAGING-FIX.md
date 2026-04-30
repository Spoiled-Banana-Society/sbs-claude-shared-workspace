# Boris: Full Staging Fix List

Everything the dev built needs these pieces working together. Here's what's broken and what to fix.

## 1. CRITICAL: Firebase RTDB Security Rules
The frontend subscribes to two RTDB paths but gets `permission_denied`:
```
/drafts/{draftId}/numPlayers        — player count during filling
/drafts/{draftId}/realTimeDraftInfo  — current drafter, timer, picks
```

**Fix:** In Firebase Console → sbs-staging-env → Realtime Database → Rules:
```json
{
  "rules": {
    "drafts": {
      "$draftId": {
        "realTimeDraftInfo": { ".read": true, ".write": false },
        "numPlayers": { ".read": true, ".write": false }
      }
    }
  }
}
```

## 2. CRITICAL: Backend Must Write `realTimeDraftInfo` to RTDB
The Go API writes `numPlayers` to RTDB when players join, but does NOT write `realTimeDraftInfo`. The frontend needs this updated on EVERY pick:

**RTDB path:** `drafts/{draftId}/realTimeDraftInfo`

**Structure the frontend expects:**
```json
{
  "currentDrafter": "0xwallet...",
  "pickNumber": 42,
  "roundNum": 5,
  "pickInRound": 2,
  "pickEndTime": 1776380000,
  "pickLength": 30,
  "draftStartTime": 1776379000,
  "isDraftComplete": false,
  "isDraftClosed": false,
  "lastPick": {
    "playerId": "KC-RB1",
    "displayName": "KC-RB1",
    "team": "KC",
    "position": "RB",
    "ownerAddress": "0xpicker...",
    "pickNum": 41,
    "round": 5
  }
}
```

**Where to add:** In the draft-actions pick handler — after processing a pick, write this object to RTDB. Also write it when the draft first starts (10/10 fills).

## 3. Environment Config Fixes
`/tmp/sbs-frontend-v2/.env.production` has WRONG values:

| Variable | Current (WRONG) | Should Be |
|----------|----------------|-----------|
| `NEXT_PUBLIC_DRAFT_SERVER_URL` | `wss://sbs-drafts-server-w5wydprnbq-uc.a.run.app` (PROD) | `wss://sbs-drafts-server-staging-652484219017.us-central1.run.app` |
| `NEXT_PUBLIC_PROJECT_ID` | `sbs-prod-env` | `sbs-staging-env` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Prod key | Staging key (check Firebase Console) |

Fix these in `.env.production` in the `sbs-frontend-v2` repo, or set them as Vercel environment variables.

## 4. Draft-Actions Endpoints (on staging API)
The frontend calls three `/draft-actions/` endpoints. Verify all exist on `sbs-drafts-api-staging`:

```bash
# 1. Submit pick
curl -X POST "https://sbs-drafts-api-staging-652484219017.us-central1.run.app/draft-actions/test/owner/0xtest/actions/pick" \
  -H "Content-Type: application/json" -d '{"playerId":"KC-QB"}'

# 2. Get preferences  
curl "https://sbs-drafts-api-staging-652484219017.us-central1.run.app/draft-actions/test/owner/0xtest/preferences"

# 3. Update auto-draft
curl -X PATCH "https://sbs-drafts-api-staging-652484219017.us-central1.run.app/draft-actions/test/owner/0xtest/preferences" \
  -H "Content-Type: application/json" -d '{"autoDraft":true}'
```

All should return something other than 404.

## Summary — Priority Order
1. **RTDB security rules** — allows frontend to receive real-time updates
2. **RTDB writes on pick** — backend pushes state to RTDB after each pick
3. **Env config** — fix WS URL and project ID in .env.production
4. **Verify all 3 draft-actions endpoints** exist on staging

Once #1 and #2 are done, the draft will work as the dev designed — Firebase RTDB pushes real-time state, REST submits picks. No workarounds needed.
