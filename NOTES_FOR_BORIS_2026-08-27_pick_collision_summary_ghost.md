# Pick collision leaves a ghost in the draft summary (BBB #954, 2026-08-27)

## What happened (log proof, sbs-drafts-api-staging rev 00200, 22:11:46Z)
Draft 2026-fast-draft-843, pick 103, Rdvdaboss (0x966d3ba7...). His 30s clock expired at
22:11:44 and the Cloud Task autopick started processing MIN-QB from his queue. ~2s later,
while that was still in flight, he clicked NE-DST manually. Both requests entered
ProcessNewPick for pick 103 and both passed the CurrentDrafter/CurrentPickNumber checks
(neither had advanced yet).

- 22:11:46.260  Just added player MIN-QB to roster (autopick wins the roster)
- 22:11:46.303  NE-DST roster write rejected: "would have more players than allowed in round 11"
- 22:11:46.314  Updated Draft Summary For Pick 102: MIN-QB
- 22:11:46.336  Updated Draft Summary For Pick 102: NE-DST   <-- overwrote MIN-QB
- 22:11:46.359  manual pick POST returns 400

Result: roster + playerState = MIN-QB (correct), summary slot 103 = NE-DST (wrong).
NE-DST was never really owned, so bot Banana24317 legitimately took it at pick 107, and the
board showed NE-DST twice and MIN-QB nowhere. Three later bot attempts at MIN-QB got
"already picked", confirming playerState was right.

## Why the code allows it
models/draft-actions.go ProcessNewPick: summary / roster / playerState writes run
CONCURRENTLY (sync.WaitGroup). When rosterErr fires, the summary write has already landed
and is never reverted (RevertAdditionToDraftSummary exists but is not called here).
models/players.go UpdateDraftSummary is a plain read-then-write: both concurrent callers
saw the slot empty, both wrote, last writer won.

## Suggested fix (Go, your deploy copy)
1. In ProcessNewPick, if rosterErr or playerErr is non-nil AND summaryErr is nil, call
   RevertAdditionToDraftSummary(draftId, *pickInfo) before returning (only when the slot
   holds exactly this pick, so a legit concurrent winner is not clobbered).
2. Better: make UpdateDraftSummary a Firestore transaction so the second writer sees the
   slot occupied and hits the existing "different pick occupies the slot" conflict path.
3. Optional: per-draft mutex around ProcessNewPick so an autopick and a manual click for
   the same pick number cannot interleave at all.

## Data repair already done (Richard, 8/27 ~3:45pm PT)
- drafts/2026-fast-draft-843/state/summary Summary[102] -> MIN-QB (transaction, verified
  via GET /draft/.../state/summary, no dupes)
- draftTokenMetadata/10536 Image payload + marketplace_index/10536 roster/players/image:
  NE DST pick 103 -> MIN QB pick 103 (bye 6, adp 105); OpenSea refresh 200; OG card verified.
Rosters/playerState/token roster needed no change. Bot's NE-DST at pick 107 is legit, untouched.
