# Rolling reset windows + JackHOF — full spec for the VRF/Go side (v2, 7/19 late)

**From:** Richard's Claude. **Status:** Richard signed off on all of it; frontend is BUILT and deploying dormant tonight. You own VRF / proof / Go. Richard says you're ready to build now — cutover target is **draft 201** (counter was 196/200 tonight).

**v2 adds:** the exact Firestore/RTDB/NFT contract the deployed frontend now reads, the wheel decision (0.1%), and what's already live on our side. Everything here is what you need for the VRF build.

---

## 1. The mechanic (agreed final)

Two INDEPENDENT lanes replace the fixed per-100 batch from draft 201 onward:

- **Jackpot lane:** 1 slot uniform in the window `[windowStart, windowStart+99]`. On hit at draft X → next window starts at X+1 (reset). Guarantee: a jackpot within 100 drafts of the last, always. First window: 201–300.
- **HOF lane:** 5 distinct slots per window. Window resets after the **5th** hit (next window starts at 5th-hit draft + 1). First window: 201–300.
- **JackHOF:** both lanes landing on the same draft — NO collision handling, the draft is dual-type with BOTH perks. ~1 in ~850 organically. This replaced the earlier "jackpot wins, HOF slides" idea — stacking is simpler math and zero extra cost.

**Economics (Richard explicitly accepted):** JP averages ~1 per 50 (≈2x today's rate — accepted, "not too bad"). HOF ~6 per 100 (+~19%). Combined specials ~8/100 vs 6.

## 2. Firestore tracker contract (AUTHORITATIVE — deployed frontend reads exactly this)

On `drafts/draftTracker`:

- **NEW FIELD: `RollingStartDraft` (number)** — the cutover draft, i.e. `201`. This single field is the master switch:
  - Absent/0 → every deployed surface renders the legacy fixed-batch view, byte-identical to today.
  - Present → rolling UI activates automatically once `FilledLeaguesCount >= RollingStartDraft - 1` (i.e. the moment draft 200 fills). You can write it early; nothing changes until 200 fills.
  - **Abort/rollback = delete the field.** Frontend reverts to legacy everywhere, no deploy needed. This is the whole revert story — if the plan dies, just never write it.
- **`JackpotLeagueIds` / `HofLeagueIds`: unchanged.** Keep appending the global league number of each hit exactly as today. A **JackHOF appends the SAME league number to BOTH arrays** — that's its entire representation here.
- **`RecentFills`: unchanged** ({Id, StartTime}, provisional-then-corrected push, reveal at StartTime−39s). The frontend's reveal gating rides on this: it holds the OLD window on screen until the hit's slot machine lands, then flips + flashes HIT. JackHOF fills need nothing special — the pendingReveal simply flags both jp and hof.
- Window starts are **NOT stored** — the frontend replays the id arrays from `RollingStartDraft` (`lib/rollingLanes.ts`, unit-tested). JP: every id ≥ current start closes the window at id+1. HOF: count ids; every 5th closes at id+1. Ids < RollingStartDraft (old batches) are ignored. If you want Go's `ReturnBatchProgress` to show lane state too, mirror those two replay loops; the frontend doesn't need it.
- **Wheel special drafts stay OUT of the id arrays** (their own lane outside the guarantee) — unchanged from today.

## 3. RTDB + NFT contract

- **`/drafts/{id}/realTimeDraftInfo/type`**: write the string **`jackhof`** for a dual-type draft (frontend also tolerates `jackpot+hof` / `jack-hof`; canonical is `jackhof`). Everything downstream of that node is already styled: band (red→gold metallic), hero reveal (JACKHOF slam + red/gold rays + "Two perks, one draft"), rain, slot reels (split-color JACKHOF symbol), sounds (jackpot-scale celebration).
- **NFT metadata LEVEL**: canonical string **`JackHOF`**. Frontend maps it everywhere (cards red→gold foil + JACKHOF stamp, teams page, history). Marketplace filters bucket JackHOF under **Jackpot** for now (no dedicated filter yet — flagged as later polish).
- Prize/crediting logic on your side must honor BOTH perks (finals skip + HOF bonuses) for a dual-type league.

## 4. VRF / proof (your build)

- **Not two VRF systems** — same subscription, one randomness request per lane-cycle: JP ~every 50 drafts, HOF ~every 84 (≈3 requests per 100 vs 1 today). Richard confirmed you're doing ONE VRF build covering **wheel + drafts together** — good, see §5.
- Per-lane commit-reveal: commit `seedHash` keyed by **(lane, cycleNumber)** BEFORE the cycle's first draft; reveal the seed when the cycle completes (JP: at the hit; HOF: at the 5th). Next cycle's windowStart is public math (hit+1), so a revealed seed + the id arrays let anyone recompute the landed positions.
- Suggested derivation, mirroring today's batchProof HMAC exactly: `pos = windowStart + uint64(first 8 bytes of HMAC-SHA256(cycleSeed, tag)) % 100`, tags `"jp:<cycle>:0"` and `"hof:<cycle>:<i>"` (i=0..4) with today's +1 collision walk WITHIN the HOF five. Cross-lane collision allowed (= JackHOF), so no cross-lane rule exists at all.
- **⚠️ Before you finalize: send the byte-exact spec (tags, encoding, walk) to the shared workspace.** We rewrite the client verifier (`lib/batchProof.ts`) to mirror it byte-for-byte — that file + the /proof and /verify surfaces still speak fixed-batch today, so post-201 drafts will show "proof pending / predates proof system" states (verified: graceful, no crash, no wrong claims) until this rework lands. Ship window for the new verifier: after your spec, before or shortly after cutover.
- Both lanes' first cycles (windows 201–300) must be COMMITTED before draft 200 fills. If you slip: don't write `RollingStartDraft`; batch 3 runs old-style and we re-target 301 — the frontend doesn't care which.

## 5. Wheel (the 0.1%)

- **New wheel segment: JackHOF draft pass. Odds = 0.1% flat** (Richard's decision — true organic collision rate is ~0.118% ≈ 1-in-850; 0.1% is the cleaner display number). Prize = seat in a special dual-type draft (both perks) — same Go dual-type support as the organic one, same lane-exclusion as today's wheel JP/HOF passes.
- Wheel odds changes need the VRF period restart — bundle the segment into this same VRF build so there's one restart. Once you confirm the segment/slot layout, we do the `wheelConfig.ts` + wheel art on our side. (Remember the wheel team-link cron from the 7/19 note is already live for wheel special drafts — JackHOF seats will ride it.)

## 6. Already deployed on our side (dormant until `RollingStartDraft`)

- SSE `batchProgress` stream now emits per-lane `lanes` payload (with pre-reveal snapshots for spoiler-proof gating) when rolling is active; legacy fields keep being emitted unchanged.
- Header: dual equal counters (JACKPOT red / HOF gold with 5 hit-dots), each `position/100` + live % + heat pulse, global `DRAFT #N` chip, rolling tooltip incl. JackHOF explainer. Legacy header renders until activation.
- X/Discord bot feed odds go per-lane on activation (same formula/rounding as the header, as today).
- Full JackHOF styling sweep + classification fixes ('jackhof' contains 'hof' — server card tiering, marketplace normalizeLevel, OpenSea LEVEL trait all handle it explicitly now).
- Era-neutral copy shipped ("guaranteed per 100-draft window") so FAQ/reveal text is true in both eras.
- **Pick-10 logic deliberately untouched** (Richard's call): it still reads the legacy aligned-batch fields, so post-201 its "batch specials all hit" trigger becomes approximate (an aligned 100 can contain 0 or 2 JPs). Accepted; a promo rework ("jackpot hit within X drafts") is planned after launch — do NOT "fix" it in Go.

Questions → NOTES-FOR-RICHARD.md as usual.
