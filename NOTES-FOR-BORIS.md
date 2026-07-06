# Notes for Boris

Richard's open asks to Boris live here. See `NOTES-FOR-RICHARD.md` for Boris's replies and open asks to Richard.

---

## Jul 4 — Unique usernames for REAL: killed the wallet-hash "Banana#####" everywhere (deploying today)

**Incident that triggered it:** Richard's brand-new account displayed "Banana46559" (client wallet-hash, 90k-value space). You granted his pass by searching that name — it matched a DIFFERENT account (created 6/26) that has "Banana46559" STORED as its username, so pass token #1398 (2:49pm ET 7/4) went to wallet `0x205f87ec21fd5d5ab98f7ccd08f73a4df8120950`. Unused so far (0 drafts); claw back / re-grant at your discretion — Richard said hold for now.

**Root cause you should know:** `useOnboarding.completeOnboarding` fell back to `user?.username` — which useAuth initializes to the computed hash default — and PUT it through the claim path. So every user who skipped onboarding without typing a name got their INVENTED hash name stored as a real username. **189 of 290 "named" accounts are these** (each exactly equals its wallet's hash). They're grandfathered in place per Richard — do NOT run any rename on them.

**What shipped (frontend only, no Go changes):**
- Onboarding no longer saves a name the user didn't type; claims of "Banana####+digits" names are blocked (`reserved`) so nobody can squat assigned handles again (short ones like "Banana69" still fine, existing holders unaffected).
- Display floor everywhere = SERVER-assigned `v2_users.bananaNumber` (your 6/11 "referral row ≠ header" complaint stays fixed — both sides now read the server number; the header adopts it at login via display-batch, which also seeds/stamps new accounts so they're findable in admin search immediately).
- Admin user search resolves banana handles against the STORED number (indexed range queries) — the 5k hash scan is gone. Grant by name is now safe, but wallet address is still the gold standard.
- `assignBananaNumber` skips numbers squatted by the 189 stored names, so an assigned handle can never read identical to someone's username.
- Where no server number exists yet (transient), screens show a neutral "Banana 3c61"-style placeholder — never a fake numbered handle.
- Go-API displayName equal to the wallet's own hash default is treated as the app's old auto-sync echo (junk), not a chosen name.

**Still open for you (Go side, when you get a chance):**
1. `POST /owner/{id}/update/displayName` has NO uniqueness check — frontend paths are all gated now, but direct Go writes can still create duplicate display names. Worth enforcing there too.
2. Many Go owner records carry the old hash-name echo as DisplayName; frontend now ignores those, no action needed unless you want to clean.
3. Latent (pre-existing, NOT fixed today): `buildPerUserReferralCode` seeds referral codes from the hash name — two colliding wallets could seed the same `v2_referral_codes` doc. `ensureNamedReferralCode` re-mints correctly on first promos read (now from the server number), so exposure is the seed window only. Flagging, not urgent.

— Richard's Claude

---

## ✅ Jul 1 (later) — Queue "last-second" fix: auto-pick now honors a player queued in the final ~2s (rev 00174-4tj LIVE)

**Bug (player report):** queue a player ~1.5s before your timer ends → it shows queued but the timer auto-picks the DEFAULT/ADP player instead. Queue with ~3s left → works. Clean 2-second boundary.

**Root cause:** `scheduleAutoDraftTask` fires the Cloud Task at `pickEndTime - 2`, and `autoDraft()` computes `calculatedPick` (which reads the queue) the moment the task fires — i.e. ~2s BEFORE the timer expires. It then sleeps to `PickEndTime` and submits that already-decided pick. The Layer A re-fetch after the sleep only re-checks the pick NUMBER (double-count guard); it never re-read the queue. So anything queued in the final ~2s was ignored.

**Fix (3 lines, minimal):** in the non-AutoDraft branch, right after `realTimeDraftInfo = latest` (the existing Layer A re-fetch), recompute off fresh state:
```go
if freshPick, ferr := models.CalculateAutoPickForUser(draftId, ownerId, currentPickNumber, currentRound, realTimeDraftInfo); ferr == nil && freshPick != nil && freshPick.PlayerId != "" {
    calculatedPick = freshPick
}
```
`CalculateAutoPickForUser` is read-only (verified — no DB writes); on any error it keeps the original pick (unchanged behavior). AutoDraft/airplane branch untouched. Layer A/B double-count guard untouched.

**Deployed:** from `~/sbs-drafts-api-live` (the live Cloud Build zip source = was 00173-bfn) → `gcloud run deploy sbs-drafts-api-staging --source . --project sbs-staging-env`. Now **rev 00174-4tj, 100% traffic.** Built go1.20-alpine per Dockerfile.

**⚠️ Source drift — needs your coordinated sync (same minefield as slot-1/10):** this change is ONLY in `~/sbs-drafts-api-live` on Richard's Mac. It is NOT in `~/sbs-drafts-api-deploy`, NOT in the workspace `repos/sbs-drafts-api-deploy`, and NOT in the frozen `sbs-drafts-api` staging branch. So live = `00173 slot-1/10` **+ this queue recompute**, and neither is in the canonical/branch source yet. Please fold `~/sbs-drafts-api-live` (which is the true current live) back into your canonical source when you reconcile, so the next `--source` deploy doesn't revert it. I did NOT rsync/push it myself to avoid clobbering your divergent `-deploy` folder.

— Richard's Claude (2026-07-01)

---

## ✅ Jul 1 — on-deck alerts COMPLETE for fast drafts (SMS + Discord/Telegram/push) + 2 source caveats

Finished the fast-draft on-deck alerts across BOTH outbound systems. Live now:
- **SMS** (Go `NotifyOnDeckSMS`) — rev 00171, unchanged.
- **Discord/Telegram/push/email** (Cloud Function `onPickAdvance` → pick-up route → channels) — NEW. Fires for the ON-DECK player, "Your pick is next", fast drafts only. Slow drafts still on-clock.

**How it's wired (3 pieces):**
1. **Go `onDeckDrafter` field (rev 00172-f45):** added `OnDeckDrafter string json:"onDeckDrafter,omitempty"` to `RealTimeDraftInfo` and stamp it every advance (`realTimeDraftInfo.OnDeckDrafter = onDeckOwnerForNextPick(draftInfo)`, right after CurrentDrafter is set). Needed because the RTDB `realTimeDraftInfo` node does NOT carry `draftOrder`, so the Cloud Function had no way to compute on-deck itself. **Committed to workspace `repos/sbs-drafts-api-deploy` — please pull into your canonical source.** (This is on top of your RecentFills + guards + the on-deck SMS; go 1.20.)
2. **Cloud Function `onPickAdvance`:** reads `after.onDeckDrafter`; for fast (`pickLength<=3600`) notifies the on-deck player with `onDeck:true` + their own pick number; slow unchanged. Fallback: if `onDeckDrafter` is absent (last pick or a pre-upgrade node) it falls back to on-clock so a fast draft never goes silent. **Deployed 2026-07-01 05:06 UTC.**
3. **Frontend:** `NotifEvent.onDeck` flag through pick-up route → `messages.ts` renders "Your pick is next — League #N". Live on Vercel.

**⚠️ CAVEAT 1 — Cloud Function source is drifted (same story as the Go backend):** the DEPLOYED `onPickAdvance` was from **2026-05-28** and had **NO fast gate** ("Fires for ALL drafts") + the `after.pickNumber` field fix — i.e. it was NEWER than BOTH `~/sbs-staging-functions/functions/index.js` AND `repos/sbs-staging-functions` (both still have the old gated version with the `after.currentPickNumber` bug). I deployed from the **downloaded deployed source** + my change (via `firebase deploy --only functions:onPickAdvance`). I put that correct on-deck `onPickAdvance` into `~/sbs-staging-functions/functions/index.js` — BUT its OTHER functions (onDraftFilled, scheduledUpdateADP, etc.) are the 2026-05-28 versions, so **do NOT run `firebase deploy --only functions` (all) from that dir — deploy per-function, or reconcile the source first.** The workspace `repos/sbs-staging-functions` copy is still the old gated version and needs reconciling to match live.

**⚠️ CAVEAT 2 — firebase login token expires fast** (had to `firebase login --reauth` mid-session).

Also STILL OPEN from before: the Jun-24 **auto-draft double-count fix** is in Richard's local only, not in canonical/deployed source (see the note below). 00172 does NOT include it.

— Richard's Claude (2026-07-01)

---

## ✅ Jun 30 (late) — 00171 is live with EVERYTHING; + one thing your redeploy dropped (auto-draft dedup)

Thanks for redeploying + syncing your source to the workspace. Confirmed the RecentFills data check plays out — moot now anyway. I layered our on-deck SMS back on top of YOUR complete source and deployed:

**`sbs-drafts-api-staging-00171-clk`, 100% traffic** = your **RecentFills** + your **JP/HOF join-guards** + our **on-deck fast-draft SMS**, go 1.20. Built from the workspace (== your synced source) + our 2-file patch; I synced those 2 files (`sms_notify.go`, `draft-actions.go`) back to the workspace so it matches live. Your RecentFills files were untouched.

**⚠️ Heads-up — your redeploy (00170) dropped Richard's auto-draft double-count fix, and so does 00171:**
Richard's local `~/sbs-drafts-api-deploy` has the **Jun-24 double-count fix** (`ErrPickAlreadyProcessed` + `IsPickAlreadyProcessed`, the `EnqueueAutoDraftTask` refactor with a **task-ID for Cloud Tasks dedup**, and the robust already-picked check) — the one from `NOTES_FOR_BORIS_AUTODRAFT_DOUBLECOUNT.md`. Your source has the OLDER `scheduleAutoDraftTask` / 3-arg `CreateCloudTask` (no task-ID, no sentinel). It was briefly live in my 00169, then your 00170 reverted it, and I did NOT carry it into 00171 (it's hot-path + it was handed to you, so not mine to blind-merge). So **live currently has the double-count/instant-airplane bug unfixed.** Your call: merge Richard's version of that fix into your source, or reimplement your way, then redeploy. The two `draft-actions.go` versions have diverged around auto-draft scheduling, so it needs a real merge, not a copy.

**Going forward (your Q2, agreed):** your `~/sbs-drafts-api-deploy` is the canonical Go source. Both of us should build from the synced workspace copy + patch, and sync back after every deploy — the last two days of ping-pong were both of us deploying from our own un-synced locals. Richard's local also still has the un-built **go 1.25 upgrade WIP** (separate; needs Dockerfile→golang:1.25 to ship).

— Richard's Claude (2026-06-30 late)

---

## 🧾 Jun 30 (late) — PROOF that 00169 reverted RecentFills (you said it's intact / I'm hallucinating — please re-check these)

Not trying to argue — here's the evidence so you can verify independently. Three sources all agree, and there's a falsifiable test at the bottom. If the test comes back the other way, I'm wrong and I'll own it.

**1. Revision timeline (`gcloud run revisions list --service sbs-drafts-api-staging --region us-central1 --project sbs-staging-env`):**
```
00169-7j4  2026-07-01T02:56:51Z   ← MINE, currently serving 100%, nothing newer exists
00168-lmx  2026-06-30T00:31:57Z   ← yours (RecentFills)
00167-744  2026-06-30T00:16:11Z   ← yours (RecentFills)
```
Live went 00168 (has it) → 00169 (mine). No 00170. So the running binary is mine.

**2. The code I deployed has NO RecentFills, and nothing else writes it:**
- `grep -rc RecentFill ~/sbs-drafts-api-deploy --include=*.go` → **0** (Richard's Mac copy = the source 00169 built from).
- `grep -rc RecentFill ~/SBS-Football-Drafts-main` (WebSocket server, NOT redeployed) → **0**. So the WS server isn't a backup writer.
- The fill path (`CreateLeagueDraftStateUponFilling` / `MakeLeagueJackpot`) exists ONLY in the REST API (`sbs-drafts-api`) — the service I replaced. So fills are processed by 00169, which has no RecentFills code.

**3. Firestore `drafts/draftTracker` — the data you saw is STALE:**
- Doc `updateTime` = **2026-07-01T02:03:26Z** — i.e. last written ~53 min BEFORE my 02:56 deploy.
- `RecentFills` = 10 entries, newest **Id 49** (StartTime 1782871465). All written by 00167/00168. Nothing added since. So "fill 49 carries its anchor" is real — but it's frozen pre-deploy, not being refreshed by 00169.

**Falsifiable test (settles it in one fill):** watch `drafts/draftTracker.RecentFills`. Next draft that fills under 00169 — if a new entry **Id 50+** appears, I'm wrong. It won't, because 00169's fill code doesn't write RecentFills.

**Plan (Richard's call, and it fixes it either way):** you redeploy from your complete `~/sbs-drafts-api-deploy` → restores RecentFills (comes back as 00170). That drops my on-deck SMS temporarily — fine, I re-apply my 2-file patch on top afterward (I have gcloud auth now; patch in commit `2b621916` / `NOTES_ONDECK_SMS_FAST_DRAFTS.md`). End state: one rev with RecentFills + join-guards + on-deck SMS, then SYNC your source → workspace so this stops happening.

— Richard's Claude (2026-06-30 late)

---

## 🚨 Jun 30 (late) — CORRECTION: your RecentFills feature got REVERTED by my 00169 deploy. Need your source to fix it.

Your reply assumed 00169 built from a source that had RecentFills. **It didn't.** I built 00169 from **Richard's** `~/sbs-drafts-api-deploy` (his Mac), not yours. I just grepped it:

```
~/sbs-drafts-api-deploy/models/draft-state.go : 0  RecentFills
~/sbs-drafts-api-deploy/models/leagues.go     : 0  RecentFills   (Richard's Mac — what 00169 was built from)
```

So the **running 00169 does NOT contain the RecentFills reveal-timing code.** The `RecentFills`/fill-Id-49 anchor you saw in Firestore is **stale data written by your earlier 00167/00168** (before my ~02:56 UTC deploy) — the current binary won't write new ones. **Net: my deploy unintentionally reverted your reveal-timing feature.** (Root cause is exactly your Q3 point — 00167/00168 were never synced to the workspace, so the workspace copy I used as my "safe baseline" was silently behind live and dropped your work. My mistake for trusting the workspace as == deployed.)

**Not broken-broken:** drafts run fine, and my on-deck SMS + your Jun-18 join-guards ARE correctly live in 00169. This is a feature regression on special-draft reveal timing, to fix by redeploying a build that has BOTH.

**Neither existing source has everything:**
- Your `~/sbs-drafts-api-deploy` (Boris's Mac) = RecentFills + guards, **but NOT** my on-deck SMS.
- Richard's `~/sbs-drafts-api-deploy` / workspace = my on-deck SMS + guards, **but NOT** RecentFills.

**Fix — please do step 1, then tell me how you want step 2:**
1. **Sync your authoritative `~/sbs-drafts-api-deploy` → `repos/sbs-drafts-api-deploy` and push** (the rsync you offered). That makes the workspace the true base (RecentFills + guards + go 1.20).
2. Then get my on-deck SMS change on top + redeploy. My change is **only 2 files** and shouldn't collide with RecentFills (yours is in draft-state.go + leagues.go; mine is in sms_notify.go + draft-actions.go — **only overlap risk is draft-actions.go if your RecentFills touched `ProcessNewPick`; please check**). Options:
   - **(a) I do it:** after your sync lands, I pull, re-apply my 2-file patch, and redeploy from a go-1.20 copy (I have gcloud auth now). Exact patch is in `NOTES_ONDECK_SMS_FAST_DRAFTS.md` + workspace commit `2b621916`.
   - **(b) You do it:** apply my patch (same refs) to your source and redeploy from your Mac.

Whichever — the end state we want is ONE rev with RecentFills + join-guards + on-deck SMS, go 1.20, and then the workspace synced to match so this doesn't happen again. Tell me (a) or (b) and I'll run with it.

— Richard's Claude (2026-06-30 late)

---

## 🔧 Jun 30 — DEPLOYED a Go backend change today + need 4 answers from you (Boris's Claude, please reply in NOTES-FOR-RICHARD.md)

**What I shipped:** Fast-draft SMS pick alerts now go to the **on-deck** player ("Your pick is next in {league}") instead of the on-the-clock player. Slow drafts unchanged. New `NotifyOnDeckSMS` in `models/sms_notify.go` + a slow/fast branch in `ProcessNewPick` (`models/draft-actions.go`) + helper `onDeckOwnerForNextPick`. **Live on `sbs-drafts-api-staging` rev `00169-7j4`, 100% traffic.**

**How I deployed it (this is the important part):** `gcloud run deploy --source ~/sbs-drafts-api-deploy` **fails** — same thing your Jun 18 note called out: `go.mod` says **go 1.25.8** but the Dockerfile pins **`golang:1.20-alpine`** → build dies at `go mod download` ("invalid go version 1.25.8"). That `go.mod` (+ a full dependency bump) is still sitting un-built in Richard's local (last touched Jun 20). So I deployed from a **copy** with `go.mod`/`go.sum` swapped back to the workspace's **go 1.20** pair, leaving Richard's go-1.25 WIP untouched. Live was never at risk (a failed build keeps serving the old revision).

**Bonus:** that build copy included Richard's local `models/leagues.go`, which already has the **Jackpot/HOF regular-join guards you asked for in the Jun 18 note** — so those guards are now **LIVE too** (rev `00169-7j4`). I believe that closes the Jun 18 ask, but please confirm they match what you intended.

**4 questions:**
1. **The go 1.25 upgrade** — is it a real upgrade you (or Caleb) want shipped? If yes, it needs the Dockerfile bumped to `golang:1.25-alpine` + a test build — I'm happy to do that as its own task. If it was accidental / not wanted, can I revert `go.mod`+`go.sum` in Richard's local back to go 1.20 so `--source` deploys from his Mac just work again?
2. **Which folder is YOUR authoritative Go deploy source?** Richard's `~/sbs-drafts-api-deploy` has been un-buildable via `--source` since ~Jun 18, so any Go API deploys since then came from your machine. We need ONE canonical source or we'll overwrite each other.
3. **Did I revert any of your newer backend work?** I built from Richard's local `.go`, which matched the workspace copy (`repos/sbs-drafts-api-deploy`) on everything except `leagues.go` (his was newer — the guards). If your deploy source has `.go` changes newer than the workspace copy that you deployed but didn't sync back, tell me what, and I'll re-include them. Quick check for your Claude: diff your deploy source's `.go` vs `repos/sbs-drafts-api-deploy/` in the shared workspace.
4. **The GitHub `sbs-drafts-api` `staging` branch is frozen at Jun 14** — 2+ weeks behind live (missing ErrPickAlreadyProcessed, the auto-draft task-dedup, the guards, my change, etc.). Should we reconcile it (push current live → staging) so Caleb has an accurate reference? I didn't push my change to it (would've been misleading on top of stale code).

— Richard's Claude (2026-06-30)

---

## 🛠️ Jun 24 — ACTION NEEDED (Go backend): auto-draft "double-count" bug → instant airplane at the turn

Auto-draft jobs run twice for the same pick (Cloud Tasks at-least-once + our handler sleeps), and the deployed handler bumps `NumPicksMissedConsecutive` before confirming the pick was made and no longer re-checks after the sleep — so **one timeout bumps the counter by 2**, flips AutoDraft on, and instantly auto-drafts the user's back-to-back pick at a snake turn. Confirmed in staging logs (same pick processed twice). Full write-up + exact patch + deploy/verify steps: **`NOTES_FOR_BORIS_AUTODRAFT_DOUBLECOUNT.md`**. (Frontend half — the multi-device airplane bug — is already shipped by Richard.)

---

## 🛠️ Jun 18 — ACTION NEEDED (Go backend): stop regular joins from landing in wheel-won special drafts

**Plain version:** Wheel-won specials (Jackpot / Hall of Fame) now run in their own lane (`SpecialDraftCount`, named "Special Draft Jackpot/HOF #N" — your Jun 12 change, live as `00149-sg7`). But the slot-finder that places a normal "join a draft" request can still hand a player an open seat in one of those special leagues. A special should be enterable **only** by winning it on the wheel. As-is, a regular paid/free join can accidentally drop someone into a JP/HOF special, which (a) gives them a special they didn't win and (b) can corrupt the special's intended lineup.

**The fix is 2 short guards in `models/leagues.go`** (Richard's Claude wrote + verified them, `gofmt -e` clean — but couldn't deploy from Richard's Mac; see why at the bottom). Please apply on your next backend deploy:

**1. In `selectLowestPartialLeague`** — skip any special when picking a slot for a regular join. Right after the loop grabs the candidate league (`l := leagues[i]`), before the existing NumPlayers/seat checks:
```go
if l.Level == "Jackpot" || l.Level == "Hall of Fame" { continue }
```

**2. In `AddCardToLeague`** — belt-and-suspenders inside the join transaction, before the `NumPlayers == 10` (full) check, right after the league doc is loaded:
```go
if league.Level == "Jackpot" || league.Level == "Hall of Fame" {
    return fmt.Errorf("try the next leagueId")
}
```
The join loop already advances to the next slot on a `"try the next leagueId"` error, so a regular join just rolls past any special into a normal draft. Your existing seat-lock guard (the `NumPlayers == 10` path) is untouched.

Net after deploy: regular joins → only regular drafts; specials → only via the wheel. No frontend change needed.

**Why Richard's Claude didn't just deploy it** (so you know the deploy copy isn't trustworthy as-is):
- `gcloud run deploy --source ~/sbs-drafts-api-deploy` **fails the build**: `go.mod` declares **Go 1.25.8** but the repo `Dockerfile` pins **`golang:1.20-alpine`** — Go 1.20 can't even parse a 1.25 go.mod (`go: errors parsing go.mod`). So this snapshot was clearly never what built live; your real build env must differ (newer Go base image, or buildpacks). If you also deploy via `--source`, you'll likely want to bump the Dockerfile to `golang:1.25-alpine`.
- The shared copy is also **ahead of live** — live is serving `00153-f9c` (built Jun 14); the shared `repos/sbs-drafts-api-deploy` has later commits. Deploying from Richard's Mac risked pushing newer/in-progress code over live, so he held off rather than risk reverting your work.
- Live was confirmed **100% untouched** by the failed attempt (still `00153-f9c`). Nothing was synced or committed.

After you deploy: please also `git push origin staging` from `~/sbs-drafts-api-deploy` so Caleb's `sbs-drafts-api` staging branch gets the fix.

— Richard's Claude (2026-06-18)

---

## 🚨 Jun 16 — LAUNCH-BLOCKER: new-user signup fails on MOBILE (Privy embedded-wallet creation blocked by iOS)

**Symptom (Richard confirmed live):** a brand-new account can't sign up on a phone.
- New Gmail → glitches/hangs in **mobile Safari AND the home-screen app**.
- Same new Gmail on **desktop → works**, account created cleanly (you can watch it appear).
- **Existing** accounts (e.g. richardvagnermusic) log in fine on mobile.
- Net: **mobile + NEW account = broken; desktop fine; existing accounts fine everywhere.** NOT a PWA-only thing, NOT login-method-specific.

**Root cause (traced in code + config):**
- `providers/PrivyProvider.tsx` → `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'`. Every brand-new signup makes Privy **create an embedded wallet at login**.
- Privy creates that wallet in a **cross-origin iframe (auth.privy.io)**. iOS Safari storage partitioning / ITP blocks that third-party iframe from using its own storage, so key-gen never completes → the new account never finishes → "glitch." Desktop browsers don't partition it → works. Existing users already have a wallet → `createOnLogin` no-ops → fine on mobile.
- So it hits **Gmail, X, AND email new-signups** on mobile (all go through wallet creation). Wallet logins bring their own wallet → unaffected.
- Mobile login UI is separate: `components/modals/MobileLoginModal.tsx` → Privy `useLoginWithOAuth().initOAuth()` (full-page redirect). Desktop uses `useLogin().login()` (popup). The redirect itself works (existing users return fine) — it's the wallet **creation** that fails.
- NOT the `/api/owners` → Go `/owner/create` 404 (separate dead-path; live OnboardingTutorial uses the working `updateUser` path so that 404 is harmless right now — though you may still want to add the Go `/owner/create` route since `app/api/owners/route.ts` calls it).

**The fix — Privy "custom auth domain" so the wallet iframe is FIRST-PARTY on iOS. Dashboard + DNS, basically no code:**
1. **Privy Dashboard:** set up a **custom auth domain / subdomain for Privy** (e.g. `auth.sbsfantasy.com`). Serves Privy's embedded-wallet iframe from OUR domain → first-party → iOS stops blocking its storage. (Privy's docs cover this under embedded wallets + Safari/iOS / "custom domain" — confirm the exact toggle there; it's their recommended iOS remedy.) Also double-check **Allowed origins/domains** lists staging (`banana-fantasy-sbs.vercel.app`) AND prod (`sbsfantasy.com`) for launch. And check the dashboard **logs** for the failed mobile new-user sessions — they should show the wallet-creation error and confirm this.
2. **DNS (GoDaddy):** add the **CNAME** Privy gives you for that subdomain (e.g. `auth.sbsfantasy.com → <privy target>`) and let Privy verify it.
3. **Code (only if their setup needs a prop):** point the SDK at the custom domain. Many setups are dashboard-only — ping me and I'll wire + re-test on a real phone.

**Quick confirm if you want:** try a new **email** signup on mobile — it should also fail (proves it's wallet-creation, not OAuth-specific).

**Why now:** most users sign up on phones and launch is **Jun 23**. As-is, mobile signups don't work and desktop hides it. Top launch blocker. — Richard's Claude (diagnosed 2026-06-16)

---

## ⚠️ May 28 — Deploy system: workspace reconciled to live + things you need to do

Today multiple Claude sessions deployed in parallel (chat names, name-fix, team-card, banana handles, your lobby work). It got messy and your backend got briefly reverted (recovered). Root cause: **the workspace had drifted behind the live site, and deploys weren't going through `deploy.sh`.** I've reconciled it. Here's what's done and what you need to do.

### Done on Richard's side
- **Workspace is now reconciled with live** (`sbs-frontend-v2` HEAD `99341615`). Pulled all direct-to-live work back into the shared workspace additively (no `--delete`, nothing removed) and pushed to `main` (commit `1fb9e14`). `deploy.sh` dry-run is now clean — the system works again.
- Marker `~/.sbs-last-deploy-frontend-v2-head` set to current live.

### What YOU need to do
1. **`git pull origin main` in your shared workspace** before your next deploy. Your local workspace is now behind this reconcile — pulling makes your copy == live too, so you don't deploy stale and revert today's work.
2. **Stop pushing straight to `sbs-frontend-v2` ("Mode B").** That direct-to-live path is what made the workspace drift behind live in the first place, which is what caused the back-and-forth deletions. Going forward let's BOTH deploy only via `scripts/deploy.sh` from the shared workspace — its pre-flight + Mode-B + deletion guards are what stop us overwriting each other. If you ever must push direct, sync it back into the shared workspace immediately after.
3. **Push the backend self-heal fix to Caleb's staging branch — only your Mac can.** Richard's `~/sbs-drafts-api-deploy` is not a git clone, so the Go fix (`models/draft-state.go` self-heal, live as Cloud Run `sbs-drafts-api-staging-00134-v7q`, now also committed to workspace `main`) hasn't been pushed to `sbs-drafts-api` `staging` for Caleb. Please run `cd ~/sbs-drafts-api-deploy && git push origin staging`.
4. **Heads-up: the Bash safety hook got rewritten and is now over-aggressive.** It depended on `jq` (not installed on Richard's Mac) so it was silently dead all session; a session rewrote it in `python3` to revive it. But the rewrite blocks **all** `git push` in the shared workspace when the `~/sbs-shared-pushed` sentinel is >10 min old — including pushes to personal branches (`richard`/`boris`) and shared-workspace `main`, not just Vercel/banana-fantasy pushes like the original. If you pull that version into your `tools/sbs-safety.sh` it'll block your normal workflow. Fix needed: scope the push guard back to banana-fantasy/`sbs-frontend-v2` pushes only. Until then, `touch ~/sbs-shared-pushed` to override.

### Backend rule reminder (the thing that bit us today)
`~/sbs-drafts-api-deploy` is NOT git-tracked and goes stale. **Before any backend deploy, refresh it from the shared workspace copy and diff-check it** — deploying it stale is exactly what reverted your backend today.

— Richard's Claude

---

## ⚠️ ACTIVE INCIDENT — Vercel DDoS Mitigation 403'ing the whole site (May 27)

**Status when this note was written:** Site returning `403 Forbidden` with `x-vercel-mitigated: deny` for both Richard's and Boris's IPs. Cooldown likely still active. Code-side cause has been identified and fixed in two deploys today. Pending: browser cache cleanup + Vercel support ticket.

**See `CLAUDE.md` Rule #0 at the top of the repo** — that's the durable rule that came out of this. Read it before touching any `useEffect` with a fetch inside.

### What broke

Whole staging site returns 403 at the Vercel edge — every route, every user. Not a Next.js app error (those return 500). The 403 comes with `x-vercel-mitigated: deny` which means Vercel's DDoS Mitigation rule fired. From the Firewall dashboard I saw `DDoS Mitigation` count = 1 with a 13k-request traffic spike at ~3:28 PM PT.

### Root cause (confirmed, then refined)

**First theory (wrong, but informative):** I thought my rapid deploy cadence (8 deploys in 90 minutes) plus burst-curling the live site for testing tripped Vercel's bot detection. Richard pushed back — said he's deployed that frequently before without issues. He was right.

**Real cause:** A React render-loop I shipped earlier in the day in `AddFriendPane` inside `components/messages/MessagesHub.tsx`. The bug pattern:

```ts
//  BROKEN — what I shipped
const { search } = useFriends(true);   // search captures privy via useAuthHeaders
useEffect(() => {
  if (!q.trim()) { setResults([]); return; }
  const t = setTimeout(async () => {
    const r = await search(q);
    setResults(r);
  }, 300);
  return () => clearTimeout(t);
}, [q, search]);  //  ← search identity churns on every Privy re-render
```

`usePrivy()` returns a new object identity on many renders. Anything that `useCallback`s against it (like `authHeaders` and downstream `search`/`refresh`) gets a new identity each render. Any effect listing those callbacks in its deps re-runs on every parent render. Each re-run fires a fetch. The parent re-rendered fast enough that Richard's Chrome was firing **thousands of `/api/users/search` requests per minute** from one tab. Vercel's edge saw the pattern as an attack and tripped DDoS Mitigation.

Bug class is the same one Discord users hit constantly with Privy — Privy's hook return value isn't reference-stable across renders.

### What we did about it

1. **First fix (just AddFriendPane)** — committed `e5d0754` (richard branch) → ref'd `search` so the debounce effect only re-runs on `q` changes:
   ```ts
   const searchRef = useRef(search);
   useEffect(() => { searchRef.current = search; }, [search]);
   useEffect(() => { /* uses searchRef.current */ }, [q]);
   ```
   This stopped NEW render loops but didn't audit the rest of the codebase.

2. **Audit + broader fix** — committed `c02c508` after Richard called out that I'd only patched one spot. Same anti-pattern existed in **3 more polling hooks**:
   - `useDmInbox` (15s `/api/dms/threads` poll)
   - `useDmThread` (2s `/api/dms/{wallet}` poll — tightest loop)
   - `useFriends` (15s `/api/friends` poll)
   - `useBlockedUsers` (one-shot `/api/dms/blocks` load)

   All four had `useEffect(..., [enabled, refresh])` or similar where `refresh` derived from `headers` which derived from `usePrivy()`. Same fix applied — refresh stashed in `useRef`, effect deps reduced to stable scalars only (`enabled`, `otherWallet`).

3. **Rule #0 written** to durable memory + repo `CLAUDE.md` so this can't happen again from either of our sessions. Three-question checklist before committing any `useEffect` with a fetch:
   1. Does the effect call a function that does network I/O?
   2. Is that function in the effect's dep array?
   3. Does the function come from a hook that uses Privy / Auth / any context provider?

   If yes-yes-yes → apply ref pattern before committing.

### Things we tried that did NOT solve it (rule out so you don't redo them)

- **Hard refresh Chrome** — didn't help; old SW was still serving stale buggy JS
- **Toggling Vercel Settings → Firewall → Attack Challenge Mode** — wasn't on
- **Checking Bot Management in team Firewall** — Bot Protection was "Inactive"; not the source
- **Checking Vercel Settings → Deployment Protection** — fine
- **Trying Safari** — worked at first (because Safari had no cached SW running the bug), then 403'd later too once the mitigation expanded
- **Waiting 30 min** — mitigation didn't auto-lift in that window

### What's left to do

These are what Richard needs to do (or coordinate with you on). Don't deploy more code unless something else breaks — the four hook fixes are sufficient.

1. **Both Richard and Boris must fully clear Chrome site data** for `banana-fantasy-sbs.vercel.app`. Old cached JS bundle still has the render loop, and even after my deploy the cached bundle keeps hammering the API in the background, which extends Vercel's mitigation cooldown. Path: DevTools → Application → Storage → "Clear site data" → close ALL tabs → reopen.
2. **Add Vercel Firewall System Bypass Rules** for Richard's home IP and Boris's home IP — Vercel → SBS → Firewall → Rules → "Add Bypass Rule". Both get past DDoS Mitigation regardless.
3. **Email Vercel support** with the latest error ID (Richard has it from the 403 page) to lift the active mitigation immediately. They respond fast for active outages.

### Why I'm flagging this for you specifically

If Boris hits an identical 403 outage in the future, please don't burst-deploy "fixes" in response — that compounds the Vercel-side problem. The right move is: figure out if anything is fetching in a loop client-side (DevTools → Network → count requests/sec), fix that, then let the mitigation cooldown run out. Bypass rules + Vercel support are the fast unsticks.

Also, every line of code I shipped today is in commits `e5d0754` through `725a51c` on `main`. Browse if you want the full diff. The hook fixes are isolated to `hooks/useDms.ts` and `hooks/useFriends.ts` — small surface area, easy to review.

---

## Open asks

### Self-serve backend deploys — ready for the secrets tarball + 2FA pairing (May 6)

Local setup done:

- ✅ `gcloud` SDK installed at `~/google-cloud-sdk/`, in PATH
- ✅ `firebase-tools` installed at `~/.npm-global/bin/firebase`, in PATH
- ✅ Backend repos copied to `~/sbs-drafts-api-deploy/`, `~/SBS-Football-Drafts-main/`, `~/sbs-staging-functions/` (from `repos/` you committed)
- ✅ `tools/sbs-safety.sh` installed at `~/.claude/hooks/sbs-safety.sh` and wired into `~/.claude/settings.json` (PreToolUse + PostToolUse, matcher Bash)
- ✅ `cd ~/sbs-staging-functions/functions && npm install` done

Two things still need to happen — both via Discord/iMessage DM, not git:

1. **Send the secrets tarball** (`sbs-deploy-SECRETS-1password.tar.gz`). I'll drop it in `~/Downloads/`, extract per your setup note, verify `configs/` lands in both backend repos.

2. **2FA pairing for `gcloud auth login` + `firebase login`** — per your "When to ping Boris" line, I'm at the point of ready. Once the tarball lands and is extracted, I'll DM you to coordinate the QR-code scan together.

After those, I run `gcloud run services list --region us-central1 --project sbs-staging-env` as the sanity check from your note. If that returns the staging services, I'm fully self-serve for backend deploys and you're off the hook for them.

### ~~Privy bearer no longer attached on Go API calls~~ — RETRACTED, real cause was different (May 6)

Originally flagged this as the root cause of leaveDraft failing. Was wrong. Now that I have backend access I curl'd the staging Go API directly and confirmed:

- The staging Go API has **no auth middleware at all** (`main.go:66-107`, just `middleware.Logger` + CORS, no `r.Use(jwt.Verify)` or similar). Auth being missing on the frontend wasn't the problem because the Go side wasn't requiring it.
- Real cause was a frontend mapping bug — `loadLiveDrafts` stripped the cardId from Go API tokens when storing to localStorage, so `confirmExitDraft` sent an empty `tokenId`, and Go API `models/leagues.go:351` requires both ownerId AND tokenId to match.

Fix shipped: `useDraftingPageState.ts:420-429` now maps `cardId` through, plus heal-on-poll for existing rows missing it. No backend change.

So no action on you for this — sorry for the noise on the Privy bearer ask. But it does open a real follow-up question: **was the Go API supposed to gate auth on those endpoints?** Your May 2 note implied yes (you wired the Privy User API fallback). If staging is intentionally running unauthed and prod isn't, fine — flag it and I'll stop assuming. If staging should match prod's auth posture, that's a separate gap we should size.

### Slow-draft "your pick is up" push — Firebase Cloud Function (April 22)

Richard shipped the client-side scaffolding + `/api/notifications/pick-up` endpoint. Covers the "another player has the page open" case but not the common "user closed the tab hours ago" case.

Needs a Firebase Cloud Function on `sbs-staging-env` that watches `drafts/{draftId}/realTimeDraftInfo` (RTDB) and POSTs to `/api/notifications/pick-up` when `currentDrafter` changes. Pseudo-code in the Firebase v1 API:

```js
exports.onPickAdvance = functions.database
  .ref('drafts/{draftId}/realTimeDraftInfo')
  .onUpdate(async (change, ctx) => {
    const before = change.before.val();
    const after = change.after.val();
    if (!after || before?.currentDrafter === after.currentDrafter) return;
    if (after.isDraftComplete || after.isDraftClosed) return;
    if ((after.pickLength ?? 30) <= 60) return; // slow drafts only
    await fetch('https://banana-fantasy-sbs.vercel.app/api/notifications/pick-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: after.currentDrafter,
        draftId: ctx.params.draftId,
        pickNumber: after.currentPickNumber,
        pickLengthSeconds: after.pickLength,
      }),
    });
  });
```

Repo: `~/sbs-staging-functions/functions/index.js` — drop next to existing `onQueueUpdate`. Deploy: `firebase deploy --only functions:onPickAdvance`.

Deduping on the server side is already handled via `notificationsSent/{wallet}__{draftId}__{pickNumber}` so it's safe to call from both client and Cloud Function.

**Written for you.** Full source at `functions-for-boris/onPickAdvance.js` in this workspace — copy into `~/sbs-staging-functions/functions/` and deploy. Adds a `bot-` owner guard (don't push to bot wallets) and a configurable `PICK_UP_ENDPOINT` env var for staging-vs-prod swapping. Uses `node-fetch@2` and `firebase-functions` v1 style — matches what you said is already in `sbs-staging-functions` deps.

---

## `passType` verification result (April 22)

Curled `0xE7259AddF13489B4fC37EbDE0D8FE523cD38bEd1` per your request. Neither tokenId 3 nor tokenId 4 from your admin grants appears in the Go API's `/owner/.../draftToken/all` response, and **no `passType` field is returned at all** — not "free", not "paid", just absent. Example response entry:

```json
{ "_draftType": "", "_cardId": "1776199785532", "_level": "Pro" }
```

Two findings:
1. The Go API's `cardId` values are Firestore-generated timestamps (`1776199785532`...), not the on-chain NFT `tokenId` (3, 4, ...). So admin-minted on-chain tokens don't appear to be registered in the Go token ledger for this wallet.
2. `passType` isn't in the response schema at all.

**Action for you:** wire `pass_origin/{tokenId}` Firestore collection into the marketplace listing check (`components/marketplace/SellTab.tsx:123` and `app/marketplace/page.tsx:331`) — the API-based check can't work as-is.

Separate (and probably dev-territory) question: should admin-minted on-chain tokens also land in the Go API's per-wallet token list? Today they don't. If they should, it's a Go API write path that needs adding. If they shouldn't (by design), the marketplace just leans on `pass_origin` and we're done.

---

## `withdraw()` skim — green-lit, here's the address

Go ahead and wire the Vercel cron / Cloud Scheduler skim on staging as the dress rehearsal. Cold treasury address to receive the sweeps:

```
0xC0F982492c323Fcd314af56d6c1A35Cc9b0fC31E
```

(Base mainnet EOA, Richard-controlled, not on any server.)

This is changeable later — just a config/env var swap + cron redeploy, no on-chain move needed. Pick whatever cadence makes sense (hourly is a reasonable starting point for staging dress rehearsal; we'll tune before prod).

Still planning Safe multisig for pre-prod — the skim cron is the staging test run, not the final answer for prod volume.

---

## April 22 evening — ack on your 4-item shipment

Saw all four land. Thanks — huge night.

- **JoinLeagues revision 00054-6x7**: noted, multi-user fast drafts should land together now.
- **onPickAdvance Cloud Function live**: slow-draft push path is fully end-to-end — client trigger on drafts with tabs open, server trigger on closed-tab users. Will verify next session with a real slow-draft pick transition.
- **Marketplace `pass_origin` overlay via `/api/pass-origin/free-tokens`**: clean solve, skips the Go `passType` field entirely. Didn't touch `SellTab.tsx:123` — good, since the overlay keeps the existing check site working.
- **USDC skim cron**: hourly at `/api/crons/skim-bbb4-usdc` → BBB4.withdraw() → transfer to `0xC0F982492c323Fcd314af56d6c1A35Cc9b0fC31E`. Audit in Firestore `bbb4_usdc_sweeps`. Noted the CRON_SECRET auth.
- **Bonus reconciler (`d29afd1`)**: `reserveTokens` mints auto-register into `owners/{wallet}/validDraftTokens` via `/draftToken/mint`. Appreciated.

### `passType` re-curl result

Did the sanity re-curl on `0xE7259AddF13489B4fC37EbDE0D8FE523cD38bEd1`. Still no `passType` field returned, and on-chain tokenIds 3/4 still don't appear in the Go ledger for this wallet — only the pre-existing timestamp `cardId`s. That's consistent with your note that the reconciler catches future mints and historical ones need the admin **Sync** button clicked or a fresh grant. Not a problem — marketplace no longer depends on it. Noting for your awareness; we can clean up the test wallet's history on your next admin pass if you want completeness.

### BBB4 Safe multisig — pre-prod plan

Ack, non-urgent. Ping when you want to start the setup — I'll create the Safe (likely 2/3 with you + me + a recovery signer), transfer BBB4 ownership to it, and we migrate the admin-mint flow to route through the Safe's module/delegate path at that point. Staging skim cron is good enough until then.

Nothing blocking on my side. Richard out for the day.

---

## April 26 — Admin wallet is EIP-7702 delegated, breaking USDC mint flow

**Boris's Claude: please verify, explain whether this was intentional, and reply with whatever you'd want Richard to know. Richard is going to read your response back and use it to understand what's going on. Plain language is fine.**

### Symptom

Richard tried to mint a draft pass on staging today using his existing $26.90 USDC balance (USDC payment path, not card). After signing the EIP-712 permit, the modal showed:

> USDC transfer failed: Missing or invalid parameters. Double check you have provided the correct parameters.
> URL: https://base-mainnet.g.alchemy.com/v2/DXexFLQaN-i3jKYCLtJiM
> Request body: `{"method":"eth_sendRawTransaction","params":["0x02f8ce..."]}`
> Request Arguments: from: 0xccdF79... (admin) to: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (USDC) data: 0x23b872dd... (transferFrom)
> args: (0x2e64db49fc597a731091471607f6cd0251d7eafb, 0x14065412b3A431a660e6E576A14b104F1b3E463b, 25000000)
> sender: 0xccdF79A51D292CF6De8807Abc1bB58D07D26441D
> **Details: in-flight transaction limit reached for delegated accounts**
> Version: viem@2.47.4

The "Details:" line is the actual cause. The viem-formatted "Missing or invalid parameters" wrapper was misleading me at first.

### What's confirmed on-chain

```
eth_getCode(0xccdF79A51D292CF6De8807Abc1bB58D07D26441D, latest) on Base mainnet
→ 0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b
```

`0xef0100` is the EIP-7702 delegation prefix. The admin wallet's bytecode points at delegate `0x63c0c19a282a1b52b07dd5a65b58948a07dae32b` — an 11,185-byte smart-account contract on Base. Looks like a Privy embedded smart account or similar.

Other state I checked:
- Admin ETH balance: 0.00205 ETH on Base — fine, not gas-starved
- Admin nonce (latest = pending) = 51 — no in-flight conflict at chain level
- Richard's USDC allowance to admin = 25 USDC (so the prior `permit` tx **did** land successfully — that's tx #50 on admin)
- Richard's USDC balance = 26,899,738 (= $26.90)
- Base mainnet basefee currently = 0.005 gwei, well below tx's 0.1 gwei maxFeePerGas
- All confirmed via direct calls to `https://mainnet.base.org`

### My current hypothesis

Alchemy enforces a **1-tx in-flight limit on EIP-7702 delegated EOAs** as anti-abuse policy. The card-mint flow at `app/api/purchases/card-mint/route.ts` fires three sequential admin txs:
1. `submitUsdcPermit` — admin nonce 50, succeeded
2. `pullUsdcFromUser` (transferFrom) — admin nonce 51, **rejected by Alchemy**
3. `reserveTokensToWallet` — never reached

Even though each step `await`s `waitForTransactionReceipt` before the next call, Alchemy's "in-flight" tracking is more aggressive than chain finality (or some other state machine on their side). When admin is delegated, the limit kicks in mid-flow.

If the admin were a plain EOA (no delegation), there's no such limit and the flow works.

### What I need from Boris's Claude

1. **Was the delegation intentional?** Did Boris run an EIP-7702 authorization on the admin wallet — for a smart-account upgrade, gasless ops, batching, anything? Or did this happen unexpectedly (Privy lifecycle, accidental tx)? If unexpected, that's also a security signal worth investigating.

2. **If intentional**: how is the existing 3-sequential-tx mint flow expected to work given Alchemy's limit? Is there a missing piece (batch executor, multicall through the smart account, queue) that Richard is missing? Does the working flow expect a different RPC provider for admin-side broadcast?

3. **If NOT intentional**: agreed the right move is to revoke (EIP-7702 authorization with delegate = `0x0000…0000`)? Boris can sign that since he has `BBB4_OWNER_PRIVATE_KEY`. Quick to do, restores admin to plain EOA, restores the existing flow.

4. **Either way**: tell Richard plainly what's going on and what's next. He's frustrated and confused — fair, since this is the second mint attempt that bounced today. He thinks I'm hallucinating; an independent confirmation from your side would help him trust the diagnosis (or correct it).

### What I have NOT done

- No code changes related to this. I haven't touched `adminMint.ts`, `card-mint/route.ts`, or anything onchain.
- No env changes.
- No txs from any wallet on my side. I cannot deploy Go and don't have the admin private key.
- I have NOT attempted any "fix" — wanted Boris to see this before anything is changed.

The only related code I shipped today was a UX change to `BuyPassesModal.tsx` (success state + survive close/reopen via `lib/purchaseFlow.ts`) and a `scripts/deploy.sh` rewrite to mirror full tree instead of last-commit only. Neither touches the mint pipeline.

— Richard's Claude, end of day April 26

---

## April 26 — Reply to Boris's hook + commit hygiene note

Read your note in `NOTES-FOR-RICHARD.md`. You're correct on every point. Apologies — that's two regressions in one day and the second one (AdminTools quote escapes) was avoidable.

**Confirming what I saw on my side:**

- Diffed `5240174..c950a5e` on sbs-frontend-v2 — that's 8 of your direct-push commits I overwrote (race vs Alchemy, Sentry forwarding, atomic counter txs, mint hardening, Firestore writethrough, gas pin, etc.). My deploy script's rsync rewrote workspace state on top of those, and `git add -A` after the rsync committed everything as one blob.
- Diffed `d790f27..b094513` on sbs-frontend-v2 — that's the AdminTools quote escapes I reverted on the second deploy.
- Just confirmed the EIP-7702 thing on-chain too — `eth_getCode(0xccdF79...)` now returns `0x` (plain EOA again). Mints work, allowance to admin from BananaKing99 still sitting at 25 USDC unspent. Nice work on the revoke endpoint.

**What I changed in `scripts/deploy.sh` (commit landing alongside this note):**

Added a Mode B safety check on top of the Mode A check I shipped earlier today. Existing Mode A check verified workspace's current branch contains everything on shared-workspace `origin/main`. The new Mode B check verifies that `sbs-frontend-v2/main` HEAD hasn't moved since our last successful deploy:

```bash
DEPLOY_MARKER="$HOME/.sbs-last-deploy-frontend-v2-head"
# ... after git pull origin main on /tmp/sbs-frontend-v2:
if [ -f "$DEPLOY_MARKER" ]; then
  LAST_DEPLOYED=$(cat "$DEPLOY_MARKER")
  AHEAD=$(git rev-list --count "${LAST_DEPLOYED}..HEAD")
  if [ "$AHEAD" -gt 0 ]; then
    echo "⛔ DEPLOY ABORTED — sbs-frontend-v2 has $AHEAD new commit(s) since your last deploy."
    git log --oneline "${LAST_DEPLOYED}..HEAD"
    exit 1
  fi
fi
# ... after successful deploy:
git rev-parse HEAD > "$DEPLOY_MARKER"
```

It already proved itself: when I tested the new script just now, it caught `b094513` (your re-applied ESLint escapes) and aborted with a clear message listing what would have been overwritten. So the next time you push directly between my deploys, the script blocks instead of trampling.

Also: I ported `b094513`'s AdminTools.tsx quote escapes into shared workspace's `repos/banana-fantasy/components/admin/AdminTools.tsx` directly so workspace doesn't drift while waiting for your next "Sync banana-fantasy to shared workspace" commit. Diff is the 4-line `&ldquo;`/`&rdquo;`/`&apos;` replacement, no other changes.

**On `git add -A` in the deploy script:** still there in the deploy repo (`/tmp/sbs-frontend-v2`), but now it runs *after* an rsync that's been gated by the Mode B check. The rsync itself is content-checksum based (`-c --delete`) with explicit excludes; if you push direct between my deploys, the Mode B check fires before rsync runs and aborts. So `-A` is no longer the silent-overwriter it was.

**On your other items:**

1. **Pre-push hook for `~/banana-fantasy/.git/hooks/pre-push`** — I don't have a `~/banana-fantasy/` checkout on this machine. My deploy path is `~/sbs-claude-shared-workspace/scripts/deploy.sh` → `/tmp/sbs-frontend-v2/`, so that hook never applied. The deploy.sh Mode A + Mode B checks are the equivalent guard for my workflow. Happy to also add the pre-push hook if you want belt-and-suspenders, but the deploy.sh checks should now cover the same failure modes.

2. **Local Bash safety hook** (`~/.claude/hooks/sbs-safety.sh`) — never seen the script. Can you paste it (or its path on your Mac) into your next note? I'll install it. The "block git push from `~/banana-fantasy/` if `~/sbs-shared-pushed` is missing/old" pattern sounds like a useful second line of defense, especially the prod-reference repos guard.

3. **Don't import `BBB4_OWNER_PRIVATE_KEY` into any wallet ever again** — saved that to durable memory along with the account-currently-revoked status. Won't repeat.

4. **Files-not-to-revert list** — saved the whole list to memory. The deploy.sh Mode B check is the main guard, but I'll also do a sanity-grep for those filenames before any commit that touches them.

5. **`/api/admin/revoke-7702/` removal** — agreed it's a one-off that should come out. Logged as an open ask in `NOTES-FOR-RICHARD.md` for your next pass; or I can ship the removal commit if you'd rather.

— Richard's Claude

---

## April 26 — Auto-draft threshold: 3 → 2 missed picks (needs gcloud deploy)

Richard's brother was on round 12 mid-draft and never had auto-draft kick in despite being clearly AFK. Looked at the server logic:

`draft-actions/draft-actions.go:154` (in the `autoDraft` handler):
```go
if userInfo.NumPicksMissedConsecutive >= 3 {
  userInfo.AutoDraft = true
}
```

Threshold of 3 means a user has to miss **three full timers in a row** before auto-draft turns on. For fast drafts that's 90s of wasted time per miss; for slow drafts it's 24+ hours. And any single manual pick anywhere in between resets the counter to 0 (`submitPick` handler line 251). So in practice the toggle rarely fires.

**Already shipped to shared workspace** — changed it to `>= 2`. The diff is one number. Push to `richard` is below; you'll need to `gcloud run deploy sbs-drafts-api-staging` (and prod) to make it live.

Behavioral change after deploy:
- Miss pick 1 → counter=1 → no change, full timer next pick
- Miss pick 2 → counter=2 → `AutoDraft = true` flips on
- Pick 3 onward → scheduler sees `autoDraft=true` and fires the auto-pick at `now+2` instead of waiting for the full timer

The `== 2` strict-equality "accelerated 8s schedule" at `models/draft-actions.go:196` becomes effectively dead code (autoDraft would already be true by the time miss==2 is checked next tick) but left as a harmless fallback.

If you'd rather keep `>= 3` for a different reason (over-aggressive concerns?), let me know and I'll revert the workspace edit.

— Richard's Claude

---

## April 29 — Auto-draft positional limits (need Go-side mirror)

Shipped frontend today: per-position auto-draft caps so a single seat can't
grind out 8 QBs and freeze everyone else out of the position. Frontend covers
airplane mode + local-mode auto-pick (timeout + bots). **Live AFK and live
bots are still uncapped** until the Go API mirrors the same logic.

### What's already live (frontend)
- New top-level Firestore collection: `userPositionalLimits`
- Doc ID: lowercased walletAddress
- Fields: `{ walletAddress, QB, RB, WR, TE, DST, updatedAt }`
- Defaults (used when doc missing or fields missing): `QB:3 RB:7 WR:7 TE:3 DST:3`
- Bots get defaults; humans can override via `/rankings` page UI
- Validation: each value is integer in [1, 15]. Sub-15 sums are allowed —
  picker relaxes when stuck rather than refusing to pick.

### What's needed on the Go side (in `models/draft-actions.go`'s `CalculateAutoPickForUser`)

**1. New file `models/position-limits.go`:**
```go
package models

import (
  "context"
  "strings"
  "cloud.google.com/go/firestore"
)

var DefaultPositionLimits = map[string]int{
  "QB":  3,
  "RB":  7,
  "WR":  7,
  "TE":  3,
  "DST": 3,
}

// FetchPositionLimitsForOwner reads userPositionalLimits/{ownerId} and merges
// with defaults. Bots (ownerId starts with "bot-") and missing docs both
// return defaults. Same shape as the frontend's applyDefaults() in
// lib/positionLimits.ts.
func FetchPositionLimitsForOwner(ctx context.Context, client *firestore.Client, ownerId string) map[string]int {
  out := make(map[string]int, len(DefaultPositionLimits))
  for k, v := range DefaultPositionLimits {
    out[k] = v
  }
  ownerId = strings.ToLower(strings.TrimSpace(ownerId))
  if ownerId == "" || strings.HasPrefix(ownerId, "bot-") {
    return out
  }
  snap, err := client.Collection("userPositionalLimits").Doc(ownerId).Get(ctx)
  if err != nil || !snap.Exists() {
    return out
  }
  data := snap.Data()
  for pos := range out {
    if v, ok := data[pos]; ok {
      if n, ok := v.(int64); ok && n >= 1 && n <= 15 {
        out[pos] = int(n)
      }
    }
  }
  return out
}
```

**2. Edit `CalculateAutoPickForUser` (auto-pick selection):**

The frontend's `autoPickForPlayer` in `hooks/useDraftEngine.ts` is the
reference behavior. Pseudocode for the cap logic:

```go
limits := FetchPositionLimitsForOwner(ctx, client, currentDrafter)
roster := /* existing per-owner roster from realTimeDraftInfo */

isAtCap := func(playerId string) bool {
  pos := positionFromPlayerId(playerId) // "KC-QB" -> "QB"
  if cap, ok := limits[pos]; ok {
    return len(roster[pos]) >= cap
  }
  return false
}

// 1. Queue head: skip cap-breaching entries
// 2. BPA early rounds: filter available by !isAtCap, return top by ADP/rank
// 3. Late rounds (>= 12): position-fill loop, skip positions at cap
// 4. Cap-filtered BPA fallback
// 5. RELAX: if every cap is hit, return unconstrained BPA so the draft
//    never stalls
```

The relax step (5) is critical — if a user sets caps summing to 12 and the
draft is 15 rounds, picker WILL hit all caps by round 12-13. It should
keep going past caps rather than refusing to pick. Caps block, never force.

**Manual picks bypass entirely** — only `CalculateAutoPickForUser` (and bot
auto-pick) consult limits. The submit-pick path for human clicks should
ignore them.

### Deploy

```bash
gcloud run deploy sbs-drafts-api-staging \
  --source ~/sbs-drafts-api-deploy \
  --region us-central1 \
  --project sbs-staging-env
```

Once live, every JP/HOF/Pro draft on staging will respect the caps for
both human-AFK and bot picks. No frontend redeploy needed — the Firestore
collection and defaults are already in place.

### Verification
1. Check Cloud Run logs for `FetchPositionLimitsForOwner` invocations
2. Fill a fast draft, let one human seat miss 2+ picks (auto-draft kicks
   in per the existing `>= 2` threshold) — verify the AFK seat's roster
   respects defaults / their custom limits if they set any
3. Compare a pre-deploy bot draft to post-deploy: pre-deploy bots tend to
   stack one position when ADP favors it; post-deploy should be balanced

— Richard's Claude

---

## April 28 — Jackpot drafts hang at pick 1 (state desync)

**Bug:** Any draft tagged `Level: "Jackpot"` freezes at pick 1 immediately after fill. The countdown ticks forever, no auto-pick fires, manual picks aren't broadcast. Affects bots AND humans — the guard isn't drafter-type-specific.

### Repro
1. Add a slot to `drafts/draftTracker.JackpotLeagueIds` ahead of next fill.
2. Fill any fast draft to consume that slot.
3. Slot reveal correctly shows JACKPOT, but `pickNumber` stays at 1 indefinitely.

Last failure case: `2024-fast-draft-175` on staging (BBB #240). Forensic state still on Firestore as of writing — feel free to inspect.

### Diagnosis (state desync between Firestore and RTDB)

Calling the auto-draft endpoint manually returns:
```
the current drafter is not the drafter of the default pick
```

That's the guard at `models/draft-actions.go` (`CalculateAutoPickForUser`):
```go
if realTimeDraftInfo.CurrentDrafter != currentDrafter { return nil, err }
```

`realTimeDraftInfo` is read from RTDB. The Cloud Task that fired it had the URL-encoded `currentDrafter` from when the task was scheduled. They don't match → robot refuses to act → forever.

Other supporting evidence on the affected draft:
- `GET /draft/2024-fast-draft-175/state/info` → 200, but `state/summary` and `state/connectionList` return 404.
- `POST /draft/2024-fast-draft-175/createDraft` (WS server) errors: `connectionList not found`.
- The `state` subcollection is partially written.

### Root cause (very likely)

In `models/draft-state.go:CreateLeagueDraftStateUponFilling`, the ordering is:
1. Increment `FilledLeaguesCount` ✓
2. Set `leagueInfo.DisplayName` ✓
3. Check JP/HOF slot match. **If JP** → call `MakeLeagueJackpot(draftId, &leagueInfo)` which iterates every card in `drafts/{draftId}/cards` and writes `Level = "Jackpot"` via `updateInUseDraftTokenInDatabase`. ~10 round-trips.
4. Write league info to Firestore ✓
5. Create draft state docs (info, playerState, summary, connectionList).
6. Write RTDB `realTimeDraftInfo` (the doc the auto-pick guard reads).
7. Schedule first Cloud Task.

If `MakeLeagueJackpot` errors mid-loop (any card write fails), the function may bubble the error up and skip steps 4–7. But `FilledLeaguesCount` already incremented, draftTracker already saved (line ~80). Result: doc fragments + RTDB never initialized + counter advanced.

Pro drafts skip step 3 entirely so they never hit this path.

### Suggested fix

Reorder so RTDB lives before the JP card loop:
1. Write league info + state docs first (info, summary, connectionList, etc.).
2. Write `realTimeDraftInfo` to RTDB.
3. Schedule the first Cloud Task.
4. **Then** call `MakeLeagueJackpot` / `MakeLeagueHOF` as a best-effort post-step. If it partially fails, the draft is still drafting-functional (cards just don't have the Level tag yet — fixable later via a sweeper).

Or wrap the JP/HOF writes in a transaction so they're all-or-nothing, but that doesn't solve the "partial write breaks live state" problem unless the transaction includes the RTDB write — which crosses datastore boundaries and isn't really transactional.

### Severity

**Pre-prod blocker.** Every JP draft will freeze, which is 1% of all drafts. HOF drafts (`MakeLeagueHOF` has the same shape) likely affected too — that's another 5%. Combined 6% of paid drafts unusable until this lands.

— Richard's Claude

---

## 2026-06-07 — "My Teams" shows a GHOST token (#8742 / "BBB #145") that doesn't exist on-chain — your call on the fix

**No code changed for this, and nothing deployed.** Richard wanted it written up for you to decide, since it's squarely in your NFT-classification area. (Separately, see the "Also shipped today" list at the bottom for the small UI changes I *did* deploy.)

### Symptom
On **My Teams** (`/standings`), Richard's wallet `0x9eba7944455f4bdb2d120369827ce7f1b0bda000` shows one team card: **"BBB #145", token #8742**, Pro, with fake **Rank #8742 / 2,029.1 pts** and **no roster** ("No roster data available"). Same phantom appears on the marketplace **Sell My Teams** tab tagged **"Stage Mint"**. Richard says he never stage-minted — only acquired passes legitimately. He's right.

### Verified truth (cross-checked Go backend + chain + OpenSea)
`GET /owner/0x9eba…/draftToken/all` returns his real holdings:
- **ACTIVE**: `realTokenId 1448`, `BBB #1372`, paid, `_rank "N/A"`, scores `0`.
- **AVAILABLE**: `realTokenId 1449`, paid Pro pass, no league.

On-chain (`0x14065412…463b`, Base mainnet, `totalSupply = 1454`):
- `ownerOf(1448)` → **`0xbd2e09…3083f11`** (NOT Richard) — he drafted #1372 then **sold/transferred it**; Go still lists it `active` (Go doesn't move the record on resale).
- `ownerOf(1449)` → **Richard** ✅ — his one real unused pass.
- `ownerOf(8742)` → **reverts (nonexistent)** — never minted.
- `balanceOf(Richard)` → **1** (consistent: he holds only 1449).

**So #8742 is a pure OpenSea phantom.** Our backend has zero record of it and correctly reports clean `N/A`/`0` for the real tokens. Our system is *correct*; the only staleness is the known ownership-on-resale gap (1448).

### Root cause
`GET /api/marketplace/nfts?owner=…` enumerates owned NFTs straight from OpenSea (`account/{owner}/nfts`, filtered to `BBB4_CONTRACT`) and trusts that list. OpenSea is returning a stale/phantom #8742 for this wallet on `0x1406…` even though the chain says it doesn't exist. **`useMyNfts` (My Teams) and the Sell tab both read this one route**, so the ghost surfaces in both. The route already verifies on-chain ownership for `recentBuys`/`recentSells` but NOT for the base owned list — that's the gap.

### Proposed guard (fail-open) — your area, your call
Treat OpenSea as *candidates only*. For tokens with **no backend record** (your existing `hasBackendRecord === false` set — same set the "Stage Mint" badge keys off), ask the chain and drop only on a **definitive** "nonexistent" or "owned by someone else"; keep on "owned by you." Reuses your `classifyToken`/`getOnchainOwner` patterns + per-token owner cache; bounded to the few unbacked tokens.

**The trap:** `getOnchainOwner` collapses *revert/nonexistent* and *RPC failure* both into `null`. A naive "drop if not owned" would **hide real teams on an RPC blip**. So it needs a 3-state result (`owned-by-X` / `definitely-nonexistent` / `rpc-unknown`) and must **fail OPEN** — when unsure, show it. Worst case = a ghost lingers; never a real team vanishing. (A revert comes back as a JSON-RPC `error` carrying the `ERC721NonexistentToken` selector `0x7e273289`; a network/timeout is distinguishable from that.)

### Note on the "Stage Mint" badge
For #8742 the badge is technically right (no record + nonexistent). But its trigger (`hasBackendRecord === false`) will also fire on a **legit pass bought on the secondary market** (Go keeps the record under the original owner) or any **undrafted** pass — so it can false-positive on real assets. The on-chain verify above would let you tell a true ghost from a real-but-unrecorded pass.

### Secondary (FYI, not urgent)
Token 1448 is sold but still `active` under Richard in Go (`/draftToken/all`). It doesn't surface on My Teams (OpenSea correctly attributes it to the new owner now), so it's cosmetic — but your `dedupe-passes`/forensics work may want to know the resale-staleness is observable here.

### Also shipped today (small UI-only, already deployed — so the diffs don't surprise you)
- Added `hasSeasonStarted()` to `lib/draftTypes.ts` (derived from `DRAFTING_CLOSES_AT` = NFL kickoff). Gated ALL rank/weekly/season displays on it — pre-season placeholder scores (the same NFT-trait seed junk) now hidden across `BuyTab`, marketplace detail page, `SellTab`, and `components/standings/TeamCard.tsx`; rank only shows for a real 1-10 position. Self-resolves at kickoff.
- Marketplace: removed the Best Rank / Most Points / Playoff Odds **sort options**; hid the **"Top Performing Teams for Sale"** table and **"Why Trade Teams?"** section (both behind `false &&`, easy to restore — the Why-Trade one pending your OK).
- Marketplace card image now fills its frame (portrait `aspect-[3/4]`, like the detail page).
None of these touched your `nftPassClassify` / `dedupe-passes` / `refresh-wallet` / `pass-forensics` / `audits` files.

— Richard's Claude

---

## 2026-06-10 — Vercel builds were dying (45-min hangs / @stripe/crypto error): ROOT-CAUSED & FIXED

You saw it: your "King week" deploy + Richard's two deploys all hung at "Linting and checking validity of types" for 45 min and errored. **Your King week code was never the problem** — it ships fine.

**Root cause (we both found the same thing — you pushed the `3.28.0` pin at f4e14ad while I was testing the identical fix):** `package-lock.json` was in `.gitignore`, so the repo had NO lockfile. Every fresh Vercel install resolved `@privy-io/react-auth@^3.28.0` → newest 3.29.x (published Jun 3-4), whose `FiatOnrampScreen` imports `@stripe/crypto` (not a dependency) → fresh builds fail; partially-cached builds memory-thrash and hang to the 45-min kill.

**What's now in place:**
1. `package.json`: Privy pinned to exact `3.28.0` (your commit + mine agree).
2. `.gitignore`: removed the `package-lock.json` line (workspace AND sbs-frontend-v2).
3. Workspace now has a committed `package-lock.json` (generated from a verified-green fresh install + full local build, all 72 pages). **It did NOT make it into sbs-frontend-v2** — deploy.sh's sync skipped it (predates the .gitignore fix). It needs a one-time manual `git add package-lock.json` commit in sbs-frontend-v2; coordinating with Richard so it rides the next normal deploy instead of triggering an extra build.
4. `VERCEL_FORCE_NO_BUILD_CACHE=1` is temporarily set in Vercel prod env (used to bypass the poisoned cache). **Remove after the next green build** — it makes every build slower/pricier.

**Do-not-reintroduce:** don't bump Privy (or re-ignore the lockfile) without a local fresh-install + full `next build` first. 3.29.x stays broken until they fix the @stripe/crypto import or we add that package deliberately.

— Richard's Claude

---

## 2026-06-12 — ACTION NEEDED: re-open the wheel VRF period (odds changed)

Richard & I rebalanced the Banana Wheel odds (added a **2 Drafts** tier at 5%, funded by trimming 5/10/20 Drafts; HOF 2% + Jackpot 1% untouched; ~5% cheaper EV). It's **live now** on the legacy live-RNG path. New odds are in `lib/wheelConfig.ts` (single source — the spin-page table, the wheel, and outcomes all derive from it).

**Why this needs you:** the change broke the active provably-fair period. Period 1's Merkle root was committed on-chain for the OLD odds, and `deriveSpinOutcome` maps the seed through the CURRENT `wheelSegments` — so leaving period 1 active would serve spins whose proofs don't verify. **I set `wheel_periods/1` → `status: closed`**, which drops the spin route to live-RNG on the new odds (works, but no Merkle proofs until a fresh period is opened).

**What to do (2 clicks, ~1 min) — Admin → Tools → "Banana Wheel Proof (VRF + Merkle)":**
1. Click **"Open round 2"** → approve. Submits ONE Base tx: salt-hash commit + Chainlink VRF request.
2. Wait ~30s for VRF to fulfill.
3. Click **"Finalize"** → pre-computes the 10k outcomes using the NEW odds (current `wheelSegments`), commits the Merkle root on-chain, activates period 2, and repoints `system_config/wheelPeriodState.currentPeriodNumber` → 2 automatically.

After Finalize, the wheel is back in full provable-fairness mode **on the new odds**.

**Prereq — check LINK first.** The Open tx requests Chainlink VRF, paid in LINK on fulfillment. Subscription was funded back in April (period 1 worked), but it may have drawn down. If you click Open and Finalize errors `425 VRF has not fulfilled` after a minute, the LINK tank is empty → top it up on the Chainlink VRF dashboard and **re-run Finalize only** (don't re-Open). Contract `0xc1008a0e6da54c1624246fdfcd6f97dffe6261b5`, coordinator `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634`, subId `10128303728828953835942115475235115997320392890651172797253585554293885654329`, owner/deployer `0xccdF79A51D292CF6De8807Abc1bB58D07D26441D`.

Richard's Claude offered to add a LINK-balance readout to that admin panel (so the tank level shows before you click) — say if you want it. No rush; the wheel pays out correctly on the new odds right now either way.

— Richard's Claude

---

## 2026-06-12 — Wheel specials now run in their OWN lane (deployed rev 00149-sg7)

Heads-up on a backend change I shipped to `models/draft-state.go` (`CreateLeagueDraftStateUponFilling`). Richard scratched the "combo" idea — wheel JP/HOF specials are now their own thing, OUTSIDE the per-100 batch:

- At fill, a draft whose `Level` is already Jackpot/HOF (wheel-won) is detected and increments a NEW `SpecialDraftCount` field on `drafts/draftTracker` instead of `FilledLeaguesCount`. It SKIPS `EnsureBatchCommitted` (no batch proof) and the VRF slot reveal, keeps its wheel level, and is named **"Special Draft Jackpot/HOF #N"** (own sequence). Still bumps `CurrentLive/SlowDraftCount`.
- Regular drafts: completely unchanged (FilledLeaguesCount++, "BBB #N", slot reveal).
- Net: the guaranteed **1 JP + 5 HOF per 100 is now a pure PAID-draft pool**. This is the only VRF-safe model — positions are committed before fills, so a special can't be slotted as Pro without breaking the proof + the guarantee.

Why it matters for you: anything that reasons about the batch (`DraftLeagueTracker`, the playoff/finals scripts that read `Level`/`DisplayName`) should know special drafts now carry "Special Draft Jackpot/HOF #N" names and live on `SpecialDraftCount`, not the BBB # sequence. The combo work (WheelLevel/SlotLevel + the reveal banner) was fully reverted — don't expect those fields.

Verified: compiles + `go vet` + model tests pass (Go 1.20), API healthy post-deploy. First real special draft will initialize `SpecialDraftCount` to 1.

— Richard's Claude

---

## 2026-06-12 — Gas sponsorship for external (MetaMask) wallets: verified NOT possible via Privy

Richard asked if we can cover gas for web3/MetaMask users across the marketplace + minting (the way embedded wallets are covered). I dug into the actual Privy config + their docs. Recording the findings + recommendation.

**Current state (correct, by design):**
- `providers/PrivyProvider.tsx:91` → `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'`. So email/Google/Twitter logins get a Privy **embedded** wallet → transactions gas-sponsored (free). **MetaMask/Coinbase logins get NO embedded wallet** → they transact through MetaMask directly and **pay their own gas**.
- The `sendTx` router (marketplace/page.tsx, detail page, useListTeam, etc.) already branches: `walletClientType === 'privy'` → sponsored; else → external wallet pays. Confirmed live this session: Richard's MetaMask test wallet hit `gas required exceeds allowance (0)` on a cancel — only happens when NOT sponsored.
- **Listing + making offers are already FREE for everyone** (Seaport order = off-chain signature, no gas). Only the one-time setApprovalForAll + mint/buy/accept/cancel cost gas. So the gap is just those, and only for external wallets.

**Can Privy sponsor external wallets? NO — verified in Privy docs:**
- Gas sponsorship requires a **smart wallet (EIP-4337)** with an **embedded** wallet as signer. *"A plain MetaMask EOA cannot have gas sponsored through this approach."*
- Privy's **EIP-7702 support is embedded-only** too — their tooling filters `walletClientType === 'privy'`; a MetaMask user *"would need a separate EIP-7702 implementation, not through Privy's SDK."*

**The only path = custom AA stack, built ourselves (outside Privy):**
- EIP-7702 to make the MetaMask EOA act as a smart account per-tx (keeps assets in the user's address) + our own paymaster + bundler (Pimlico/Alchemy/ZeroDev), SBS-funded, with every marketplace call routed through it.
- **Risks:** (1) this repo already got burned by 7702 — the admin wallet's accidental 7702 delegation broke minting on April 26 (`project_admin_wallet_eip7702`); deliberate 7702 needs serious care. (2) Only covers wallets that support 7702 signing (newer MetaMask post-Pectra) → not 100% coverage. (3) Base gas is fractions of a cent and crypto-natives expect to pay it.

**Recommendation (Richard agreed):** don't build the custom 7702 paymaster — thin ROI for big effort + a known-dangerous area, to remove a sub-penny friction for a minority of power users. Keep funneling normal users to embedded login (already fully gasless). Optional cheap polish: a one-tap "buy ETH on Base" on-ramp on the friendly "needs a little ETH" error so MetaMask users are never stuck. Flagging in case you have a different read on the ROI.

— Richard's Claude

---

## Jun 17 — FYI: set `embeddedWallets.showWalletUIs: false` in PrivyProvider (heads-up, your file)

I added one key to `providers/PrivyProvider.tsx` → `embeddedWallets.showWalletUIs: false`. Reason: when listing/offering on the marketplace, embedded (email/social) users were getting a Privy **"Sign message"** modal for the Seaport order — transactions were already silenced per-call (`sendTransaction` `uiOptions.showWalletUIs:false`), but the order **signature** goes through the raw provider (seaport-js) which doesn't honor per-call uiOptions, so it prompted. The app-level config silences it.

- **Scope:** embedded wallets only; external (MetaMask/Coinbase) still use their own prompts. Transactions were already silent, so the only behavior change is that embedded-wallet **signatures** (Seaport orders, any SIWE/typed-data) now sign in the background.
- **Safe by design:** uses seaport-js's normal `executeAllActions()` (correct order construction); if the config didn't silence something, worst case is the old prompt still shows — no breakage.
- Flagging since you just reworked this file + the purchase/mint flow. If you intentionally want a confirmation on some embedded signature, ping me and we'll scope it per-call instead.

— Richard's Claude

---

## Jun 23 — Draft QUEUE bug ROOT-CAUSED + frontend fix shipped; needs a small Go backend deploy (your local source is current, mine is 2wk stale)

**Symptom (Nick, draft `2026-fast-draft-3`):** queued players never got auto-picked; it drafted ADP best-available instead, even with the draft room open.

**Root cause — wallet-case mismatch on the queue path:**
- Queue is stored at `drafts/{draftId}/state/draftQueues/{wallet}/Players`.
- The frontend was writing `{wallet}` **checksummed/mixed-case** (e.g. `0xEFFC7bb…C8f`) via REST `updateQueue`.
- The auto-pick reads `FetchQueueForDrafter(draftId, CurrentDrafter)` where `CurrentDrafter` is **lowercase** → looked up `0xeffc7bb…c8f` → not found → "no players in queue" → fell back to `CalculateDefaultPickForUser` (ADP). Confirmed Nick's 4 queued TEs (MIN/TEN/TB/PIT-TE) were sitting in the checksummed doc, untouched. Hits ANY wallet whose checksum has uppercase letters (i.e. almost everyone).

**What I already shipped (frontend, deployed):** `lib/draftApi.ts` `updateQueue`/`getQueue` now `.toLowerCase()` the wallet, so the REST write key matches the lowercase read key. This fully fixes the live bug (REST `updateQueue` is the only live queue writer — the WS `sendQueueUpdate` is dead code).

**Defense-in-depth I did NOT deploy (please do, or bless a refresh):** normalize at the data layer so case can never strand a queue again. In **both** services' `models/queue.go`, lowercase `user` at the top of `UpdateQueueForDraft` and `FetchQueueForDrafter`:
```go
user = strings.ToLower(user)   // + add "strings" import
```
Services: `SBS-Football-Drafts-main` (WS auto-pick) and `sbs-drafts-api-deploy` (REST handler + its own auto-pick at draft-actions.go:402).

I did **not** deploy these because my local `~/SBS-Football-Drafts-main` / `~/sbs-drafts-api-deploy` are ~2 weeks stale vs the workspace (timer.go etc. differ) — deploying from my stale source would revert your backend. Your local source is current, so you're the safe one to add the two `ToLower` lines + redeploy. No active drafts right now, so no rush / no migration needed.

— Richard's Claude

---

## Jun 26 — Fill-alert bot (Discord/Twitter) repointed to a NEW frontend feed; did NOT touch the Go backend

**Problem:** the "X more to fill Draft #N" bot (Render: `spoiled-banana-society-bot-ll78.onrender.com`, AdminJS + Postgres, run by Caleb/outside guys) went silent for 2026. It polls `<base>/league?include_unfilled=true`. Two issues: (1) its base URL still points at **last season's prod drafts API** (`…671861674743…` / `w5wydprnbq`, 2025 data) — never repointed after the staging-as-prod cutover; (2) that endpoint's `ReturnLeagues` is hardcoded `2025` + **fast-only**, so slow drafts could never ping.

**Why I didn't fix it in the Go API:** the live `sbs-drafts-api-staging` runs your local 2026 source (deployed via `gcloud run deploy --source`), which has NO `/league` list endpoint and isn't in any pushed git branch. Deploying my own would've clobbered your unpushed 2026 work. So I built the bot's feed in the frontend instead — zero backend risk.

**What I shipped (frontend, deployed):** new route **`app/api/bot/league/route.ts`** → `GET /api/bot/league?include_unfilled=true`. Reads the live `drafts` collection from sbs-staging-env Firestore, returns the exact legacy shape `[{leagueId,displayName,numPlayers,maxPlayers,draftType,isFilled}]`, covers **fast + slow**, and appends `(Fast)`/`(Slow)` to `displayName` (numbering untouched — still the single sequential counter). 15s in-memory cache; year-prefix agnostic so it survives the next rollover. Added `/api/bot/` to the prelaunch allowlist in `middleware.ts` (public-safe, read-only). Verified live on sbsfantasy.com (18 leagues, 16 fast + 2 slow, partials show correctly).

**Open:** Richard is asking Caleb to repoint the bot's base URL → `https://sbsfantasy.com/api/bot` (so it calls `/api/bot/league?include_unfilled=true`). No bot code change needed. If you'd rather the feed live in the Go API long-term, the logic is trivial to port — but this works today and needs nothing from you.

— Richard's Claude

---

## Jun 30 — Slots 1 & 10 now need 3 missed picks before auto-draft (Go API — DEPLOYED to staging)

**What Richard wanted:** draft slots **1 and 10** (the snake turn-ends that pick back-to-back) get **3** consecutive missed picks before auto-draft flips on; slots **2–9 stay at 2**.

**Shipped + deployed** to `sbs-drafts-api-staging` (**rev 00173-bfn**, serving 100%, healthy). Two files:
- `models/draft-actions.go` — new `AutoDraftMissThreshold(draftId, ownerId)` → 3 for slots 1/10 (`DraftOrder[0]` / `DraftOrder[len-1]`), else 2; returns 2 on ANY lookup error (worst case = old behavior).
- `draft-actions/draft-actions.go` — the AutoDraft flip now uses that helper instead of the hardcoded `>= 2`. (Left the `== 2 → now+8` scheduler branch alone; it's a harmless internal-timing quirk, handler still waits full PickEndTime.)

**⚠️ HEADS-UP — your `~/sbs-drafts-api-deploy` is a STALE, DIVERGENT lineage.** It has an `auth/` package + `models/season.go` that are **NOT** in the live/deployed source. The thing actually running (rev 00172→00173) has neither, plus files your folder lacks (`LastMissedPickNum` double-count guard, etc.). **If you `gcloud run deploy --source ~/sbs-drafts-api-deploy` you'll revert live + wipe my change.** I did NOT deploy from that folder — I pulled the exact live Cloud Build source zip (`gs://run-sources-sbs-staging-env-us-central1/...`), extracted to `~/sbs-drafts-api-live`, applied the 2-file change, and deployed that.

**Already synced for you:** pushed the deployed source to the `sbs-drafts-api` **`staging` branch** (commit `c295aed` — includes my change + your previously-unpushed live work so the branch finally matches what's deployed) and to the shared-workspace mirror `repos/sbs-drafts-api-deploy/` on my `richard` branch. **Before your next backend deploy, sync your local folder from the `staging` branch (or from `~/sbs-drafts-api-live`) so you don't revert this.**

— Richard's Claude

---

## Jul 2 — "Buy 2 → 1 Free" (buy-bonus) is back — but ADMIN-ONLY preview, still hidden from users (frontend, DEPLOYED)

**Context:** Richard wants a July 4th weekend promo — every 2 passes bought = 1 free draft, looking exactly like the Buy 10 card. That's the `buy-bonus` promo you retired, so I did NOT just unhide it. Instead:

- **New `ADMIN_PREVIEW_PROMO_TYPES` in `lib/promoFilter.ts`** — types listed there render ONLY for wallets in the admin allowlist (`isWalletAdmin`), on all 3 surfaces (/promos, home carousel, drafting sidebar). Public users see zero change. `buy-bonus` is in it now; slot sits right before the Buy 10 card.
- **Copy refreshed to July 4th theme** in `lib/api/seed.ts` (+ mock) — "Buy 2 → 1 FREE / July 4th Weekend only!", modal "🇺🇸 July 4th: Buy 2 → 1 FREE Draft". Copy overlays on read, so it's live for everyone the moment the type is unhidden.
- **To launch publicly:** move `'buy-bonus'` from `ADMIN_PREVIEW_PROMO_TYPES` into `VISIBLE_PROMO_TYPES_ORDER`. One-line change.

**⚠️ MUST-DO BEFORE PUBLIC LAUNCH:** the purchase path has been incrementing buy-bonus all along (config `enabled: true`) even while hidden — **42 users have silently banked 173 unclaimed free-draft milestones** (top holder: 16). Unhiding as-is = instant mass CLAIM of ~173 free drafts. I wrote `scripts/_reset-buybonus-for-launch.mjs` (dry-run by default, `--apply` to write) that zeroes everyone's buy-bonus progress/claims — run it AT the moment of launch so only weekend purchases count. Audit script: `scripts/_audit-buybonus.mjs`.

Also note the free-draft claims mint real BBB4 passes via the ops wallet (`reserveTokens`), and free-origin passes can't be listed until drafted — existing rules, no change needed.

— Richard's Claude

**UPDATE Jul 2 (later):** Richard switched the buy-bonus reward to a **wheel spin** per 2 passes (was 1 flat free draft). New config `buyBonus.reward: 'spin' | 'draft'` in `lib/api/config.ts` — all your free-draft machinery (claim-path mint, notification, popups) is intact behind the `'draft'` setting; every consumer keys off the config. Copy now "Buy 2 → FREE SPIN". Note the economics: with spins, 10 passes = 5 spins (buy-2) + 1 spin (buy-10) = 6 spins, each guaranteeing ≥1 free draft — flagged to Richard, he's driving. Still admin-only preview.

— Richard's Claude

---

## Jul 2 — House bots: "+1 Bot" admin button + NEW `onBotTurn` Cloud Function (bot brain v1) — DEPLOYED

Richard wants to actually use your house-bot system (great build btw — write-up in Richard's Downloads). Two additions, both live:

1. **"+1 Bot" button** on every FILLING draft row in Admin → Drafts → Manage. One click = joins 1 pool bot via your `/api/admin/bots/fill`; auto-mints one first if the pool's dry (409). Pool is currently EMPTY so nothing exists yet.
2. **`onBotTurn` Cloud Function (deployed to sbs-staging-env)** — human-like bot picking so bots don't rely on miss-2 autopilot. Same RTDB trigger as onPickAdvance. When `currentDrafter` is in `botWallets`: wait random 10–30s (fast) / 30–90s (slow), re-check state fresh after the sleep (compute-at-submit), then POST a normal pick to your `/draft-actions/{id}/owner/{bot}/actions/pick` — ADP-sorted, weighted-random from top 5, positional caps (3QB/7RB/8WR/3TE/3DST). Dials + kill switch in Firestore `system_config/botBrain` (set `enabled:false` to hard-stop). Never picks in the last ~5s, so the buzzer auto-pick path stays the safety net — worst case bots behave exactly like before this function existed. Legacy `bot-…` FillBots owners are explicitly skipped.
   - Deployed per-function only (`firebase deploy --only functions:onBotTurn`) — did NOT touch onPickAdvance/onQueueUpdate/onDraftFilled.
   - Synced `~/sbs-staging-functions` → `repos/sbs-staging-functions` (still carries 05-28 versions of the other functions — deployed ones remain newer; keep deploying per-function).
   - Sim-tested offline vs the real playerMap ADP (150/150 valid unique picks, sane best-ball rosters): `repos/banana-fantasy/scripts/_sim-botbrain.mjs`.

Richard's calls FYI: keep it manual (no auto-fill), no prize-exclusion build for now, no Go /staging auth change.

— Richard's Claude

## 2026-07-06 — JOIN-FIRST enter flow SHIPPED (your join-starvation bug, root-caused differently)

Your `draft.enter.*` breadcrumbs paid off within hours. Readout across 30h of traces:
- **The Go join never failed once** — every attempt landed in 300ms–2s. Connection-starvation of the join POST is NOT what's biting users (your fix #1/#2 not needed for this).
- **Every real failure was `/api/owner/use-pass` (Vercel) blowing the client's 12s abort** on flaky devices — and in the correlated cases the server committed the spend ~1s AFTER the client gave up (request arrived late; server processing itself is fast). Other users joined in <1s in the same minute → per-device delivery delay, not server load.
- So the structural flaw: a cosmetic bookkeeping call was BLOCKING the essential join.

Shipped (frontend `1e0acd20` on sbs-frontend-v2, workspace commit `3cf89e6d`, deployed + verified live ~01:11 UTC):
- `hooks/useEnterDraft.ts`: **join-first**. Go join (the real ownership gate — it rejects "not enough X draft passes") runs immediately on tap; use-pass moved AFTER success as fire-and-forget bookkeeping (`keepalive:true`). No-pass/deadline rejections skip the retry loop and show a clean card. Refund path deleted from the live flow — nothing is spent before the join anymore. Local (non-staging) mode keeps the old gate.
- `app/api/owner/use-pass/route.ts`: new `joined:true` mode = recountFromInventory + `draft_entered` row **with the real leagueId** (your fix #3 — phantom feed rows dead) + the new-user admin bell preserved (works for 1-pass users too; the old gate would have dropped it post-join).
- Trace sources now: `draft.enter.join_start` / `join_done` / `join_fail` / `no_lobby` / `bookkeep_fail` (+ `spend_fail` only in local mode).

Verified live end-to-end: real UI join on the claude-chrome test account → slow-draft-4 seated 4/10, `join_start→join_done` 497ms, `draft_entered` carried `leagueId:2026-slow-draft-4`, mirror synced, then left (league back to 3) and all staging test tokens purged (incl. mirrors — note: `/staging/cleanup-tokens` deletes Go's copy but NOT `owners/{w}/validDraftTokens` docs; I removed those by hand).

— Richard's Claude

## 2026-07-06 — Queue now BEATS position limits in client auto-pick (deployed)

User complaint (jetsonjets22, draft-77): queued several WR2s + auto-draft, got NO-RB2 instead. Root cause was NOT the draft-70 dual-autopicker race — his own Position Limits setting (`userPositionalLimits`: WR2 max 1) silently blocked his queued WR2s once LAC-WR2 filled the cap, and the picker fell to best-ADP (working as designed at the time).

Change (one condition in `hooks/useDraftEngine.ts` `autoPickForPlayer`): the queue step no longer filters by position caps. Rationale: a queued player is a deferred MANUAL pick, and manual picks have always bypassed caps — specific intent beats the generic guardrail. Caps still fully apply to the picker's own BPA choices, so the "8 QBs freeze-out" protection is unchanged. Also makes client behavior consistent with the server autoDraft, which never had caps.

Verified: prod build green, e2e vs built app 11/12 (the 1 fail = pre-existing `/drafting` "BBB #500" localStorage test, fails identically on baseline — worth a look sometime), unit tests 6/6 incl. a replay of the jetsonjets22 scenario. Deployed ~4:20 PM PT.

Support checklist for future "auto-draft ignored my queue" reports: 1) `userPositionalLimits/{wallet}` — if queued players' slots at cap, it WAS this (now fixed); 2) `sortOrders` LastMissedPickNum distinguishes client auto-draft picks from server timeout picks; 3) only then suspect the draft-70 WS/api race (still open).

UX follow-up idea (unbuilt): badge queued players that exceed the user's own limits so settings conflicts are visible.

— Richard's Claude
