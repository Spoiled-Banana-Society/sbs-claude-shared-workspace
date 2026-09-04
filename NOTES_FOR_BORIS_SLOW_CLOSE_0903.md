# Regular slow drafts closed + 1h clock (Richard green light 2026-09-03)

## What changed on the Go API (deployed from Richard's Mac, rev sbs-drafts-api-staging-00205-m87)
Built from the exact source of your 9/3 08:35 PT build (b471ab7d zip), so nothing of yours was reverted. Two files touched:

- `models/slow_draft_clock_config.go`: `SlowDraftClockConfig` gains `RegularJoinClosed bool` (`regularJoinClosed`) and `RegularJoinLastLobbyId string` (`regularJoinLastLobbyId`), plus `SlowDraftRegularJoinAllowed(draftId) (bool, allowedId)`. Not gated by `active()` / `startsAtIso`.
- `models/leagues.go`: new sentinel `errRegularSlowClosed` ("regular slow drafts are closed to new entries — slow drafts now run only in special leagues"). `AddCardToLeague` checks it at the top of the walk-forward loop for `draftType == slow`, BEFORE the read/create of that number, so a public slow join can only seat into `RegularJoinLastLobbyId`; anything else (walk past it on full/already-in, or a NotFound that would create the next lobby) returns the error with the pass untouched. `AddCardToSpecificLeague` (house bots) has the same check. Log tag `[slowclose]`.

Private leagues (`JoinPrivateLeague`) and specials (create-special-draft) are not touched. Firestore flag lives on `system_config/slowDraftClock`; the frontend repo has `scripts/_slow-clock-toggle.mjs --close-regular <id> | --open-regular`. Currently closed with last lobby `2026-slow-draft-168` (filled 9/3 evening). `2026-slow-draft-169` exists as an empty slot doc (Bradleybus's double-join seat was removed via the leave endpoint, pass restored).

## Clock
Tonight 10pm PT a launchd job on Richard's Mac sets `pickLengthSec=3600`, `pauseEndHour=9`, clears `startsAtIso`, then re-stamps every active slow draft's current pick in RTDB to `pickEnd = 9am+1h = 10am PT` (`pickStartTime`, `pickEndTime`, `pickLength`). The original Cloud Task for those picks fires at the old 11am end and no-ops ("Pick already completed"); the dead-clock-kick cron autopicks ~3–5 min after 10am if the user is silent. No Go change for that.

## Frontend (sbs-frontend-v2 5e2e62c7 + f63a2722)
Site gates slow joins client-side too (next-lobby route reports `regularSlowClosed`), hides the Slow button, and drops the speed picker entirely once no slow lobby is open (fast is the only public lane). Copy on FAQ / draft / how-it-works says slow is specials-only.

Synced copies: `~/sbs-drafts-api-deploy` (Richard's) and `repos/sbs-drafts-api-deploy` here.
