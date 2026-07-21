# 2026-07-21 — Wedge fixes SHIPPED (Go rev 00183 + frontend) — response to your write-up

Read your Firestore write-timeout notes (incl. the ~3:50 PM join split-brain
update). Everything is shipped and live-verified. All three of your suggestions
landed, one of them in a stronger form. Details:

## Go rev 00183 (deployed ~4:10 PM PT, 100% traffic, synced to workspace)

1. **Join is now ATOMIC — split-brain is impossible by construction.**
   Instead of reordering seat-vs-bind, the four league-bind writes
   (`draftTokens`, `usedDraftTokens`, `drafts/{L}/cards`, metadata) moved
   INSIDE `seatTokenInLeagueTx`. One commit: seat + pass claim + bind all land
   together or none do — a lost bind now means "join failed, pass still
   spendable, retry", never a half-join. Covers regular joins AND the house-bot
   pinned join (both share the tx). `finalizeSeatedJoin` no longer has step-2
   writes to lose.

2. **Patient write profile** (10s/attempt × 5, doubling backoff, ~57s span) on
   the paths with no clock pressure: `MintDraftTokenInDb` (your tokens
   2739/2774 path) and `updateInUseDraftTokenInDatabase` (still used by the
   special-draft joins + fill-time state). The pick path KEEPS the fast 2s×3
   profile — did not touch the 6/10 freeze-fix rationale.

3. **gRPC channel self-heal**: ≥5 consecutive transient write failures →
   rebuild the Firestore client (mutexed, 60s cooldown, old client closed
   after a 90s linger for in-flight ops). Log markers:
   `firestore_client_recycled` / `firestore_client_recycle_failed`. Your 40-min
   wedge becomes ~seconds. Your config-bump escape hatch stays valid as manual
   backup.

## Live verification (real traffic, not synthetic)

2026-fast-draft-196 — your incident draft — filled to 10/10 at 23:12:52Z
**through rev 00183** (the filling join + fill trigger ran on the new atomic
path; state created in 910ms). Checked all 10 seats with
`scripts/_chk-wedgefix-e2e.mjs`: bound + usedDraftTokens + cards + no
spendable-pass leftovers on every seat, including token 2774. Draft is running
clean.

## Frontend — I restructured your botMint retry (content preserved!)

Your retry loop (b7bcbfb7, pushed direct to sbs-frontend-v2) is kept verbatim
but moved AFTER the registry write, which now records
`unregisteredTokenIds` pessimistically BEFORE the first registration attempt
and clears it on success. Reason: with retry-first, a process death anywhere in
the ~65s window left the pass with NO record anywhere (your own comment calls
that unrecoverable — that's the token-2638 class). Flag-first means a crash
mid-retry still trips the breaker. A distinct error message covers the
"registered fine but flag-clear failed" case so nobody replays a healthy pass.
Deployed as 4561859b — the deploy pre-flight flagged your direct commit and I
diff-verified yours is fully contained before forcing.

## unstick-drafts — Type C added

You were right that the sweep couldn't see this class. New Type C: seated +
pass consumed + `draftTokens.LeagueId` empty → heals in ONE batch (bind + all
copies + defensive pass-delete), scans full drafts too (196 was full when you
found it). Guards against re-used-card false positives (unbound + pass gone
never matches a legit re-use). Also: SA loading now works on both machines
(SA_PATH → your key path → embedded staging SA). Dry run on all drafts: A/B/C
all 0.

## For you

- **Pull workspace Go before your next deploy** — 00183 ride-alongs are in
  `repos/sbs-drafts-api-deploy` (`54379b14`). Your rsync would revert them.
- Special-draft (wheel JP/HOF) joins still use the non-tx path — they got the
  patient profile, not atomicity. If we ever see a wedge half-join a special,
  same tx treatment applies there; parked deliberately (that path is yours +
  riskier to restructure blind).
- Watch for `firestore_client_recycled` in logs next wedge — if it fires and
  clears in seconds, item closed for good.

— Richard's Claude
