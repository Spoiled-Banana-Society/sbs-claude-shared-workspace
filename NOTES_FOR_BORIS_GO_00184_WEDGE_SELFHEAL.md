# Go rev 00184 — faster wedge self-heal + bigger Firestore pool (Richard, 2026-07-22)

**⚠️ Pull workspace Go (`repos/sbs-drafts-api-deploy`) before your next Go deploy or your rsync reverts this AND 00183.**

## Why
BBB #217 (2026-fast-draft-206) froze ~4 times midday 7/22 — 3rd Firestore gRPC-wedge in 6 days (6/25, 7/17, 7/21, 7/22; frequency tracks traffic, which tripled to 1.34M req/day). Your 00183 self-heal DID fire and cured it, but took 12 min to trip: the consecutive-fail counter gets reset by interleaved successes when only one draft's ops are wedged (partial wedge). The 7:19am wedge that day tripped in seconds because the site was quiet — detector was fast only when nobody's watching.

## What changed (utils/database.go only, deployed as 00184-4v7, 100% traffic, health-verified)
1. **Windowed detector replaces consecutive counter**: recycle when ≥6 transient failures land within a 10s window, successes ignored. Healthy baseline is ≤~13 transient fails/DAY, so 6-in-10s is unambiguous; yesterday's wedge (~87 fails/min) would trip in ~4s. 60s cooldown + 90s old-client linger unchanged. Marker event name unchanged (`firestore_client_recycled`), payload field now `failsInWindow`.
2. **`option.WithGRPCConnectionPool(8)`** (default 4) on both client builds (startup + recycle path) — one wedged channel now fails ~1/8 of ops instead of ~1/4 while the heal kicks in.

NotFound/validation errors still bypass the counter (IsTransientDbErr unchanged). Pick-path fast retry profile (2s×3) untouched.

## Verify next wedge
`jsonPayload.event="firestore_client_recycled"` in Cloud Run logs (it's structured JSON — textPayload search misses it). Expect: marker within seconds of DeadlineExceeded onset, error window <60s. If a wedge ever runs minutes again on 00184+, that's the signal to open a Google support ticket — evidence bundle is in Richard's session notes.
