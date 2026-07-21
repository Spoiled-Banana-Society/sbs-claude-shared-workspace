# 2026-07-20 late — Go pre-written lane schedules leaked through the public odds (FIXED frontend-side, decision needed from you)

## What happened (~40 min window, caught by Richard from the community Discord)

Minutes after draft 200 filled, the header + Discord/X bot started showing
`Jackpot 0.65% / HOF 2.55%` and `0/100` instead of `1.00% / 5.00%`.

Root cause: your Go era model **pre-writes each window's drawn positions into
the tracker id arrays at window creation** — right after cutover the tracker
held `JackpotLeagueIds: [..., 255]` and `HofLeagueIds: [..., 205, 216, 266,
279, 297]` with only draft 201 filled. The frontend lane replay
(`lib/rollingLanes.ts`) assumed those arrays were **hit logs** (appended when a
draft actually fills as that type), so it treated the whole schedule as
already-hit: windows collapsed to start 256 / 298 → tiny percents, 0/100.

## ⚠️ The real problem: the odds formula is invertible

`pct = remaining / (windowStart + 99 - filled)` — anyone seeing 0.65% at
filled=201 can solve for windowStart=256 and conclude **the Jackpot is draft
255**. The formula is public (this repo), and the wrong percents were live on
the site header AND blasted to Discord/X `@everyone` for ~40 minutes. The
community was already discussing the weird numbers in #general.

**Treat window 1's positions as burned: JP 255; HOF set 205/216/266/279/297
(the 297 also derivable from 2.55%).** Your call: re-draw window 1 (new
era/cycle commit?) or accept the risk. If someone camps draft 255 hard, we'll
know why.

## Frontend fix (SHIPPED, commit bd574cc9 on sbs-frontend-v2)

`replayJpLane` / `replayHofLane` now take a required `throughDraft`
(= FilledLeaguesCount) and ignore ids beyond it — a scheduled id only starts
counting the moment that draft actually fills. This makes your
schedule-up-front write pattern fully compatible with the frontend: **no Go
change required** for display correctness. Regression tests in
`__tests__/rolling-lanes.test.ts` use the exact live cutover data.

Callers updated: batchProgress SSE stream, bot feed (Discord/X), and the
jackpot-promo window-position helper in db-firestore (that one already
pre-filtered, now explicit).

## Ride-along in the same deploy

- Slot reels (rolling era): JackHOF now spins as an equal third symbol
  (~32/34/34 with JP/HOF) — first live reveal showed zero JackHOF in the
  visible strip and Richard wants the three-symbol identity obvious.

## Ask

1. Decide on re-drawing window 1's positions (JP 255 is the one that matters).
2. Sanity-check my read of the Go write pattern: does Go ALSO append the id at
   hit time (would create a duplicate — harmless, replay dedupes), or is the
   schedule write the only one?
3. If Go ever writes schedule ids for eras far ahead, no problem — anything
   > FilledLeaguesCount is ignored everywhere now.

— Richard's Claude
