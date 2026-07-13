# Special Drafts (wheel-won Jackpot/HOF) — full state of play, 2026-06-12

Written by Boris's Claude for Richard's Claude. Everything below happened in one
overnight session (June 11 → 12). It covers: what SHIPPED to staging, what we
DISCOVERED in the existing system, what we DESIGNED + PARTIALLY BUILT + then
REVERTED (the "doubles"), the alternative design on the table, and the open
decisions Boris wants figured out.

---

## 1. What a special draft is (the product spec Boris stated)

Two ways into a Jackpot/HOF draft:
- **Path A (normal):** any paid draft fills to 10 → slot-machine reveal →
  1 JP / 5 HOF / 94 Pro per 100 drafts, deterministic, committed on Base.
- **Path B (special):** Banana Wheel spin lands Jackpot or HOF → winner gets a
  free pass NFT and a seat in a SPECIAL draft made entirely of wheel winners.
  - Lobby waits for 10 wheel winners; starts automatically at 10/10.
  - Always a slow draft (8h/pick, paused 10pm–5am PT).
  - **Seats are locked** — no leaving, ever. The only exit is selling the pass.
  - The pass is **the only sellable draft pass on SBS** — sellable on our
    marketplace ONLY while the draft is still filling. At fill it locks to its
    owner. Buyer takes the seat (lobby shows buyer's identity immediately).
  - Special drafts are free drafts → **never earn promos** (no pick-10 spin,
    no daily-drafts count, no jackpot-draw credit). HARD RULE.
  - Notifications (draft start + on-the-clock) work exactly like other drafts.

## 2. SHIPPED to staging tonight (phase 1) — live and verified

Frontend repo `banana-fantasy` / `sbs-frontend-v2`, commit `58587745` (shipped
via ship.sh, Vercel verified live). Go API `sbs-drafts-api` staging branch,
commit `9b7d235`, deployed as Cloud Run revision
**sbs-drafts-api-staging-00146-xsd** (verified 100% traffic).

### 2a. Real-user fill (replaced the 1-user + 9-bots flow)
The OLD flow: queue rounds filled in Firestore (`v2_queues`), and
`/api/queues/create-draft` created a Go league for ONE user + 9 bots via
`/staging/fill-bots`. If 10 real winners ever filled a round, only the clicker
got seated. That is gone.

NEW flow:
- Wheel win → `joinQueueWithToken` (Firestore round, max 10, idempotent per
  tokenId) → `ensureSpecialDraftSeat()` (NEW: `banana-fantasy/lib/specialDraft.ts`):
  - First winner of a round CREATES the Go league via
    `POST /staging/create-special-draft` (creation claim is transactional —
    `claimSpecialDraftCreation` in `lib/db-firestore.ts` prevents two
    simultaneous winners creating two leagues; 60s stale-claim takeover).
  - Every later winner JOINS the same league via
    `POST /staging/join-special-draft`.
  - 10th join → Go fires `CreateLeagueDraftStateUponFilling` (same as any
    draft) → draft starts → normal draft-start notification pipeline.
  - The frontend then flips the Firestore round status to 'drafting'
    (`markQueueRoundDrafting`) which CLOSES the sell window, and best-effort
    cancels cached listings (`recordCancelled`).
- Go `JoinSpecialDraft` (staging/staging.go) now:
  - ALWAYS mints a fresh special token (never consumes the wallet's own pool —
    a winner's paid passes are untouched; the wheel NFT is the entry).
  - Mints with **PassType 'free'** — this is load-bearing: the frontend promo
    gate `promoCreditAllowed` (lib/db-firestore.ts) reads this stamp, so
    special drafts can never earn promos. Same change in `CreateSpecialDraft`.
  - Seats the wallet inside a **Firestore transaction** (concurrent joiners
    can't lose each other's seats); cleans up the pre-minted token if the join
    loses or is idempotent-skipped.
- `/api/queues/create-draft` (frontend) is now a bot-free SELF-HEAL: it runs
  the same ensure path (used for rounds that predate league-at-win or whose
  create crashed). It seats ALL current round members, resolving token-bound
  seats to their CURRENT on-chain owner. Membership-guarded: only wallets that
  hold a seat in the round can be joined (anti-hijack).

### 2b. Marketplace sale of a filling pass (seat handoff)
- NEW Go endpoint `POST /staging/swap-special-draft-member`
  {draftId, fromWallet, toWallet}: transactional in-place seat replacement.
  Buyer gets a fresh 'free' token in the SAME league; the seller's special
  token is **destroyed everywhere** (draftTokens, used/validDraftTokens,
  drafts/{id}/cards) — a sold pass must never reappear in the seller's pool.
  Rejects 409 once NumPlayers == 10. NumPlayers unchanged by a swap, so a swap
  can never race the fill threshold.
- `/api/queues/reassign-pass` (frontend) reordered: on-chain `ownerOf` check →
  find the still-filling round → **Go swap FIRST** (authoritative) → Firestore
  queue member rewrite second (display bookkeeping; the GET /api/queues
  on-chain-owner overlay self-heals display regardless). Returns 409 if the
  round is full.

### 2c. Lock-at-fill (Boris's explicit requirement: never sold once filled)
State-based, no clocks — four layers:
1. Listing eligibility: `getFillingWheelPassLevels` — round must be status
   'filling' AND members < 10.
2. Browse: `/api/marketplace/wheel-passes` only emits filling, non-full rounds.
3. **Purchase guard** in `/api/marketplace/fulfill`: extracts the offered
   token id FROM THE SEAPORT ORDER ITSELF (not client input — see
   `extractOfferIdentifier`), checks the queue round; if not filling / full →
   409 "This draft already filled" + best-effort delist. NOTE: an off-platform
   buyer fulfilling the Seaport order directly on OpenSea can't be blocked —
   they get the NFT but NOT the seat (the Go swap 409s) — accepted risk.
4. Go swap endpoint 409 at 10/10 (final backstop).

### 2d. No-exit (server-enforced)
`models/leagues.go RemoveUserFromDraftWithRTBUpdate`: any league whose Level is
"Jackpot"/"Hall of Fame" BEFORE fill (only special drafts have a pre-fill
level) rejects leave: "seats in a special X draft are locked — sell the pass on
the marketplace instead". Normal drafts unaffected (they only get a Level at
10/10, where leave was already blocked).

### 2e. Marketplace live counts + UI
- Wheel-pass cards/watchlist/buy-modal show "JACKPOT · In Lobby X/10".
  Currently a **5s poll** of /api/marketplace/wheel-passes (lobbyCount field).
  ⚠️ Boris wants TRUE realtime — see §6 TODO (RTDB subscribe; Go already
  writes numPlayers to RTDB `drafts/{draftId}` on every join/swap).
- Buy modal explains the pass (seat, auto-start at 10, 8h picks, locks at fill).
- Win modal (BananaWheel.tsx): "Congrats on winning a Jackpot Draft!" + LIVE
  count ("It starts as soon as 8 more Jackpot spin winners join (2/10)") +
  perk line + "Slow Draft: 8 hours per pick" + locked-seat/sellable line +
  **Join the Lobby** button (deep links to the draft room) + "Manage Draft
  Alerts →" link to `/profile?tab=notifications`. Count comes from the wheel
  page polling /api/queues after a JP/HOF win (`specialWin` effect in
  app/banana-wheel/page.tsx).
- Bell noti fires from that same poll WITH the live remaining count; 20s
  fallback (generic copy) guarantees it always rings; dedupeKey = spin id.
  NO raw emoji in notis (Boris rule — clean line icons via TYPE_ICON_KEY).
- Copy added: drafting page INFO_TOPICS (jackpot + hof tabs: two-ways-in,
  what-happens-on-wheel-win, locked-seat/sell rules, **no-promos rule**), FAQ
  (lib/faqContent.ts: 5 new entries + no-promos), wheel "What Are These?"
  panel. NO new pages.
- e2e/render-loop-guard.spec.ts: marketplace + banana-wheel added to the
  guarded pages (both new polls are interval-driven, Rule #0 compliant). All
  12 pass.

## 3. DISCOVERED tonight (important, pre-existing — not introduced by us)

### 3a. Special drafts collide with the batch reveal (THE big one)
`CreateLeagueDraftStateUponFilling` (models/draft-state.go ~line 549+) runs for
EVERY filled draft, including special ones. It:
- increments the global `FilledLeaguesCount` → special drafts CONSUME a slot
  in the per-100 batch;
- renames the league to "BBB #N" (a special draft loses its "Jackpot Draft #N"
  name at fill);
- assigns Level from the batch: if the special draft's global number matches
  the batch's HOF slot, its Level is **overwritten** "Jackpot" → "Hall of
  Fame" (the guaranteed wheel prize silently destroyed). If it matches
  nothing, Level survives only because the code never writes "Pro" explicitly.
- Fairness wrinkle: a FREE wheel draft can eat the batch's single guaranteed
  Jackpot — some paid drafter in that batch then has zero shot at the 1-in-100.

### 3b. Promo pipeline mechanics (now used as the special-draft promo block)
`promoCreditAllowed(userId, draftId, clientPassType, tag)` resolves the REAL
pass stamp by reading the Go token (`resolveDraftPassType` → token.passType
for the league). stamped 'free' → denied. Special tokens are now minted 'free'
(see 2a), so pick-10 / daily-drafts / jackpot-draw are all denied for special
drafts with zero extra logic.

### 3c. Misc
- `GET /api/queues` overlays each token-bound queue member with the CURRENT
  on-chain owner (30s-cached ownerOf) — buyer sees the filling draft with no
  client reassign needed.
- v2_queues rounds: members max 10; `joinQueue` (legacy, entries-counter) vs
  `joinQueueWithToken` (NFT path, flag `isWheelJpHofPassEnabled`). Both now
  return joined round ids and both wire into ensureSpecialDraftSeat.
- Old Go endpoints create-special-draft / join-special-draft existed already
  ("called by Firestore trigger" comments) but NO trigger exists in functions —
  they were dormant until tonight's wiring.

## 4. The "doubles" (4 new types) — designed, partially built, REVERTED

Boris's idea (from the §3a discovery): let special drafts keep the slot
machine; if the reveal lands JP/HOF ON TOP of the entry type → 4 new types:
- **JackJack** (JP entry × JP reveal): 1st AND 2nd make the Finals
- **HOFHOF**: 1st AND 2nd go to HOF playoffs
- **JackHOF** (JP entry × HOF reveal): 1st gets Finals AND HOF playoffs
- **HOFJack**: same perk as JackHOF
Plus: 4 colors (deep double-red, rich double-gold, red→gold split in entry
order), 4 badges, 4 team-art variants, OpenSea Level traits, realtime reveal
alerts.

What got built before Boris pulled it: Go-side only — League.EntryLevel +
RevealedLevel fields, CombineLevels(), fill logic that stacks instead of
overwrites, MakeLeagueJackpot/HOF unified into StampLeagueLevel(level).
**All of it was REVERTED** (git checkout to `9b7d235`) — never committed,
never deployed. Frontend never got any doubles code.

Why Boris killed it (and Boris's Claude agreed, belatedly): 4 permanent new
concepts (names/colors/badges/art/playoff rules/copy) for an event that's
1–5% of an already-rare draft ≈ complexity tax users pay forever for a thing
almost nobody sees. Plus §3a's fairness wrinkle stays (free drafts eating the
paid batch's guaranteed slots).

Visual mockups still on Boris's disk if ever wanted:
`~/sbs-flow-reviews/double-type-colors.html` (glow) and
`double-type-colors-v2.html` (no glow, in-context vs current).

## 5. The alternative design (proposed, NOT decided, NOT built)

**Take special drafts OUT of the 100-draft cycle entirely. No slot machine,
no second draw.** Rationale: the randomness already happened ON THE WHEEL and
is already provably fair (every spin has a Chainlink-VRF proof + verified
badge). A second draw is either fake (rigged slot machine that always lands
the entry type — trust-damaging the moment someone asks for ITS proof) or it
recreates the doubles problem.

Concretely:
1. Special drafts keep their creation name "Jackpot Draft #K" / "HOF Draft #K"
   (they already get it — just DON'T rename to BBB #N at fill) with their own
   series counter (add `SpecialDraftCount` per type to the tracker).
2. Skip the batch increment + level assignment at fill for special drafts
   (gate: pre-fill Level is Jackpot/HOF — only specials have that).
3. At 10/10, instead of the slot machine: a celebration "stamp" moment —
   "Guaranteed Jackpot Draft — won on the wheel". Celebration ≠ randomization,
   nothing to prove or fake.
4. Dashboards/numbering analysis (verified in code): nothing FUNCTIONAL keys
   off "BBB #N" — leagueId does all real work. Every frontend spot that parses
   "BBB #N" → leagueNumber has a null fallback (cards show the name instead).
   Proof pages: specials correctly have no batch proof; their fairness link is
   the wheel spin's VRF. Only real follow-up: admin stats that read
   FilledLeaguesCount as "total drafts" should display "cycle drafts" +
   "special drafts: K" so the books visibly add up.
5. Paid users strictly benefit: cycle's 1 JP + 5 HOF per 100 can no longer be
   consumed by free wheel drafts.
6. If the doubles hype is wanted later, do it ON THE WHEEL (a rarer "DOUBLE
   JACKPOT" segment, VRF-proven like every spin) — rarity where the provable
   randomness already lives.

Boris's last word: revert the doubles, keep phase 1, leave the direction for
Richard to think through. **Nothing in §5 is built.**

## 6. Open items / TODO (whoever picks this up)

1. **DECISION: §5 vs keep-in-cycle.** Until decided, §3a's collision is LIVE
   behavior: a special draft that fills gets renamed BBB #N and can have its
   level overwritten by the batch reveal (rare, but real). Phase 1 made
   specials much more likely to actually fill, so the window matters more now.
2. **True realtime marketplace counts** (Boris explicitly asked): subscribe to
   RTDB `drafts/{draftId}/numPlayers` (Go writes it on every join/swap) for
   visible wheel passes, replacing/backstopping the 5s poll. Check staging
   RTDB rules whitelist (`.read` per child path — see memory; numPlayers is
   already read by the draft room so likely fine).
3. **Post-fill pass lifecycle on the marketplace** (Boris spec): at fill, the
   pass card should show an animated "Drafting…" state (instead of vanishing
   from browse), unbuyable; when the draft completes and the team generates,
   it flips to the real team in All Teams + the owner's My Teams (SellTab
   already shows "Drafting…" via draftInProgress; team-gen/indexing already
   works since specials are normal Go drafts now — this is buy-side display
   wiring + extending wheel-passes route to emit drafting rounds with a flag).
4. **Test harness** (Boris: "I need to test the entire flow many times"):
   staging tools to simulate wheel winners one-by-one (mint+queue real test
   wallets), watch the lobby fill, sell-while-filling, fill at 10, verify
   lock + notis. If §5 is chosen, no reveal-forcing needed at all (simpler).
5. Full E2E hasn't run yet: real spin → seat → second winner → sale → fill.
   Two pre-existing filling rounds exist on staging (JP round w/ pass #1556 at
   4/10, HOF round w/ pass #1454 at 1/10, owner 0xbd2e…3f11) — useful fixtures.
6. Cosmetic: comment at models/draft-state.go ~line 585 still says
   "MakeLeagueJackpot/HOF" (functions exist again post-revert, so it's
   accurate — ignore).

## 7. Commits / artifacts
- Go staging branch: `9b7d235` (phase 1) — deployed rev
  sbs-drafts-api-staging-00146-xsd, traffic verified.
- Frontend sbs-frontend-v2 main: `58587745` (phase 1), Vercel verified live
  (wheel-passes payload carries lobbyCount).
- Shared workspace mirror synced @ f9cc9f16.
- Mockups: ~/sbs-flow-reviews/jp-hof-special-drafts.html (full flow + copy),
  double-type-colors.html, double-type-colors-v2.html (doubles, parked).
- Key files: lib/specialDraft.ts (NEW), lib/db-firestore.ts (queue txn
  helpers), app/api/queues/{create-draft,reassign-pass}/route.ts,
  app/api/marketplace/{fulfill,wheel-passes}/route.ts,
  app/banana-wheel/page.tsx + components/wheel/BananaWheel.tsx (win modal),
  Go staging/staging.go + models/leagues.go.
