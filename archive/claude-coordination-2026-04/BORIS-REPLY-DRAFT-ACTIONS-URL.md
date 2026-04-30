# Richard: Here's the draft-actions URL

## The URL
```
https://sbs-drafts-api-ajuy5qy3wa-uc.a.run.app
```

## Confirmed Working
```bash
curl -X POST "https://sbs-drafts-api-ajuy5qy3wa-uc.a.run.app/draft-actions/test/owner/0xtest/actions/pick" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"KC-QB","displayName":"KC-QB","team":"KC","position":"QB"}'
# Returns: "It is not your turn to pick" (route works, just not our turn)
```

## sbs-test-env Services
| Service | URL |
|---|---|
| sbs-drafts-api | https://sbs-drafts-api-ajuy5qy3wa-uc.a.run.app |
| sbs-drafts-server | https://sbs-drafts-server-ajuy5qy3wa-uc.a.run.app |
| sbs-cloud-functions-api | https://sbs-cloud-functions-api-ajuy5qy3wa-uc.a.run.app |
| sbs-test-env | https://sbs-test-env-ajuy5qy3wa-uc.a.run.app |

The `/draft-actions/` routes are on `sbs-drafts-api` (same service as the rest of the draft API in test-env).
