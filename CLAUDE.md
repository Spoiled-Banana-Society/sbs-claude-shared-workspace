# Banana Fantasy — Shared Workspace

Bridge between Boris and Richard. Both work on banana-fantasy from their own machines using personal branches to avoid conflicts. Keep this file tight — if something is resolved or lives in code, don't write it here.

## ⚠️ RULE #0 — DO NOT SELF-DDOS THE STAGING SITE

**Read this before writing any `useEffect` that contains a `fetch`.** Violating it took the entire staging site down on May 27, 2026 — Vercel's edge protection auto-tripped because a React render loop was hammering the API thousands of times per minute from one browser tab. Took ~hour to diagnose and recover. Affects ALL features (DMs, Promos, Drafting, login) because Vercel 403s the whole site at the edge.

**The bug pattern that caused it:**
```ts
//  BROKEN — fetch fires on every parent re-render
useEffect(() => {
  void refresh();
  setInterval(refresh, POLL_MS);
}, [enabled, refresh]);  //  ← refresh derives from usePrivy() → unstable identity
```

**Why it self-DDoSes:** `usePrivy()` returns a new object identity on many renders. Any `useCallback` that depends on `privy` gets a new identity each render. Any effect that lists that callback in its deps re-fires on each render. Each fire = an immediate fetch. A frequently re-rendering parent = thousands of fetches/minute from one tab. Vercel's DDoS Mitigation sees this and 403s the whole project.

**The fix — required pattern for any effect with a fetch:**
```ts
const fnRef = useRef(fn);
useEffect(() => { fnRef.current = fn; }, [fn]);

useEffect(() => {
  if (!enabled) return;
  void fnRef.current();
  const id = setInterval(() => { void fnRef.current(); }, POLL_MS);
  return () => clearInterval(id);
}, [enabled]);  //  ← deps are SCALARS ONLY (enabled, otherWallet, query string)
```

**Three-question checklist before committing any `useEffect` with a `fetch`:**
1. Does this effect call a function that does network I/O?
2. Is that function in the effect's dep array?
3. Does that function come from a hook that uses Privy / Auth / any context provider?

**If all three are yes → fix it with the ref pattern above before committing.**

**Related rules (also part of staying off Vercel's bot-detection radar):**
- Cap deploys at **2–3 per hour** on this project. Bundle features into one commit when possible. Compounds the blast radius if a render-loop bug ships.
- **Never burst-curl the live site** (`banana-fantasy-sbs.vercel.app`) during debugging. One HEAD/GET to verify a route exists is the max. Use `scripts/*.mjs` against the Firestore admin SDK for functional testing instead.
- Treat "stuck Loading…" / "stuck Searching…" as a render-loop suspect FIRST, not a slow-network suspect. Open DevTools → Network and count requests/sec before chasing other theories.

If the site is already 403'd at the edge: check Vercel team Firewall → Rules → DDoS Mitigation. If it's firing, add a System Bypass Rule for the user's IP OR wait ~30–60 min for the auto-mitigation cooldown, OR email Vercel support with the error ID for instant lift.

## Shared Workspace Sync (Read First)

### Branch Structure
- `main` — deployable code, only receives merges. **NEVER commit directly to main.**
- `boris` — Boris's working branch.
- `richard` — Richard's working branch.

### At the START of every session:
```bash
cd ~/sbs-claude-shared-workspace
git fetch origin
git checkout <your-branch>          # boris or richard
git pull origin <your-branch>
git merge origin/main --no-edit     # get the other person's deployed work
```

### At the END of every session (after ANY changes):
```bash
cd ~/sbs-claude-shared-workspace
git add <specific files>            # never -A or .
git commit -m "<Name>: <short>"
git push origin <your-branch>
```

### To deploy:
```bash
cd ~/sbs-claude-shared-workspace
git fetch origin
git merge origin/main --no-edit
git checkout main && git pull origin main
git merge <your-branch> --no-edit && git push origin main
git checkout <your-branch>
```
Then push to `sbs-frontend-v2` (banana-fantasy remote) to trigger Vercel.

### ⛔ Git Commit Safety (NON-NEGOTIABLE)
Richard's commits have overwritten Boris's work multiple times from stale local files. Every commit, every time:

1. **`git pull origin main`** before committing — your local copies of files you didn't edit are stale.
2. **Only stage files you actually changed** — `git add <specific-files>`. **NEVER `git add -A` or `git add .`**.
3. **Before pushing, verify:** `git diff --stat HEAD~1`. If you see files you didn't touch, stop — you're about to overwrite someone's work.
4. If pushing to sbs-frontend-v2: `cd ~/banana-fantasy && git pull origin main` there too before committing.

### Sync Script Must Not Delete
Your sync script must NOT use `rsync --delete` when rsyncing `~/banana-fantasy → ~/sbs-claude-shared-workspace/repos/banana-fantasy/`. It silently destroys the other person's files when local is missing anything they added. Remove the flag — let intentional deletes happen via explicit `git rm` instead. Boris's `~/sync-shared-workspace.sh` is the reference.

### Pre-Push Hook (MANDATORY — set up once per machine)
Blocks pushes unless the other person's latest commits have been synced. Marker must be the actual commit hash — can't be faked with `touch`:

```bash
# Richard: OTHER_BRANCH=boris ; Boris: OTHER_BRANCH=richard
OTHER_BRANCH="<other>"
cat > ~/banana-fantasy/.git/hooks/pre-push << HOOKEOF
#!/bin/bash
SHARED=~/sbs-claude-shared-workspace
MARKER=~/banana-fantasy/.last-richard-sync
LATEST=\$(cd "\$SHARED" && git fetch origin --quiet 2>/dev/null && git rev-parse origin/${OTHER_BRANCH} 2>/dev/null)
if [ -z "\$LATEST" ]; then echo "⛔ Could not fetch origin/${OTHER_BRANCH}."; exit 1; fi
if [ ! -f "\$MARKER" ]; then echo "⛔ Sync first. Latest: \$LATEST"; exit 1; fi
SYNCED=\$(cat "\$MARKER" 2>/dev/null)
if [ "\$SYNCED" != "\$LATEST" ]; then
  echo "⛔ ${OTHER_BRANCH} has new commits (\$LATEST) since your sync (\$SYNCED)."
  exit 1
fi
echo "✓ Sync verified (\${LATEST:0:7})"
HOOKEOF
chmod +x ~/banana-fantasy/.git/hooks/pre-push
```

After syncing:
```bash
cd ~/sbs-claude-shared-workspace && git rev-parse origin/<other> > ~/banana-fantasy/.last-richard-sync
```

### Tests Before Deploy (run when practical)
- Preferred: `cd ~/sbs-claude-shared-workspace/repos/banana-fantasy && npx playwright test e2e/draft-room.spec.ts`
- Run when a change plausibly affects draft-room behavior or drafting page.
- Skip for config-only, docs, or pure backend patches the frontend doesn't exercise.
- If tests fail because of the diff: fix before deploying.

### Backend folders under repos/ (since 2026-05-19) — applies to BOTH Boris and Richard
- `repos/sbs-drafts-api-deploy/`, `repos/SBS-Football-Drafts-main/`, and `repos/sbs-staging-functions/` are now **actively synced** to whatever's deployed on staging Cloud Run / Firebase. Previously these were a stale 2026-05-06 snapshot.
- **Whoever deploys is responsible for the sync.** Both Boris and Richard maintain local working copies under `~/sbs-drafts-api-deploy/`, `~/SBS-Football-Drafts-main/`, `~/sbs-staging-functions/` and deploy via `gcloud run deploy --source` / `firebase deploy`. After any deploy, the deployer must sync the local source folder into this shared workspace AND push.

**Workflow after any backend deploy (Boris OR Richard):**
1. Edit + test locally
2. Deploy: `gcloud run deploy <svc> --source <local-folder> --region us-central1 --project sbs-staging-env --quiet` (or `firebase deploy` for Functions)
3. Verify Cloud Run traffic actually routed to the new revision (`gcloud run services describe <svc> --format="value(status.traffic[0].revisionName)"`) — sometimes it stays on the old one and needs `gcloud run services update-traffic <svc> --to-revisions=<new>=100` to fix
4. **Sync to shared workspace + push.** Use rsync with the standard excludes:
   ```
   rsync -av --delete --exclude=.git --exclude=node_modules --exclude=.env \
     --exclude=.env.* --exclude=configs --exclude=*.bak --exclude=vendor \
     --exclude=*.log --exclude=.DS_Store --exclude=sbs-drafts-api \
     ~/<local-folder>/ ~/sbs-claude-shared-workspace/repos/<system>/
   cd ~/sbs-claude-shared-workspace && git add repos/<system>/ \
     && git commit -m "Sync <system>" && git push origin main
   ```
5. **Go API only:** also push to `staging` branch on `sbs-drafts-api` repo for Caleb (dev):
   `cd ~/sbs-drafts-api-deploy && git push origin staging`

**For Caleb (dev):**
- Reviews staging via `Spoiled-Banana-Society/sbs-drafts-api/tree/staging` or `Spoiled-Banana-Society/sbs-claude-shared-workspace` under `repos/`
- Don't touch his `main` branch on `sbs-drafts-api` — that's his prod lane

**Drift check:** before any backend deploy, verify the shared workspace folder for the system matches the local source. If it doesn't, that means a prior deploy skipped the sync — fix the drift first.
```
diff -rq ~/<local-folder>/ ~/sbs-claude-shared-workspace/repos/<system>/ \
  --exclude=.git --exclude=node_modules --exclude=configs --exclude=.env \
  --exclude=.DS_Store --exclude=*.bak
```

---

## Company & Product

- **Company:** Spoiled Banana Society (SBS), founded 2021. `sbsfantasy.com`.
- **Product:** Onchain fantasy football (best ball format) on Base chain.
- **Current Season:** Banana Best Ball 4.
- **NFT Collection:** `opensea.io/collection/banana-best-ball-3`.
- **Team:** Boris Vagner (cofounder, product/vision) · Richard Vagner (cofounder) · Dev (full-stack, limited availability).

### What is Best Ball?
- Draft a team, hands off for the season. System auto-picks each week's best scoring players.
- Similar to Underdog Fantasy. No lineup management.
- Draft starts immediately when 10 players join.

### Draft Format
- **Snake draft, team-position-based** — draft "KC QB", not "Patrick Mahomes". Each week you get the highest-scoring player from that team's position slot.
- 10 players per draft. 15 rounds.
- **Fast drafts:** 30 seconds per pick.
- **Slow drafts:** 8 hours per pick (Go API returns `pickLength: 28800`).

### Draft Types (Guaranteed Distribution)
| Type | Per 100 | Color | Perk |
|------|---------|-------|------|
| Jackpot | 1 | Red `#ef4444` | Win league → skip to finals |
| HOF | 5 | Gold `#D4AF37` | Bonus prizes on top of regular rewards |
| Pro | 94 | Purple `#a855f7` | Standard |

Not random odds — guaranteed distribution per 100 drafts. Users don't know type until the draft fills (slot machine reveal). Backend owns the batch tracker (`models/leagues.go` → `DraftLeagueTracker`). Frontend reads `GET /league/batchProgress`.

---

## Tech Stack
- **Frontend:** Next.js 14 (App Router), Tailwind. Repo: `banana-fantasy`.
- **Backend:** Go APIs on Cloud Run. `sbs-drafts-api` (REST) + `SBS-Football-Drafts` (WebSocket).
- **Data:** Firebase Realtime DB (live draft state) + Firestore (users, purchases, notifications, pass_origin, admin audit).
- **Auth:** Privy (embedded wallets + external wallets).
- **Chain:** Base mainnet (chain id 8453).
- **Payments:** $25 USDC on Base. Card via Coinbase Onramp (Privy `useFundWallet`, `preferredProvider: 'moonpay'` historically — currently Coinbase).
- **Push notifications:** OneSignal (app `SBS Fantasy`, Vercel vars `NEXT_PUBLIC_ONESIGNAL_APP_ID` + `ONESIGNAL_REST_API_KEY`).

## Design
- Apple-esque: clean, minimal, premium. Dark theme, subtle glows, glassmorphism (`backdrop-blur-xl` + soft borders).
- Brand color: `#fbbf24` (banana yellow).
- Tailwind custom colors: `jackpot #ef4444`, `hof #D4AF37`, `pro #a855f7` + glow variants.
- CSS utilities (`globals.css`): `.glow-jackpot` / `.glow-hof` / `.glow-pro` / `.glow-banana` / `.hof-gold-filter` / `.glass-card`.
- Product should feel like a polished web2 fantasy app with web3 superpowers under the hood.

## Smart Contract
- **BBB4 draft pass NFT:** `0x781B2E6fE9A615C2680A51Ef88f309ddC2e0D73F` on Base.
- **USDC on Base:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Public `mint(numberOfTokens)` — user pays $25 USDC per pass.
- `reserveTokens(address, numberOfTokens)` — `onlyOwner` admin mint, no USDC. Used for admin grants + wheel prize + promo rewards.
- Owner wallet: `0xccdF79A51D292CF6De8807Abc1bB58D07D26441D` (private key in Vercel env `BBB4_OWNER_PRIVATE_KEY`). Reserve for multisig handoff before prod volume.
- Origin of free mints tracked in Firestore `pass_origin/{tokenId}` so marketplace rule (free passes can't list until season closes) can join against it.

---

## Deployment

### Staging URLs
| Service | URL |
|---------|-----|
| Frontend | `banana-fantasy-sbs.vercel.app` (Privy-whitelisted — use this, not `banana-fantasy.vercel.app`) |
| Drafts API | `sbs-drafts-api-staging-652484219017.us-central1.run.app` |
| WebSocket | `sbs-drafts-server-staging-652484219017.us-central1.run.app` |
| Firebase RTDB | `sbs-staging-env-default-rtdb.firebaseio.com` |

### Production URLs (READ ONLY — do not deploy)
- Drafts API: `https://sbs-drafts-api-w5wydprnbq-uc.a.run.app`
- WebSocket: `wss://sbs-drafts-server-w5wydprnbq-uc.a.run.app`
- Firebase RTDB: `https://sbs-prod-env-default-rtdb.firebaseio.com`

### GCP
- Project: `sbs-staging-env` (`652484219017`), region `us-central1`.
- VPC Connector: `staging-connector` (10.8.0.0/28).
- Service Account: `firebase-adminsdk-fbsvc@sbs-staging-env.iam.gserviceaccount.com`.

### Deploy Commands
```bash
# Go API (deploy from local copy with configs/ secrets; shared workspace excludes them)
gcloud run deploy sbs-drafts-api-staging --source ~/sbs-drafts-api-deploy --region us-central1 --project sbs-staging-env

# WebSocket server
gcloud run deploy sbs-drafts-server-staging --source ~/SBS-Football-Drafts-main --region us-central1 --project sbs-staging-env --port 8000 --timeout 3600 --min-instances 1 --vpc-connector staging-connector --allow-unauthenticated

# Firebase Cloud Functions
cd ~/sbs-staging-functions && firebase deploy --only functions
```

### Backend Repos (Reference)
All at `~/borisvagner/`:
- `sbs-drafts-api-deploy/` — Boris's deploy copy with configs. Has `playoff-scripts` branch that's currently live.
- `sbs-drafts-api-main/` — reference.
- `SBS-Football-Drafts-main/` — WebSocket server.
- `SBS-Backend-main/` — **READ-ONLY** prod reference (Firebase Functions).
- `sbs-staging-functions/` — staging Firebase Functions (`onQueueUpdate`, upcoming `onPickAdvance`). Deploys to `sbs-staging-env`.

---

## Do-Not-Reintroduce Rules

### Draft Room Race Conditions
- **draftId race:** URL has no draftId — `joinDraft` sets it async. The "at 10" effect MUST guard `if (isLiveMode && !draftId) return` and include `draftId` in deps.
- **Poll race:** 2.5s poll must NOT set `draftOrder` during filling — only `playerCount`. The "at 10" effect owns the randomize transition.

### Chain + payments
- Entry fee is $25 USDC on Base. Never hard-code 0x1234… mock wallets into user resolution — admin grant must mint to the admin-typed recipient.

### Marketplace listing rule (updated 2026-06-17)
- Block listing only for an **UNDRAFTED free pass** — i.e. `passType === 'free'` that has NOT yet been drafted into a team. A **drafted** team is sellable even pre-season, free or paid (Richard's call 2026-06-17 — drafting a free pass "unlocks" it for sale).
- Enforced server-side in `app/api/marketplace/listings/route.ts`: `classifyToken` is authoritative (undrafted free pass → 403); the `listFreeOriginTokenIds` season-open backstop only fires when the classifier can't confirm a drafted team (Go API down). Client mirrors this in `SellTab.tsx` (`canSellTeam`) + `marketplace/page.tsx` (`handleList`).
- Do NOT reinstate a blanket "all free-origin tokens blocked during `isDraftingOpen()`" rule — that wrongly blocked drafted free teams (sign → server-reject).

---

## Current Open Threads

See `NOTES-FOR-RICHARD.md` and `NOTES-FOR-BORIS.md` for active coordination between us. Keep those dated and trim resolved items.

## When You Ship Something
- Update this file when you add new conventions, move addresses, change deploy commands, or set do-not-reintroduce rules.
- Do NOT dump session notes here. Those go in `NOTES-FOR-*.md`.
- Trim aggressively — if the history is in git log or in the code, don't re-describe it here.
