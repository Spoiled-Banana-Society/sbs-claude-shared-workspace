# Caleb Audit — Full Review Findings

**Branch reviewed:** `caleb/fix-security-issues` (merged to `sbs-claude-shared-workspace/main` via PR #1)
**Scope:** full frontend + backend + functions changeset (~130 files, +2,792 / −3,329)
**Status:** ⛔ **Not deployable as-is.** Frontend is good; backend does not compile and was never run.

> This is the complete set of my review notes — every issue + my actual opinions, not just the blockers. The frontend work is genuinely solid; almost everything below is the backend, and most of it traces back to one thing: the backend was never compiled, so a build + real-draft test would have caught nearly all of it.

---

## TL;DR

- ✅ **Frontend** builds clean (TypeScript + ESLint pass, same gates Vercel uses). Looks solid.
- ⛔ **Backend does NOT compile** — duplicate variable in the draft engine. Go builds the server as one unit, so **the entire backend never built → none of the backend changes were ever run or tested.**
- 🐛 **Draft engine: double-advance bug** that would skip turns.
- 🟡 **The atomic-claim (`claimPickSlot`) — we're not planning to take it** even once it's fixed (reasoning in §3).
- 🔗 Backend changes are **interwoven** (can't cherry-pick) and the new **sort feature couples frontend↔backend** (frontend can't ship alone).
- 🕐 Both timing tweaks are wrong: the **"30s" change has no visible effect**, and the **"1s auto" change actually makes auto-pick slower (3s)**.
- 🐛 **Benign-race handler returns 500 instead of 200** → retry storms (comment even says it should be 200).
- ⚙️ Frontend deploy needs **`DRAFTS_API_SERVICE_KEY`** set or 11 core routes 503; **CORS** is now locked to specific domains.

**Bottom line:** fix it so it compiles, **build it + run a real draft** (incl. slow draft, AFK/airplane, and the sort feature), then we take frontend + backend together as a unit.

---

## 1. ⛔ CRITICAL — Backend does not compile

**File:** `models/draft-actions.go`, function `ProcessNewPick`
```
draftInfo redeclared in this block
    line 167: draftInfo, err := ReturnDraftInfoForDraft(draftId)   (your claimPickSlot path)
    line 194: draftInfo  *DraftInfo                                 (existing parallel-advance block)
```
`draftInfo` is declared twice. Go won't compile this. **Verified on your branch directly** (not just the merge); clean `main` without your changes compiles fine.

Because `models` is imported by the whole service, this **one error means the entire backend never built** — so none of the backend work (auth, owner, leagues, URL refactor) has ever run. Please run `go build ./...` before pushing.

---

## 2. 🐛 Draft engine — double-advance + dropped behavior

`claimPickSlot` advances the turn **inside a transaction**, but the **existing manual advance below it was left in place** and advances **again**. Net effect: the draft would move **two picks per pick** — skipping a drafter and corrupting the clock.

`claimPickSlot` also **drops three things** the working advance does:
- **Slow-draft timer** — working code uses `SlowDraftPickEndUnix(...)`; yours does `now + PickLength + 1`, so slow drafts (incl. night-pause) break.
- **`PickStartTime`** — never set in `claimPickSlot`.
- **`draftInfo.Update(draftId)`** — the Firestore draft doc never gets the advance written.

**Fix direction:** one advance path only. If keeping `claimPickSlot`, fold slow-draft timing + `PickStartTime` + `draftInfo.Update` into it and delete the leftover manual advance.

---

## 3. 🟡 The atomic claim (`claimPickSlot`) — good idea, but we're not planning to take it

To be clear and fair: the *concept* is sound — making the pick-claim atomic so a retry/concurrent call can't double-process is a legitimate hardening of the freeze-retry fix. No complaints about the thinking.

**But our position is that we don't need it, even fixed**, because the current engine already covers what it targets:
- **Freezes are already handled** — the deployed fix returns `503` on transient errors so Cloud Tasks retries (the 2026-06-10 frozen-draft fix). The draft doesn't freeze.
- **Double-picks are already blocked** — `ProcessNewPick` validates `CurrentDrafter` / pick# / round; a stale or duplicate pick fails validation and is rejected harmlessly.

So the race the atomic claim closes is a very narrow, exact-same-instant window that's **already handled gracefully** today. Adding transactional logic to the **single most freeze-sensitive function in the app** is real risk for little practical gain — and on that code the rule is "don't change what works unless you must."

**So: even after the compile + double-advance bugs are fixed, we're planning to keep the current proven engine and *not* merge the atomic claim.** If we ever actually observe a double-pick in production (we haven't), we'll revisit it then, with a dedicated test.

---

## 4. 🔗 Backend changes can't be split — they're interwoven

We can't take the "safe" backend parts while keeping the working draft engine:
- `models/players.go` (~line 190) returns **`ErrPickAlreadyProcessed`**, defined in the broken `draft-actions.go` → undefined symbol without it.
- `utils/cloudtasks.go` — you changed **`CreateCloudTask`'s signature** (added `taskID`); the existing engine calls the old 3-arg version in 2 places → breaks them.

So it's all-or-nothing, and "all" doesn't compile.

---

## 5. 🔗 Frontend is coupled to the new backend (sort feature)

New frontend route `app/api/draft/[draftId]/sort/route.ts` calls `/owner/{wallet}/drafts/{draftId}/state/sort` + `/state/sort/{sortBy}` — **new backend endpoints (`GetSortForDraft` / `UpdateSortForDraft`) that don't exist in the current backend.** So the frontend can't ship without the backend; they go out together.

---

## 6. 🕐 The "30-second timer" change is on the wrong field (no visible effect)

You added `+1` to the first pick's **`PickStartTime`**. But the frontend countdown uses **only `PickEndTime`**:
```
// hooks/useTimeRemaining.ts
remaining = PickEndTime - now
display   = Math.floor(remaining / 1000)
```
`PickStartTime` is **never referenced anywhere in the frontend** (confirmed by grep — zero hits). So the change does nothing the user sees — the first pick still shows 29. **To display 30, the `+1` must go on `PickEndTime`.**

---

## 7. 🕐 The "1-second auto-pick" change actually makes it *slower* (3 seconds)

**Current (deployed) — verified in code AND live logs (measured ~3.0s real gap between auto-picks):**
- `now := time.Now()`, airplane-mode `scheduleTime = now + 2` → **2s scheduled** (~3s real with Cloud Tasks dispatch + processing).

**Your change:**
```
now := time.Now().Unix() + 1     // +1 added to now
if sortByObj.AutoDraft {
    scheduleTime = now + 2         // = time.Now() + 3  → 3s scheduled (~4s real)
    // comment still says "2 seconds from now"  ← contradicts the code
}
```
So airplane-mode goes **2s → 3s (slower)**, and the comment doesn't match the code. Looks unintentional — the `+1` on `now` was for the timer-expiry fallback and accidentally pushed the AutoDraft branch up a second. **If the goal is ~1s, set the AutoDraft branch to `now + 1` (not `+2` on an already-`+1`'d `now`).**

---

## 8. 🐛 Benign-race path returns 500 (retry storm) — comment says 200

`autoDraft` handler, non-transient/benign-race branch:
```
// Non-transient (benign race: pick landed concurrently, validation
// mismatch) — retrying would fail identically; keep the no-retry 200.
http.Error(w, err.Error(), http.StatusInternalServerError)   // ← returns 500, which RETRIES
```
The comment correctly says these should be **no-retry 200** (current behavior), but the code returns **500**, which makes Cloud Tasks **retry a pick that will fail identically every time** — wasted retries / log noise / potential storm. Current deployed code correctly returns 200 here.

---

## 9. ⚙️ Frontend deploy-coordination notes (not bugs, but required)

- **`DRAFTS_API_SERVICE_KEY` must be set** or the frontend breaks: `lib/draftsApiServer.ts` throws `503` if it's missing — and **11 core routes use it** (draft pick, league join/leave, owner/mint (buy), queues/create-draft, queue/preferences/sort). This throw is *unconditional* (not gated by the auth flag), so the key must exist in Vercel even though backend auth is dormant. *(Boris has now set it.)*
- **CORS is now locked** to `banana-fantasy-sbs.vercel.app`, `sbsfantasy.com`, `localhost`. Good for prod, but any direct browser→Go call from a Vercel **preview URL** would be blocked. Fine for the real staging domain.

---

## What's good (keep)

- ✅ **Frontend** — URL/env refactor, WebSocket removal, auth scaffolding: all build clean.
- ✅ **New auth middleware** correctly gated behind `DRAFTS_API_AUTH_ENABLED` (dormant by default) — good rollout pattern.
- ✅ The security/URL direction overall is right.
- ✅ Backend currently deployed == git HEAD (no uncommitted hotfix at risk).

## What needs to happen before we deploy

1. **Resolve the draft-engine merge** so `ProcessNewPick` advances exactly once and keeps slow-draft timing + `PickStartTime` + `draftInfo.Update`. (And note §3 — we're likely dropping the atomic claim entirely.)
2. **`go build ./...` must pass** (the whole backend, not one package).
3. **Fix the benign-race return** back to 200 (§8).
4. **Fix the timing** if we want it: `+1` on `PickEndTime` for the 30s display; `now + 1` for the auto branch.
5. **Run a real draft end-to-end on staging** — incl. a **slow draft**, an **AFK/airplane** sequence, and the **sort** feature — before pushing.
6. Then we re-verify (scripted now, fast) and deploy **frontend + backend together**.

*None of this is a knock — the frontend is solid and the direction is right. The backend just needs an actual build + test pass, which would have surfaced §1–§8 immediately.*

---

# Round 2 — follow-up (after your backend fix, PR #2)

**Backend fix verified — good work.** Re-pulled and checked: it now **compiles** (service packages clean), the **double-advance is gone** (atomic claim removed, reverted to the working single-advance engine), **benign-race returns 200** again, the **timer +1 is on `PickEndTime`** (first pick + all picks → shows 30), **auto-draft is a real `now + 1`** (1s), slow-draft/PickStartTime/draftInfo.Update all preserved, and **no live work was reverted** (clean superset of what's deployed). You also fixed the pre-existing `NewSeasonPlayers.go` syntax error. 👍

## One remaining item — a frontend test (from the URL refactor, not the backend fix)

**`__tests__/pruneMissingDrafts.test.ts` fails 2 cases on the branch; passes on live. It's a STALE TEST, not a runtime bug — proven locally.**

- Cause: your URL refactor changed `pruneMissingDrafts` (`lib/draftStore.ts`) from a direct `fetch()` to `createDraftsHttpClient().get()`. The new client (a) `await`s `getAccessToken → getPrivyAccessToken`, and (b) reads `res.headers`. The test's mock only provides `{ ok, status, json, text }` on `global.fetch` and doesn't mock the token — so in the test the new path errors *before* the 404 is detected → nothing prunes → red.
- **Proof it's the test, not the code:** adding a `getPrivyAccessToken` mock + `headers: { get: () => null }` to the fake response → **all 7 tests pass.** So the prune logic (404 → `ApiError` → prune) is correct.

**Asks:**
1. Update `__tests__/pruneMissingDrafts.test.ts` to mock the new client path (auth token + `headers`) so it's green again — don't want red tests going in.
2. Confirm the behavior change is intended: prune now goes through the **authed BFF** (needs a Privy token) instead of the old **unauthenticated direct fetch**. Fine at runtime, but if a token is momentarily unavailable, prune now no-ops that cycle (old code pruned regardless of auth). Intended, or should prune stay auth-independent for resilience?

*Everything else passes: backend `models` tests green, and 211/213 frontend unit tests pass (the 2 failures are only this stale prune test).*
