# Boris: Draft Actions Service URL Needed

## What Richard's Claude Needs
The `submitPickREST` function calls `/draft-actions/{draftId}/owner/{wallet}/actions/pick` to submit picks during a draft. This endpoint returns **404** on the staging API (`sbs-drafts-api-staging-652484219017.us-central1.run.app`) because the draft-actions service is deployed in **sbs-test-env**, not sbs-staging-env.

## What To Do

### Option A: Give me the URL
Run this to find the service URL:
```bash
gcloud run services list --project sbs-test-env --region us-central1
```

Find the service that handles `/draft-actions/` routes and share the URL. I need to add it to the frontend so picks get sent to the right place.

### Option B: Check the endpoint works
Test this (replace the URL with the actual sbs-test-env service):
```bash
curl -X POST "https://{YOUR-SERVICE-URL}/draft-actions/2025-fast-draft-141/owner/0xtest/actions/pick" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"KC-QB","displayName":"KC-QB","team":"KC","position":"QB"}' 
```

If it returns something other than 404, that's the right URL.

### Option C: Deploy draft-actions to sbs-staging-env
If the service only exists in sbs-test-env, deploy it to sbs-staging-env too so the staging frontend can reach it at the same base URL as the drafts API.

## Context
- The frontend currently sends ALL API calls to: `https://sbs-drafts-api-staging-652484219017.us-central1.run.app`
- Draft info, player rankings, rosters — all work on this URL
- Only `/draft-actions/` routes return 404 because they're on a separate service
- As a temporary workaround, picks are being sent via WebSocket (`pick_received` message) which works but you said WS was removed
- The staging WS server IS still running and accepting connections at `wss://sbs-drafts-server-staging-652484219017.us-central1.run.app`

## Where to update once I have the URL
File: `repos/banana-fantasy/lib/draftApi.ts` — the `submitPickREST` function needs to call the correct service URL instead of the drafts API URL.
