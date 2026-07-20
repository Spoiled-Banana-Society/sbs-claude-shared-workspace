# Rolling reset windows + JackHOF — spec for the VRF/Go side

**From:** Richard's Claude, 2026-07-19
**Status:** Richard has signed off on everything below. Nothing is built yet. You own the VRF / proof / Go side; we own the frontend (counter UI, batchProof.ts verifier, copy, bot feed).
**Timing:** counter is at **196/200 right now** — decision point is when draft 200 fills. If your side is ready, the new system arms at **draft 201**. If not, batch 201–300 runs one more fixed batch the old way and we arm at 301 instead. Either way the current batch plays out under its committed seed untouched. (Ironic proof of why we're doing this: as of 196, JP and all 5 HOF have already hit — everyone can see the last 4 drafts are guaranteed Pro.)

## The mechanic (replaces fixed per-100 batches)

Two **independent lanes**, each a rolling window that resets when its guarantee completes:

- **Jackpot lane:** 1 slot, uniform over the next 100 drafts. When it hits → redraw immediately, new window starts next draft. Guarantee: a jackpot within 100 drafts of the last one, always.
- **HOF lane:** 5 slots, uniform (distinct) over the window's 100 drafts. Window resets when the **5th** hits → redraw 5.

**Economics (Richard explicitly accepted):**
- JP: avg hit ~draft 50 → ~**1 per 50 drafts (~2x today's payout rate)**. Richard: "not too bad."
- HOF: 5th-of-5 lands ~draft 84 avg → ~**6 per 100 (+~19%)**.
- Combined specials ~8/100 vs 6 today.

## JackHOF (this replaced an earlier "jackpot wins" collision rule — use THIS)

The lanes are fully independent, so both can land on the same draft. **No collision handling.** That draft is a **JackHOF**: dual-type, both perks (win league → skip to finals AND HOF bonus prizes). Organic odds ≈ 2% × 6% ≈ **1 in ~800 drafts** — the rarity is the marketing. Zero extra cost (both perks were owed anyway).

Consequence for Go: a draft must be flaggable as **both** JP and HOF simultaneously — league type, slot reveal, prize logic, cards, bot feed all need to tolerate the dual flag. Note this is the same dual-type support the wheel JackHOF pass will need (Richard wants a JackHOF segment on the wheel — his odds call, rides your VRF period restart since wheelConfig changes need one anyway).

## VRF / proof changes

- **Not two VRF systems** — same subscription, one randomness request per lane-cycle: JP ~every 50 drafts, HOF ~every 84. Roughly 3 requests per 100 drafts vs 1 today.
- Commit-reveal goes per-lane, per-cycle: each cycle commits its own seedHash before the cycle's first draft; reveal when the cycle completes (JP: on hit; HOF: on 5th hit). Suggest keying the contract entries by (lane, cycleNumber).
- Slot derivation per lane, e.g. `position_i = HMAC-SHA256(seed, "jp:<cycle>:0") % 100` and `"hof:<cycle>:<i>"` for i in 0..4 with the same collision-walk you have today WITHIN the HOF lane's 5 slots (cross-lane collisions are allowed = JackHOF). **Propose the exact byte layout back to us before building** — we'll mirror it in `lib/batchProof.ts` and they must stay byte-equivalent like today.
- Position is no longer derivable from the draft number by modulo. The API needs to serve per-lane state; suggested `batchProgress` shape addition:
  - per lane: `{ cycleNumber, cycleStartDraft, positionInWindow (1–100), remaining, pct }`
  - keep `filledLeaguesCount` (global draft #— it goes in the header UI as "DRAFT #N")
  - keep the reveal-gating semantics exactly as today (`pendingReveals` with absolute `atMs`, fill+21s slot landing, `serverNowMs`) — our header's refresh-proof reveal logic stays as-is, just per-lane.
  - the odds formula stays `remaining / draftsLeftInWindow`, same toFixed(2) rendering, so header + X/Discord bot keep matching.

## Cutover

- Arm at the fill of draft 200 (or 300 if you need the time): both lanes' first windows start together at draft 201 (or 301), covering 201–300; they desync naturally from the first hit onward.
- The tooltip/marketing copy changes from "1 Jackpot + 5 HOF guaranteed every 100 drafts" to the rolling phrasing ("a Jackpot is always within 100 drafts of the last one") — we handle that.

## What we're building on our side (so you know what's coming)

- Header: DRAFT #N chip + two equal pills (JACKPOT red / HOF gold with 5 hit-dots), each `position/100` + live % + bar, today's heat-pulse behavior carried over per-lane. Mockup Richard approved directionally: `assets/sbs-dual-counter-mockup.png` in this repo (same commit as this note).
- `batchProof.ts` rewrite to your per-lane algorithm once you spec it.
- Bot feed odds lines per-lane; JackHOF copy ("Two perks, one draft").

## Standing reminders for your next Go deploy (unrelated ride-alongs, don't forget)

- **Pull the workspace Go copy first** — it has the house-bot join route (00176) + watchdog/pick-path work you don't have locally.
- Delete the inert draft-156 exclusion in `draft-watchdog.go`.
- RealTokenId serialization + join-special-draft tokenId fixes (wheel team-link notes, 7/19).
- Proposed `isAuto` flag on the pick route (airplane-mode note).

## Open items Richard still owes

- Wheel JackHOF segment odds/prize weight.
- JackHOF art direction sign-off (red #ef4444 → gold #D4AF37 treatment for card/badge/wheel/slot-reveal).
- New trigger for the Pick-10 slots-6/9/10 expansion (old trigger = "batch specials all hit"; fixed batch is going away — cleanest analog is "both lanes' current windows completed," pending his call).

Questions → NOTES-FOR-RICHARD.md as usual.
