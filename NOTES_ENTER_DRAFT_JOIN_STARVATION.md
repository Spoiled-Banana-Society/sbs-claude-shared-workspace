# Bug: "Enter Draft takes the pass but never puts you in a lobby" (transient)

**For Richard + his Claude.** Written by Boris's Claude, 2026-07-05. Status: **diagnosed, NOT fixed — logging shipped to confirm the cause before touching the flow.** Boris's constraint: the eventual fix must **not change the working enter flow, must be clean, must not make things worse.**

---

## TL;DR
A user (Vertig0, wallet `0x696012486d4629baa75e0f44a481f127f6705e1e`) pressed **Enter Draft**. His pass counter dipped and a **"Draft entered"** row appeared in admin Live Activity — but he was **never placed in a lobby**. On a later retry it worked. **No pass was actually lost** (self-healed). This is **transient and self-recovering**, not a broken happy path. Root cause is a **strong but unproven theory** (see below) — please confirm via the new breadcrumbs before changing behavior.

## Symptom
- Feed shows `draft_entered`; pass counter momentarily 9→8.
- User is in **0** RTDB `drafts/{id}.CurrentUsers` and **0** Go active drafts (`/owner/{w}/draftToken/all`).
- No `draft_left` event; balance back to 9 (self-healed, **not** an explicit refund).
- Retry later → works.

## What's CONFIRMED (evidence)
1. **Go access logs** (`sbs-drafts-api-staging`, project `sbs-staging-env`), ~2026-07-05 20:07–20:10Z, filtered by his wallet: **dozens of `GET /owner/{w}/draftToken/all`** in ~10s, and **ZERO `POST /league/{speed}/owner/{w}`** (the join). `joinDraft` posts to `/league/{speed}/owner/{wallet}` (wallet in the URL → the filter would have caught it). **→ The join POST never left his client.**
2. The **"Draft entered" event is written by `/api/owner/use-pass`** (Next.js/Vercel) inside the pass-decrement transaction — *before and independent of* the Go join. So a failed join still logs "entered" (**phantom** feed row). `repos/banana-fantasy/app/api/owner/use-pass/route.ts` ~line 65 (`buildActivityEventDoc({ type: 'draft_entered' })` in the decrement tx; **no leagueId** — the client's use-pass call doesn't send one).
3. Pass returned with **no `draft_left` event** → self-healed via `recountFromInventory` (the real `validDraftTokens` token was never consumed, since Go never got the join) — **not** the explicit refund path.
4. The refund + "pass was not used, try again" block in `hooks/useEnterDraft.ts` (~line 158) **did not run** → the handler was abandoned mid-join (consistent with `joinDraft`'s 20s `AbortController` × 3 retries = up to 60s of "Joining lobby…", user gives up).

## Key files (all in `repos/banana-fantasy/`)
- `hooks/useEnterDraft.ts` — the enter flow: optimistic decrement → `POST /api/owner/use-pass` (spend, Vercel) → `joinDraft()` loop (3 retries) → navigate; refund block on failure (~line 158).
- `lib/api/leagues.ts` — `joinDraft()` → Go `POST /league/{speed}/owner/{wallet}`, 20s `AbortController`.
- `app/api/owner/use-pass/route.ts` — spends the pass **and** writes `draft_entered` (~line 65), decoupled from the actual join.
- `hooks/useStreamRefetch.ts` — 300ms-coalesced refetch nudge on every user RTDB event.
- Redundant `draftToken/all` fetchers (**each fetches independently, no shared cache**): `hooks/useLeagues.ts`, `hooks/useHistory.ts`, `hooks/useDraftingPageState.ts`, `hooks/useAuth.tsx` (balance).

## Root cause — THEORY (strong, but NOT proven — do not claim fixed)
Right before the failure he fired **10 wheel spins in ~60s**. Every user event nudges the **multiple independent `draftToken/all` refetchers** above (plus their 5s polls) → a sustained **flood of GETs to the Go API host**. Browsers cap **~6 concurrent connections per host**, so the `joinDraft` POST got **starved/queued behind the reads and timed out** (never left the browser). The pass-spend goes to **Vercel** (different host), so it wasn't starved — exactly why the pass dipped but the join never fired.

`useStreamRefetch` is already 300ms-coalesced, so the flood is from **many independent refetchers + polls**, not per-event firing.

**Why it's unproven:** transient + self-recovered; not reproducible on demand, and no client trace existed at the time. Mechanism is sound (browser connection limits are real) but can't 100%-confirm it starved *this* join without capturing it live.

## What Boris's Claude shipped (LOGS ONLY — no flow change)
Diagnostic breadcrumbs in `hooks/useEnterDraft.ts` via `reportClientEvent(..., { skipThrottle: true })` (posts to Vercel `/api/client-errors` → `v2_error_events`; **different host from the Go join, so it can't worsen the starvation**). Sources:
- `draft.enter.spent` — pass spent, join starting.
- `draft.enter.join_done` — an attempt returned (with `draftId` + `ms`).
- `draft.enter.join_fail` — an attempt failed (with `ms` + error).
- `draft.enter.no_lobby` — all retries failed, refunding (total `ms`).

## How to read the diagnostics next time it happens
Query `v2_error_events` for `source` prefix `draft.enter.*` for the wallet (admin **Logs / Server Errors** tab, or `repos/banana-fantasy/scripts/logs.mjs`):
- Each attempt **~20,000ms** → the POST is **timing out** = starvation **confirmed**.
- Attempts fail **fast (<1s)** → different cause; the error message says what.
- `join_fail` present but **no `no_lobby`** → user abandoned mid-join (handler hung) = the Vertig0 signature.

## Candidate fixes (for you to evaluate — deliberately NOT shipped)
1. **Targeted / lower risk:** pause the background `draftToken/all` refetchers during the ~2s enter-draft action so the join POST gets a clear connection lane.
2. **Broader / real reliability lever:** dedupe the redundant `draftToken/all` fetches (4+ hooks fetch it independently) behind one shared cache/SWR key. Touches several hooks → more regression surface.
3. **Truthful feed (independent, safe):** log `draft_entered` only when the Go join **succeeds** (with the real leagueId), instead of at pass-spend — kills the phantom "entered" rows and gives the feed a clickable draft.

## Related known issues (context)
Same class as: render-loop self-DDoS (CLAUDE.md Rule #0), the "mobile first tap does nothing = re-render storm eating the touch" fix, and the async-draftId-spawns-drafts race. If you already have a shared-cache/SWR layer for owner tokens in mind, that's the cleanest home for fix #2.

— Boris's Claude (2026-07-05)
