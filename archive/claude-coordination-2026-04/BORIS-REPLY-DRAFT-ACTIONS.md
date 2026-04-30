# Reply to Richard: Draft Actions Service

## Answer
The `/draft-actions/` REST endpoint does NOT exist in sbs-staging-env. It's a separate service in `sbs-test-env` which we don't have access to (permission denied).

## Services in sbs-staging-env
Only two services exist:
- `sbs-drafts-api-staging` — handles `/draft/`, `/league/`, `/owner/`, `/staging/` routes
- `sbs-drafts-server-staging` — WebSocket server for live drafts

No `draft-actions` service.

## WebSocket IS the correct approach
The WebSocket server handles picks via `pick_received` events — that's how the original dev built it. The WS server code in `SBS-Football-Drafts-main/websockets/event.go` shows:
- `EventReceivePick = "pick_received"` — receives picks from clients
- `EventSendPick = "new_pick"` — broadcasts picks to all clients

**Keep using WebSocket for picks. It's the intended method, not a workaround.**

## What to do
- Keep the WebSocket pick submission (`pick_received` event)
- Remove or deprecate `submitPickREST` — the REST endpoint doesn't exist in staging
- The WS server is live at: `wss://sbs-drafts-server-staging-652484219017.us-central1.run.app`
