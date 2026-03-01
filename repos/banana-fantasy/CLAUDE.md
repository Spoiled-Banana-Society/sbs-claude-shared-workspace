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

### Draft Room Race Conditions (DO NOT REINTRODUCE)
- **draftId race**: URL has no draftId — set async by `joinDraft`. The "at 10" effect MUST guard `if (isLiveMode && !draftId) return` + include `draftId` in deps.
- **Poll race**: 2.5s poll must NOT set `draftOrder` during filling — only `playerCount`. The "at 10" effect owns the transition.

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
- BBB4 Contract: `0x14065412b3A431a660e6E576A14b104F1b3E463b`
- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Troubleshooting
- **Draft server 503:** Usually Redis unreachable. Check: Redis instance READY, VPC connector attached, `REDIS_URL` env var.
- **gcloud permission errors:** Firebase SA can deploy Cloud Run but CANNOT create infra (Redis, VPC). Use GCP Console.
- **Build errors:** Don't run `npm run build` while dev server is up. Fix: stop server, `rm -rf .next`, restart.
- **BuyPassesModal crash:** `useFundWallet` runs on mount. Only mount when modal is open.

## Testing
- **Chrome extension: ONLY use the "claude code chrome" profile.** NEVER use any other Chrome profile — safety boundary.
- Draft type odds are **33% each for testing** — change back to 1%/5%/94% before prod
- `isStagingMode()` always returns true

## Shared Workspace Repo
**GitHub:** `Spoiled-Banana-Society/sbs-claude-shared-workspace` (public)
CLAUDE.md at root + 5 repos in `repos/`. .env files and GCP service accounts excluded for security.

## Future Tasks
1. Jackpot promo
2. Full 150-pick draft + final card on staging
3. Test with real Privy wallet (not mock auth)
4. Web3Auth setup
