# Slow draft clock switch (SHIPS DARK) — 2026-08-26

Richard wants slow drafts to match Underdog 1:1 (UD went 8h → 4h today, expected to
keep dropping toward kickoff). Built behind ONE switch so the flip is his call and
future matches need no deploy on either side.

## The switch — Firestore `system_config/slowDraftClock`
```
{ enabled: false,               // ← green light. false = EXACT legacy behaviour everywhere
  pickLengthSec: 14400,         // 4h. Change to match UD (7200, 3600 …). Max 17h (one active window)
  freshClockAfterPause: true,   // pick that straddles 22:00 PT restarts with a FULL clock at 05:00 PT
  startsAtIso: '2026-08-27T12:00:00Z' }  // optional gate: reads as OFF until this instant (5am PT Aug 27)
```
**ARMED 8/26 evening: enabled=true + startsAtIso=2026-08-27T12:00:00Z → goes live 5am PT Thu Aug 27 on its own.**
Toggle: `node scripts/_slow-clock-toggle.mjs [--on|--off|--hours 2|--minutes 60|--fresh on|off]` (Next repo).
Both sides cache the doc 60s, so a flip lands within a minute.

## Go (sbs-drafts-api, rev after 00197)
- `models/slow_draft_clock_config.go` NEW: cached reader + `SlowDraftEffectivePickLength(stored)`
  + `SlowDraftFreshClockAfterPause()`. Nil-safe (tests / no Db → off).
- `models/slow_draft_clock.go`: `SlowDraftPickEndUnix` now → `slowDraftPickEndUnixOpts(from, len, fresh)`.
  fresh=true: when the pick crosses 22:00 the remaining resets to the FULL length at 05:00
  (no more "woke up with 40 minutes"). fresh=false: old carry-over, byte-identical.
- Call sites: `draft-state.go` creation (`pickLength = SlowDraftEffectivePickLength(0)`),
  `draft-actions.go` ProcessNewPick (re-derives PickLength every pick and PERSISTS it on the
  realtime doc, so in-progress drafts get the new clock on their next pick and the room /
  "your turn" notifs read the right number), `draft-watchdog.go` re-arm (same override,
  fallback 28800 removed).
- Tests: `go test ./models/ -run SlowDraft` (9 pass). Legacy tests untouched.
- The pick currently on the clock keeps the PickEndTime it was armed with; next pick gets the
  new clock. Autopick Cloud Task is still scheduled off PickEndTime, nothing else changed.

## Next.js (sbs-frontend-v2)
- `lib/slowClock.ts` (copy builder — every phrasing: "8 hours", "8hr", "8h", "8 hrs/pick",
  "8 hour", "8-hour"), `lib/slowClockServer.ts` (admin read, 60s cache),
  `/api/config/slow-clock` (CDN 60s), `contexts/SlowClockContext.tsx` (`useSlowClock()`,
  ONE fetch on mount, provider in app/providers.tsx).
- Every hardcoded 8-hour string (27 sites: FAQ, /draft, /how-it-works, wheel pages, modals,
  DraftRow/LeagueTable/CompletedDrafts badges, marketplace, private leagues, queue bells) now
  reads the hook. `lib/faqContent.ts` is `buildFAQSections(copy)`; `mockFAQSections` = legacy.
- While ON the FAQ gains: "Clocks get shorter as kickoff gets closer so every draft finishes
  in time." (no numbers, no dates — deliberate) and the fresh-clock sentence.
- `utils/slowDraftClock.ts` mirrors the fresh rule (`slowDraftPickEndUnix(from, len, fresh)`);
  `useTimeRemaining` caps the slow display at pickLength (no-op legacy).
- Vitest: `__tests__/slowClock.test.ts` proves switch-off copy is byte-identical to before.

## Flip-day checklist (Richard's call)
1. `node scripts/_slow-clock-toggle.mjs --on` (or `--hours N` later to match UD).
2. Watch the next slow pick advance in logs: `[slowclock] config now enabled=true pickLengthSec=14400 …`
   then a realtime doc with `pickLength: 14400`.
3. Announce (tweet drafted, in Richard's hands).
