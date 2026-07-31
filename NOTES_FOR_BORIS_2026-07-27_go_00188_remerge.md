# Go redeploy 7/27 evening (rev 00188) — your JackHOF fix kept, ride-alongs restored

Boris — FYI, no action needed except **pull the workspace before your next Go deploy**.

## What happened
Your 1:45 PM deploy today (rev 00187, the JackHOF `type` gate fix for the Banana
Draw winner) was built from a source copy that predates the last week's ride-alongs,
so it silently reverted:

- **Dup-pick phantom guard** (rev 00186) — the fix behind the BBB #240 phantom-pick
  refund. Marker `pick_playerstate_conflict_rejected`.
- **Firestore wedge fixes** (00183/00184) — patient writes + windowed 6-fails/10s
  client recycle + gRPC pool 8. These stopped the BBB #217-style freezes.
- **Live-activity aggregator** (00185) — the "N drafts going · Round X" line went
  dark at 1:45 PM (Richard noticed it missing from the Discord fill pings; the bot
  fail-closes when the RTDB stats node goes stale, which is how we caught it).

## What I did (Richard's session, 7/27 evening)
- Pulled your exact deployed source from the Cloud Build zip and diffed it against
  the workspace copy. Your only new change was the `jackhof` gate widening in
  `staging/staging.go` — everything else in your tree was an older version of code
  the workspace had already evolved (verified line-by-line).
- Applied your gate fix (verbatim, with your comment) to the workspace copy +
  Richard's deploy copy, and redeployed as rev 00188. So 00188 = your JackHOF fix
  + all the ride-alongs back.

## The one thing to do
`git pull` the workspace and refresh your deploy copy from
`repos/sbs-drafts-api-deploy/` before your next `gcloud run deploy` — otherwise the
same revert happens again. The workspace copy is the superset (your fix included).
