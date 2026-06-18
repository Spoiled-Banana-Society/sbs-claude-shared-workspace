# Caleb Audit — Review Findings

**Branch reviewed:** `caleb/fix-security-issues` (merged to `sbs-claude-shared-workspace/main` via PR #1)
**Scope:** full frontend + backend + functions changeset (~130 files, +2,792 / −3,329)
**Status:** ⛔ **Not deployable as-is.** Frontend is good; backend does not compile and was never run.

---

## TL;DR

- ✅ **Frontend** builds clean (TypeScript + ESLint pass, same gates Vercel uses). Looks solid.
- ⛔ **Backend does NOT compile** — a duplicate variable in the draft engine. Because Go builds the server as one unit, **one broken file means the entire backend never built, so none of the backend changes were ever run or tested.**
- 🐛 **Draft engine has a double-advance bug** that would skip turns if it ran.
- 🔗 The backend changes are **interwoven** — can't cherry-pick the safe parts.
- 🔗 The new **"sort" feature couples frontend↔backend**, so the frontend can't ship alone either.
- 🕐 Both timing tweaks are **on the wrong field / wrong value** (details below): the "30s" change has no visible effect, and the "1s auto" change actually makes auto-pick *slower* (3s).

**Bottom line:** the whole thing needs to be fixed so it compiles, then **actually built and tested with a real draft**, before any of it deploys. We'd then take frontend + backend together as a unit.

---

## 1. ⛔ CRITICAL — Backend does not compile

**File:** `repos/sbs-drafts-api-deploy/models/draft-actions.go`
**Error:**
```
models/draft-actions.go: draftInfo redeclared in this block
    line 167: draftInfo, err := ReturnDraftInfoForDraft(draftId)   (your claimPickSlot path)
    line 194: draftInfo  *DraftInfo                                 (existing parallel-advance block)
```

`draftInfo` is declared twice in `ProcessNewPick`. Go will not compile this.

**This is on your branch directly** (verified against `caleb/fix-security-issues`, not just the merge). Clean `main` (without your changes) compiles fine — so this is introduced by the branch.

**Why it matters beyond the one file:** Go compiles the whole module together. `models` is imported by the entire service, so this single error means **the entire backend (auth, owner, leagues, URL refactor — everything) never compiled.** That means none of your backend changes have ever actually run. Please run `go build ./...` before pushing.

---

## 2. 🐛 Draft engine — double-advance bug

In `ProcessNewPick`, your new `claimPickSlot` (line ~106) advances the turn **inside a transaction** (increments pick number, sets next drafter, etc.). But the **existing manual advance further down** (Boris's deployed "parallelize pick writes" commit) **was left in place** and advances the turn **again**.

**Result:** the draft would advance **two picks per pick** — skipping a drafter's turn every time and throwing off the clock. (This is also why it wouldn't be caught by reading — it was never run.)

Additionally, `claimPickSlot` **drops three things** the current/working advance does:
- **Slow-draft timer** — current code uses `SlowDraftPickEndUnix(...)` for slow drafts; `claimPickSlot` just does `now + PickLength + 1`, so slow drafts (incl. the night-pause) would break.
- **`PickStartTime`** — not set in `claimPickSlot`.
- **`draftInfo.Update(draftId)`** — the Firestore draft doc never gets the advance written.

**Fix direction:** pick ONE advance path. Keep the atomic `claimPickSlot` (good idea) but fold the slow-draft timing, `PickStartTime`, and `draftInfo.Update` into it, and **remove the leftover manual advance** so the turn only advances once.

---

## 3. 🔗 Backend changes can't be split — they're interwoven

We can't take "just the safe backend parts" while keeping the working draft engine, because:

- `models/players.go` (line ~190) returns **`ErrPickAlreadyProcessed`**, which is **defined in the broken `draft-actions.go`**. Take players.go without it → undefined symbol → won't compile.
- `utils/cloudtasks.go` — you changed **`CreateCloudTask`'s signature** (added a `taskID` param). The existing engine calls the old 3-arg version in 2 places, so taking cloudtasks.go alone breaks those callers.

So the backend is all-or-nothing — and "all" is the version that doesn't compile.

---

## 4. 🔗 Frontend is coupled to the new backend (sort feature)

You added a **new "sort" feature that spans both sides**:
- New frontend route `app/api/draft/[draftId]/sort/route.ts` calls `/owner/{wallet}/drafts/{draftId}/state/sort` and `/state/sort/{sortBy}`.
- Those are **new backend endpoints** (`GetSortForDraft` / `UpdateSortForDraft`) that **don't exist in the current backend**.

So shipping the frontend alone would leave that feature calling endpoints that 404. The frontend and backend have to go out **together**.

---

## 5. 🕐 The "30-second timer" change is on the wrong field (no visible effect)

You added `+1` to the **first pick's `PickStartTime`** (`PickStartTime = DraftStartTime + 1`).

But the frontend countdown is computed **only from `PickEndTime`**:
```
// hooks/useTimeRemaining.ts
remaining = PickEndTime - now
display   = Math.floor(remaining / 1000)
```
`PickStartTime` is **never used anywhere in the frontend display** (confirmed by grep — zero references).

**So your `+1` on `PickStartTime` changes nothing the user sees — the first pick still shows 29.** To actually make it display 30, the `+1` has to go on **`PickEndTime`** (so `floor((PickEndTime − now)/1000)` rounds to 30 instead of 29 after render latency).

---

## 6. 🕐 The "1-second auto-pick" change actually makes it *slower* (3 seconds)

**Current (deployed) behavior — verified in code + live logs:**
- `scheduleAutoDraftTask`: `now := time.Now()`, then airplane-mode `scheduleTime = now + 2` → **2s scheduled**.
- Live logs confirm: *"scheduling auto-draft task for 2 seconds from now."*
- Measured real gap between auto-picks: **~3.0s** (2s scheduled + ~1s Cloud Tasks dispatch + processing).

**Your change:**
```
now := time.Now().Unix() + 1     // you added +1 to now
if sortByObj.AutoDraft {
    scheduleTime = now + 2         // = time.Now() + 3  → 3s scheduled (~4s real)
    // comment still says "2 seconds from now"  ← doesn't match the code
}
```

So airplane-mode auto-pick goes from **2s → 3s scheduled (slower)**, and the comment contradicts the code. This looks unintentional — the `+1` on `now` was for the timer-expiry fallback case, and it inadvertently pushed the airplane-mode branch up by a second.

**If the goal was faster auto-pick (~1s), the fix is `now + 1` for the AutoDraft branch (not `now + 2` on top of an already-+1'd `now`).** Worth confirming with a real AFK draft.

---

## What's good (keep)

- ✅ **Frontend** — URL/env refactor, WebSocket removal, auth scaffolding: all build clean.
- ✅ **The atomic-claim idea** (`claimPickSlot`) is genuinely a good hardening of the freeze-retry fix — the *concept* is right, just needs to be completed + made to compile + not double-advance.
- ✅ **New auth middleware** is correctly gated behind `DRAFTS_API_AUTH_ENABLED` (dormant by default) — good rollout pattern.
- ✅ Backend currently deployed == git HEAD (no uncommitted hotfix at risk).

## What needs to happen before we deploy

1. **Resolve the draft-engine merge** so `ProcessNewPick` advances the turn exactly once, keeps slow-draft timing + `PickStartTime` + `draftInfo.Update`.
2. **`go build ./...`** must pass (the whole backend, not just one package).
3. **Fix the two timing tweaks:** put the `+1` on `PickEndTime` (for the 30s display), and set the auto branch to `now + 1` if you want 1s.
4. **Run a real draft end-to-end on staging** — including a **slow draft**, an **AFK / airplane-mode** sequence, and the new **sort** feature — before pushing.
5. Then we re-verify (it's scripted now, fast) and deploy **frontend + backend together**.

*Nothing here is meant as a knock — the frontend work is solid and the security/URL direction is right. The backend just needs an actual build + test pass, which would have caught all of section 1–6.*
