# Banana Fantasy - Project Context

## Hard Rules

### NEVER Touch Production
- **Only work in staging.** No prod access, no prod deploys.
- **Do NOT modify or deploy** these repos — reference only:
  - `/Users/borisvagner/sbs-draft-web-main/` (old draft frontend — use as UX reference)
  - `banana-fantasy-complete.zip` (snapshot of old draft)
- **Staging repos you CAN modify:**
  - Frontend: `/Users/borisvagner/banana-fantasy/` → push to `main` = Vercel deploy
  - Go API: `/Users/borisvagner/sbs-drafts-api-main/` → deploy via `gcloud run deploy sbs-drafts-api-staging`
  - WS Server: `/Users/borisvagner/SBS-Football-Drafts-main/` → deploy via `gcloud run deploy sbs-drafts-server-staging`
  - Firebase Functions: `/Users/borisvagner/SBS-Backend-main/`

### Workflow
- Always commit and push after completing changes
- Always test against real staging backend — mint tokens, join league, fill bots. Never use fake draft IDs.

### Tests Before Deploy (run when practical)
- Preferred command: `cd ~/sbs-claude-shared-workspace/repos/banana-fantasy && npx playwright test e2e/draft-room.spec.ts`
- Run the suite when a change plausibly affects draft-room behavior or the drafting page.
- Skip when: config-only changes, doc edits, pure backend patches the frontend doesn't exercise, or when the suite is failing for environmental reasons unrelated to the diff (cold-compile timing, missing deps) and Richard has okayed the deploy.
- If tests fail because of the diff: fix before deploying. Don't ship regressions.

### Draft Room Race Conditions (DO NOT REINTRODUCE)
- **draftId race**: URL has no draftId — set async by `joinDraft`. The "at 10" effect MUST guard `if (isLiveMode && !draftId) return` + include `draftId` in deps.
- **Poll race**: 2.5s poll must NOT set `draftOrder` during filling — only `playerCount`. The "at 10" effect owns the transition.

### Render-Loop Self-DDoS (DO NOT REINTRODUCE — incident May 27, 2026)
- A `useEffect` containing a `fetch` MUST NOT list a Privy-derived callback (anything that flows from `usePrivy()` — `getAccessToken`, custom `authHeaders`, etc.) in its dep array. Privy hook identity churns per render → effect re-fires per render → fetch storm → Vercel DDoS Mitigation 403s the whole site for ALL users.
- The fix is the ref pattern: stash the callback in `useRef`, then keep effect deps to stable scalars (`enabled`, `walletAddress`, etc.). See `hooks/useDms.ts:84-90` for a reference implementation.
- Smoke test: `npx playwright test e2e/render-loop-guard.spec.ts` opens high-risk pages and fails CI if any page makes >75 `/api/*` requests in 10s. Run before deploying anything that adds a `useEffect` with a fetch.
- Full incident write-up + the three-question checklist before committing: `~/sbs-claude-shared-workspace/CLAUDE.md` Rule #0.

## Company & Product
- **Company:** Spoiled Banana Society (SBS), founded 2021
- **Product:** Onchain fantasy football (best ball format) on Base chain
- **Team:** Boris Vagner (cofounder, product/vision), Richard Vagner (cofounder), Dev (full-stack, limited availability)
- **Format:** Snake draft, team-based positions (draft "DAL WR1" not "CeeDee Lamb"), 10 players, 15 rounds

## Draft Types (Guaranteed Distribution)
| Type | Per 100 | Color | Perk |
|------|---------|-------|------|
| Jackpot | 1 | Red #ef4444 | Win league → skip to finals |
| HOF | 5 | Gold #D4AF37 | Additional prizes |
| Pro | 94 | Purple #a855f7 | Standard |

NOT random odds — guaranteed distribution per 100 drafts. Users don't know type until draft fills (pack reveal).

## Design & UX Philosophy
- **Think Apple.** Clean, minimal, premium. Every screen should feel intentional and polished.
- Dark theme, subtle glows, smooth animations with proper easing
- Brand color: #fbbf24 (banana yellow)
- No generic "AI look" — make it distinctive
- Glassmorphism: backdrop-blur, subtle borders, soft shadows
- Less is more — whitespace over clutter, icons over labels
- Should feel like a polished web2 app with web3 under the hood
- Iterates quickly — build then refine

### Tailwind Custom Colors
- `jackpot`: `#ef4444`, `hof`: `#D4AF37`, `pro`: `#a855f7`
- Glow variants: `jackpot-glow`, `hof-glow`, `pro-glow`

### CSS Utility Classes (globals.css)
- `.glow-jackpot` / `.glow-hof` / `.glow-pro` / `.glow-banana` — box-shadow glows
- `.hof-gold-filter` — gold filter for HOF logo: `sepia(100%) saturate(400%) brightness(110%) hue-rotate(10deg)`
- `.glass-card` — unified glassmorphism

## Tech Stack
- **Frontend:** Next.js 14 (App Router), Tailwind
- **Backend:** Go APIs on Cloud Run, Firebase RTDB, Firestore
- **Auth:** Privy (embedded wallets)
- **Payments:** $25 USDC on Base, card via MoonPay

## Deployment

### Staging URLs
| Service | URL |
|---------|-----|
| Frontend | `banana-fantasy-sbs.vercel.app` |
| Drafts API | `sbs-drafts-api-staging-652484219017.us-central1.run.app` |
| WS Server | `sbs-drafts-server-staging-652484219017.us-central1.run.app` |
| Redis | `10.8.75.59:6379` (internal VPC) |
| Firebase RTDB | `sbs-staging-env-default-rtdb.firebaseio.com` |

### Production URLs (READ ONLY — do not deploy)
- Drafts API: `https://sbs-drafts-api-w5wydprnbq-uc.a.run.app`
- WebSocket: `wss://sbs-drafts-server-w5wydprnbq-uc.a.run.app`
- Firebase RTDB: `https://sbs-prod-env-default-rtdb.firebaseio.com`

### GCP Project
- **Project:** `sbs-staging-env` (652484219017), region `us-central1`
- **VPC Connector:** `staging-connector` (10.8.0.0/28)
- **Service Account:** `firebase-adminsdk-fbsvc@sbs-staging-env.iam.gserviceaccount.com`

### Deploy Commands
```bash
# API
gcloud run deploy sbs-drafts-api-staging --source /Users/borisvagner/sbs-drafts-api-main --region us-central1 --project sbs-staging-env

# WebSocket server
gcloud run deploy sbs-drafts-server-staging --source /Users/borisvagner/SBS-Football-Drafts-main --region us-central1 --project sbs-staging-env --port 8000 --timeout 3600 --min-instances 1 --vpc-connector staging-connector --allow-unauthenticated
```

### Key IDs
- Privy App ID: `cmlg4vpxo01txl70dm0hr9t86`
- Firebase Project: `sbs-prod-env`
- BBB4 Contract: `0x781B2E6fE9A615C2680A51Ef88f309ddC2e0D73F`
- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Git Commit Safety (ALL DEVELOPERS)
- **ALWAYS `git pull origin main` before committing.** Your local files may be stale.
- **Only stage files you actually changed:** Use `git add <specific-files>`, NEVER `git add -A` or `git add .`. Blanket staging will include stale versions of files others have changed and silently revert their work.
- **Before pushing, run `git diff --stat HEAD~1` to verify** you're only changing the files you intended.

## Troubleshooting
- **Debugging a reported bug:** Logs live in the admin Logs tab + via `node scripts/logs.mjs`. See `docs/LOGGING.md` for the full system (sources, export, CLI).
- **Draft server 503:** Usually Redis unreachable. Check: Redis instance READY, VPC connector attached, `REDIS_URL` env var.
- **gcloud permission errors:** Firebase SA can deploy Cloud Run but CANNOT create infra (Redis, VPC). Use GCP Console.
- **Build errors:** Don't run `npm run build` while dev server is up. Fix: stop server, `rm -rf .next`, restart.
- **BuyPassesModal crash:** `useFundWallet` runs on mount. Only mount when modal is open.

## Testing
- **Chrome extension: ONLY use the "claude code chrome" profile.** NEVER use any other Chrome profile — safety boundary.
- Draft type odds are **1% JP / 5% HOF / 94% Pro** (production-correct)
- `isStagingMode()` always returns true

## Shared Workspace Repo
**GitHub:** `Spoiled-Banana-Society/sbs-claude-shared-workspace` (public)
CLAUDE.md at root + 5 repos in `repos/`. .env files and GCP service accounts excluded for security.

## Future Tasks
1. Jackpot promo
2. Full 150-pick draft + final card on staging
3. Test with real Privy wallet (not mock auth) — DONE (Privy fully working on staging)
