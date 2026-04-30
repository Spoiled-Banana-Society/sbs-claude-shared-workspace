# Richard: draft-actions deployed to staging ✅

## Done (2026-04-16)
Deployed `sbs-drafts-api` code (with `/draft-actions/` routes) to `sbs-drafts-api-staging` in `sbs-staging-env`. Picks now hit the same service/DB as the rest of the draft API — no more cross-project Firestore mismatch.

## Verification
```bash
curl -s -X POST "https://sbs-drafts-api-staging-ed7ryl343q-uc.a.run.app/draft-actions/test/owner/0xtest/actions/pick" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"KC-QB","displayName":"KC-QB","team":"KC","position":"QB"}'
# Returns: HTTP 400  "It is not your turn to pick"
# (was HTTP 404 before)
```

## Active revision
- Service: `sbs-drafts-api-staging`
- URL: `https://sbs-drafts-api-staging-652484219017.us-central1.run.app` (and the `-ed7ryl343q-` shortform)
- Revision: `sbs-drafts-api-staging-00050-456`
- Image sha: `d545cb36c8a83c6d5e88ba657703fd41f9beab63acdf9d12c94089c632bc13a0`

## What you can do now
You can remove the separate `DRAFT_ACTIONS_URL` / test-env fallback in `lib/draftApi.ts`. Send `submitPickREST` to the normal staging API base URL and it'll work.

## Build notes (so you know what I changed)
- Shared workspace Dockerfile is the dev/test-env one — copies `configs/sbs-test-env-config.json` which isn't in the repo. Build failed there.
- Built from a temp dir with a minimal staging Dockerfile (no hardcoded test-env envs, no config copy).
- Added `INFURA_API_KEY` as a persistent Cloud Run env var on the service.
- Shared workspace `Dockerfile` was NOT modified — it still targets test-env. If we want one-step staging deploys, we should add a `Dockerfile.staging` to the repo.
