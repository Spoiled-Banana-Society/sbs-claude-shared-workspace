# Richard: Full staging fix list — audit results

Went through all 4 items. 3 were already fixed; 1 had a real bug I cleaned up.

## 1. RTDB Security Rules — ✅ Already correct
```
GET /drafts/test-draft/realTimeDraftInfo.json  → 200
GET /drafts/test-draft/numPlayers.json         → 200
GET /.json (root)                              → 401 (as expected)
```
Rules from Boris's 2026-03-27 Console edit are live.

## 2. Backend RTDB writes — ✅ Already in deployed code (revision 00050-456)
The code I deployed earlier today already writes `realTimeDraftInfo` to RTDB:
- **On draft fill:** `models/draft-state.go:586` — `CreateLeagueDraftStateUponFilling` writes the full `realTimeDraftInfo` object (currentDrafter, pickNumber, roundNum, pickInRound, pickEndTime, pickLength, draftStartTime, lastPick, isDraftComplete, isDraftClosed) under `drafts/{draftId}/`.
- **On each pick:** `models/draft-actions.go:149` — `ProcessNewPick` calls `realTimeDraftInfo.Update(draftId)` which writes back.

Field names in the Go struct (`models/draft-actions.go:17-28`) match your spec exactly:
```
currentDrafter, pickNumber, roundNum, pickInRound, pickEndTime,
pickLength, draftStartTime, lastPick, isDraftComplete, isDraftClosed
```

If you're still not seeing updates, it's probably a stale draft created before the deploy (00050-456 is active as of ~16:33 UTC today). Any draft that fills after that should have a proper `realTimeDraftInfo`.

## 3. Environment Config — ✅ Fixed (real bug)
Found it — most Vercel env vars had **trailing `\n` characters** baked into the stored value. Probably `echo "value" | vercel env add` from prior sessions — `echo` adds a newline, Vercel stored it, and Next.js dotenv unescapes `\n` back to a real newline at runtime. That would break Firebase init, URL construction, etc.

**Fixed (`printf` instead of `echo`, no trailing newline):**
- `NEXT_PUBLIC_PROJECT_ID` → `sbs-staging-env`
- `NEXT_PUBLIC_DATABASE_URL` → `https://sbs-staging-env-default-rtdb.firebaseio.com`
- `NEXT_PUBLIC_AUTH_DOMAIN` → `sbs-staging-env.firebaseapp.com`
- `NEXT_PUBLIC_APP_ID` → `1:652484219017:web:3763f82d12169f0e177658`
- `NEXT_PUBLIC_FIREBASE_API_KEY` → `AIzaSyDqT3xD6T-5iUWlf688NZsuFu6CDZFR5cg`
- `NEXT_PUBLIC_MESSAGING_SENDER_ID` → `652484219017`
- `NEXT_PUBLIC_STORAGE_BUCKET` → `sbs-staging-env.firebasestorage.app`
- `NEXT_PUBLIC_STAGING_DRAFTS_API_URL` → `https://sbs-drafts-api-staging-652484219017.us-central1.run.app`
- `NEXT_PUBLIC_STAGING_DRAFT_SERVER_URL` → `wss://sbs-drafts-server-staging-652484219017.us-central1.run.app`
- + Alchemy, OpenSea, Persona, WalletConnect secrets

Left alone: `FIREBASE_SERVICE_ACCOUNT_JSON` (trailing `\n` doesn't break JSON.parse).

**Also worth knowing about items you flagged:**
- `NEXT_PUBLIC_DRAFT_SERVER_URL` does point at prod (`w5wydprnbq`) but is **never used** — `lib/staging.ts:44` hardcodes `isStagingMode()` → `true`, so `getDraftServerUrl()` always returns `NEXT_PUBLIC_STAGING_DRAFT_SERVER_URL`. I left the prod var alone since touching it isn't needed for staging to work.
- Firebase project ID was already `sbs-staging-env` (pre-fix) — the trailing `\n` was the actual culprit, not a wrong project.

Redeploy triggered to pick up the cleaned env vars.

## 4. Endpoints — ✅ All three return non-404
```
POST /draft-actions/{draftId}/owner/{wallet}/actions/pick      → 400 "It is not your turn to pick"
GET  /draft-actions/{draftId}/owner/{wallet}/preferences       → 200
PATCH /draft-actions/{draftId}/owner/{wallet}/preferences      → 200
```

## Summary
| Item | Status |
|------|--------|
| RTDB rules | Already live |
| RTDB writes on pick | Already in deployed code (00050-456) |
| Env config | Fixed 19 vars — trailing `\n` bug |
| Endpoints | All 3 working |

Once the Vercel redeploy finishes, give it a fresh test and let me know if the timer / pick flow works end-to-end.
