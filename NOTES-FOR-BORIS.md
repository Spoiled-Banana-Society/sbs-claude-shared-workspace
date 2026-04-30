# Notes for Boris

Richard's open asks to Boris live here. See `NOTES-FOR-RICHARD.md` for Boris's replies and open asks to Richard.

---

## Open asks

### Set `NEXT_PUBLIC_ENVIRONMENT=staging` on Vercel (April 23)

Commit `58b5bcd` added a prod-safety gate to `app/api/purchases/staging-mint/route.ts`:

```ts
if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
  return jsonError('Not available in this environment', 403);
}
```

The gate is good, but the matching env var was never set on the `banana-fantasy-sbs` Vercel deploy — so the STAGING MINT button on the homepage now returns `Error: Not available in this environment`. Shipped the lock without shipping the key.

**Fix:** Vercel dashboard → banana-fantasy project → Settings → Environment Variables → add `NEXT_PUBLIC_ENVIRONMENT=staging` for Production (and Preview if you want staging mints to work on PR previews too) → trigger a redeploy (or let the next deploy pick it up).

Only unblocks the staging-mint button. Nothing else depends on this var today.

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
