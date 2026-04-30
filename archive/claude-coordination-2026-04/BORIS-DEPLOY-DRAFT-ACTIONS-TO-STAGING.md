# Boris: Deploy draft-actions routes to sbs-staging-env

## The Problem
Picks fail with 400 "not your turn" because the two APIs read different databases:

| Service | Project | Draft 154 state |
|---------|---------|----------------|
| `sbs-drafts-api-staging-652484219017` | sbs-staging-env | pick=17, drafter=0x4f643e... (ACTIVE) |
| `sbs-drafts-api-ajuy5qy3wa` | sbs-test-env | pick=150, drafter=0x466d16... (OLD/DIFFERENT) |

Drafts are created on staging Firestore. Picks go to test-env which reads a completely different Firestore. The test-env API doesn't see the staging draft → rejects the pick.

## What To Do
Add the `/draft-actions/` routes to the staging API service so everything reads from the same database.

Either:
1. **Deploy the draft-actions code to `sbs-drafts-api-staging`** in `sbs-staging-env` project
2. **Or configure `sbs-drafts-api` in `sbs-test-env`** to point at the staging Firestore

Option 1 is cleanest — one service, one database, no cross-project confusion.

## Deploy Command (Option 1)
```bash
gcloud run deploy sbs-drafts-api-staging \
  --source /path/to/drafts-api-with-draft-actions \
  --region us-central1 \
  --project sbs-staging-env
```

## After Deploy
Once the `/draft-actions/` routes exist on `sbs-drafts-api-staging-652484219017.us-central1.run.app`, I'll update the frontend to remove the separate `DRAFT_ACTIONS_URL` and send everything to the staging API.

## How To Verify
```bash
curl -X POST "https://sbs-drafts-api-staging-652484219017.us-central1.run.app/draft-actions/test/owner/0xtest/actions/pick" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"KC-QB","displayName":"KC-QB","team":"KC","position":"QB"}'
```
Should return "It is not your turn to pick" (not 404).
