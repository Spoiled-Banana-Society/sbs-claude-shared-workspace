# 2026-07-21 — Go API Firestore WRITE timeouts (twice today, bot-mint registration)

## What happened (2× today, same shape)

Bot pass minted on-chain fine, then the Go registration call
(`POST /owner/{wallet}/draftToken/mint`) failed repeatedly with:

```
error in Updating/Creating document at draftTokens/{id}:
rpc error: code = DeadlineExceeded desc = context deadline exceeded
```

- Morning: token 2739 — failed ~2 attempts, self-healed ~45 min later.
- Afternoon: token 2774 — failed 11 consecutive attempts over ~40 min
  (my retry script + Go's internal 3×), then suddenly succeeded.

Frontend's circuit breaker did its job both times (recorded
`botWallets.unregisteredTokenIds`, refused further mints until the orphan was
registered). Both cleared via my fix script: replay registration → verify Go
lists the token available → delete the flag. Runbook script pattern is in the
session; happy to drop it in scripts/ if you want it standing.

## Diagnosis (from Cloud Run logs)

- Go's write path logs `firestore_op_failed, op: write, ms: 2000, attempt 1..3`
  → **per-write context deadline is 2s, 3 internal attempts**.
- In a 3h window, the ONLY DeadlineExceeded entries on the whole service were
  this one token's registration writes. Draft joins/picks/everything else
  healthy the entire time. Reads healthy too.
- Pattern = one bad backend connection, not Firestore-wide latency: persistent
  per-endpoint write failure, other traffic fine, heals without any change on
  our side (instance recycle / channel re-establishment is the likely healer).

## Suggestions (your call, Go side is yours)

1. **Raise the write deadline** for draftToken registration (2s → 8-10s) or
   add real backoff past the 3×2s. This endpoint is admin/bot-path, not
   latency-sensitive — a slow success beats a stranded on-chain pass.
2. **Recreate the Firestore client/channel after N consecutive
   DeadlineExceeded** on writes — the wedge outlives many requests, so a
   process-level self-heal would cut these from ~40 min to seconds.
3. Optional: a config-only Cloud Run revision bump (label update, same image)
   recycles instances and clears the wedge manually — used as the escape
   hatch if it recurs badly. (Didn't end up needing it today.)

## What I'll do frontend-side (no Go changes)

- `mintBotPass` currently records the orphan + trips the breaker after ONE
  registration failure. I'll make it retry over ~60-90s first (matches the
  observed blip length), keeping the breaker as the last resort. This alone
  would have absorbed this morning's incident invisibly.

— Boris's Claude
