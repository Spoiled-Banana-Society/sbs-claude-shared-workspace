# Capture-cron gave-up bug (BBB #162/#195/#77 cards broken) + RyRo report + one Go ask

## RyRo (Discord general, 7/19 evening)
His real in-app account is **`User-0x6346`** / `0x63462739b9efc65683235b17184c4bf206db5744` (the account literally named "RyRo" / `0x85ed38f7…` is an empty second social-login from 7/12 — that's why user search came up empty). His "2 teams I didn't draft" = teams 2217 (BBB #162) and 2218 (BBB #193): activity events show he ENTERED 5 lobbies and never left one — zero `draft_left` events, zero failed leave calls, zero errors. He closed the page thinking that exits the draft; the drafts filled later and autodraft built his teams. Not a seat bug. (Remington's "leaving is a 2-step thing" comment is the UX gap worth discussing.)

## Real bug he surfaced: capture cron burns its budget during LOBBY FILL
`capture-draft-data`'s `isDraftClosed` treated "RTDB `realTimeDraftInfo` node absent" as closed — but a **filling lobby** also has no node (it appears at draft start). Cards exist from join, so a filling draft looked "closed + uncaptured" and burned all 8 capture attempts before the draft began, then `gave_up` forever. Any draft whose lobby outlived ~40 min of sweeps lost its safety net; fast drafts usually got rescued by a participant's browser at close, so the visible casualties were:
- **BBB #162** (fast-156, the stuck draft Richard hand-closed 7/16) — all 10 cards stuck as grey passes, no pick/adp/bye (RyRo's card 2217)
- **BBB #195** (fast-185, closed 7/19 evening, nobody's browser fired)
- **BBB #77** (slow-3 — the only *completed* regular slow draft; closes happen with nobody watching, so **every slow draft** would have hit this at close)

**Healed 7/19 (all via the official `POST /api/marketplace/refresh-draft/{id}` path):** #162, #195, #77 — 30 cards now team-stamped with pick/adp/bye where the durable summary has them. Re-swept all 208 drafts: zero half-finalized closed drafts remain. The 6 in-flight slow drafts (#90 #112 #136 #179 #180 #183) are untouched and healthy; I deleted their burned `cron_capture_sweep` guards so the fixed cron has its full budget at their close.

**Shipped (frontend, live 7/19 ~19:30 PT):**
1. `isDraftClosed`: node absent → ask Go `state/info` — JSON = closed only at all-picks-in; "not initialized" text = filling → not closed; fetch failure = evicted/old → closed.
2. Premature-fire refund: if `refresh-draft` returns `eligible=0 && imagesWritten=0`, the attempt is not counted (response now includes `eligible`).
3. `contractSupply`: Firestore-persisted monotonic floor (`v2_config/contract_supply`) — a cold instance can no longer serve a stale-low supply cap. That stale cap (an instance stuck at ~808 while the chain was at 2601) is what made marketplace **Team # search** return nothing for newer teams tonight — that's what you were hitting when 2217/2218 wouldn't come up. It self-heals in ≤5 min per instance; the floor kills it permanently.

## Go ask (adds to the wheel-link note from earlier today)
The slow-draft durable summary (`drafts/{id}/state/summary`) is pre-created at start with `PlayerInfo.PlayerId` empty until each pick lands — fine — but please confirm the Go close routine back-fills every row; BBB #77's captured cards only had 13 of 15 picks in the summary, so 2 picks per team render without pick numbers. Low priority.
