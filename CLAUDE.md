# Banana Fantasy - Project Context

> **Note to Claude:**
> - Update this file when building new features, making design decisions, or changing important logic. This is your memory across sessions.
> - If you cause an error, fix it immediately without waiting for the user to report it. Check the dev server output after edits.
> - **Always commit and push after completing changes.** Push to your personal branch, not main.

## Shared Workspace Sync (IMPORTANT — Read First)

This repo (`sbs-claude-shared-workspace`) is the bridge between Boris and Richard. Both work on banana-fantasy from their own machines using **personal branches** to avoid conflicts.

### Branch Structure
- `main` — deployable code, only receives merges. **NEVER commit directly to main.**
- `richard` — Richard's permanent working branch
- `boris` — Boris's permanent working branch

### At the START of every session:
```bash
cd ~/sbs-claude-shared-workspace
git fetch origin
git checkout <your-branch>          # richard or boris
git pull origin <your-branch>
git merge origin/main --no-edit     # get the other person's deployed work
# If merge conflict: resolve it, then git add + git commit
```

### At the END of every session (after ANY changes):
```bash
cd ~/sbs-claude-shared-workspace
git add -A
git commit -m "<Name>: <brief description of what changed>"
git push origin <your-branch>       # push to YOUR branch, not main
```

### To deploy (only when work is ready):
```bash
cd ~/sbs-claude-shared-workspace
git fetch origin
git merge origin/main --no-edit
git checkout main && git pull origin main
git merge <your-branch> --no-edit && git push origin main
git checkout <your-branch>

# Sync to deploy repo and trigger Vercel
cp -R repos/banana-fantasy/app repos/banana-fantasy/components repos/banana-fantasy/hooks repos/banana-fantasy/lib repos/banana-fantasy/e2e repos/banana-fantasy/public /tmp/sbs-frontend-v2/ 2>/dev/null
cd /tmp/sbs-frontend-v2 && git add -A && git commit -m "<description>" && git push origin main
curl -s -X POST "https://api.vercel.com/v1/integrations/deploy/prj_laojah7E1rx3bwkFOPcOAsumG0DO/uFCdmzX21J"
```

### Rules:
- **NEVER commit directly to main** — always work on your personal branch.
- **ALWAYS pull and merge main at session start** — otherwise you'll miss the other person's work.
- **ALWAYS push your branch at session end** — otherwise the other person can't see your progress.
- **Only merge to main when deploying** — main should always be deployable.
- If there's a merge conflict, resolve it carefully — don't discard either side without checking.
- Commit messages start with your name: "Richard: ..." or "Boris: ..."

## Company Overview
- **Company:** Spoiled Banana Society (SBS)
- **Founded:** 2021
- **Product:** Onchain fantasy football (best ball format)
- **Website:** sbsfantasy.com
- **NFT Collection:** opensea.io/collection/banana-best-ball-3
- **Current Season:** Banana Best Ball 3

## Team
- **Boris Vagner** - Cofounder (primary contact, product/vision)
- **Richard Vagner** - Cofounder (brother)
- **Dev** - Full-stack developer (limited availability, handles backend)

## What is Best Ball?
- Draft a team, then hands-off for the season (no lineup management)
- System auto-selects your best scoring players each week
- Similar to Underdog Fantasy format
- No scheduled drafts - draft starts immediately when 10 players join

## Draft Types (Revealed via Pack Opening)
| Type | Odds | Color | Style |
|------|------|-------|-------|
| **Jackpot** | 1% | Red (#ef4444) | Fire effects, intense glow, ultra rare |
| **HOF (Hall of Fame)** | 5% | Gold (#D4AF37) | Gold sparkles, prestigious, apply gold filter to logo |
| **Pro** | 94% | Purple (#a855f7) | Clean, standard, subtle |

- Users don't know their draft type until they enter (pack reveal experience)
- HOF logo is red but should display as GOLD (use CSS filter)
- Jackpot logo is red gradient text

### Draft Type Perks
| Type | Perk |
|------|------|
| **Jackpot** | Win your league → skip straight to the finals (bypass 2 weeks of playoffs) |
| **HOF** | Compete for additional prizes on top of regular weekly and season-long rewards |

## Draft Type Odds System (Guaranteed Distribution)
**This is NOT random odds - it's a guaranteed distribution system.**

Every 100 drafts contains exactly:
- **94 Pro drafts**
- **5 HOF drafts**
- **1 Jackpot draft**

The order is randomized, but the distribution is guaranteed.

### How Percentages Work
- Percentages are **dynamic** and update in real-time as drafts complete
- They reflect the remaining pool, not fixed odds
- Percentages always add up to 100%
- System resets every 100 drafts

### Example Flow
| Drafts Completed | Pro Left | HOF Left | Jackpot Left | Pro % | HOF % | Jackpot % |
|------------------|----------|----------|--------------|-------|-------|-----------|
| 0 | 94 | 5 | 1 | 94% | 5% | 1% |
| 1 (was Pro) | 93 | 5 | 1 | 93.9% | 5.05% | 1.01% |
| 10 (all Pro) | 84 | 5 | 1 | 93.3% | 5.6% | 1.1% |
| 50 (45 Pro, 4 HOF, 1 Jackpot hit) | 49 | 1 | 0 | 98% | 2% | 0% |

### UI Implications
- Lobby should sync with backend to show current pool percentages
- Percentages constantly fluctuate as drafts start
- When Jackpot is hit, Jackpot % shows 0% until reset
- Show dynamic percentages only (no perk details in odds display)

### Where Guaranteed Distribution is Displayed
The message "Every 100 drafts contains exactly 1 Jackpot, 5 HOF, and 94 Pro drafts. The order is randomized, but the distribution is guaranteed." appears in:
- **Onboarding Tutorial** - Draft Reveal slide with slot machine visual
- **Drafting Page** - Below the three type cards in empty state
- **Contest Details Modal** - Below the Jackpot/HOF percentage cards
- **Contest Card Tooltips** - "Guaranteed: 1 in every 100 drafts is a Jackpot" / "5 in every 100 drafts are HOF"
- **FAQ Section** - New questions in Jackpot and HOF sections

## Current Draft System
- **Fast drafts:** 30 seconds per pick (currently live)
- **Slow drafts:** 8 hours per pick (PLANNED - not built yet)
- **Players per draft:** 10
- **Draft start:** Immediately when 10/10 players join
- **Format:** Snake draft, team-based positions (draft "DAL WR1" not "CeeDee Lamb")
- **Position slots:** WR1, WR2, RB1, QB, etc. - you draft a team's position slot
- **How it works:** You get the highest scoring player from that team's position each week (e.g., DAL WR1 = best of CeeDee, Pickens, etc.)

## Technical Setup
- **Frontend:** Next.js 14 (App Router) - this repo
- **Backend:** Existing separate system (handles actual drafts)
- **Current state:** Frontend uses mock data, needs API integration
- **Mock data location:** `/lib/mockData.ts` (designed to be swapped with real APIs)

## Design Preferences
- Apple-like aesthetic (clean, minimal, premium)
- Dark theme with subtle glows
- Smooth animations with proper easing
- No clutter - let the UI breathe
- Yellow/banana brand color: #fbbf24
- Avoid generic "AI look" - make it distinctive
- Glassmorphism effects: backdrop-blur, subtle borders, inner highlights, soft shadows
- No empty space in the middle of cards/rows - disperse content throughout
- Use icons over text labels where universally understood (e.g., grid/list toggle)

### Tailwind Custom Colors (tailwind.config.ts)
Colors are correct as of the polish pass:
- `jackpot`: `#ef4444` (red)
- `hof`: `#D4AF37` (gold)
- `pro`: `#a855f7` (purple)
- Glow variants: `jackpot-glow`, `hof-glow`, `pro-glow`

### CSS Utility Classes (globals.css)
- `.glow-jackpot` / `.glow-hof` / `.glow-pro` / `.glow-banana` — standardized box-shadow glows
- `.hof-gold-filter` — `sepia(100%) saturate(400%) brightness(110%) hue-rotate(10deg)` for HOF logo
- `.glass-card` — unified glassmorphism: `bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-2xl` + shadow

## Key Features Built
1. **Pack Opening Reveal** - Hold to open pack, reveals draft type with animations
2. **Drafting Page** - Card-based layout with Cards/List view toggle (icon buttons)
3. **Onboarding Tutorial** - 10-step interactive guide for new users with slot machine explanation and guaranteed distribution info. Triggers on first sign-in only (checks `hasSeenOnboarding` in localStorage)
4. **Exposure Tracking** - Track player/team exposure across drafts (multiple views)
5. **Type Column** - Shows Jackpot/HOF/Pro or "Unrevealed" for filling drafts
6. **Exit Draft** - Leave a filling draft with confirmation modal, returns draft pass
7. **Unified Draft Room** - All-in-one room: filling → slot machine reveal → drafting (replaces separate lobby)
8. **Guaranteed Distribution Display** - Shows "Every 100 drafts contains exactly 1 Jackpot, 5 HOF, 94 Pro" across the site
9. **VRF Verification UI** - Mock UI for Chainlink VRF (Verifiable Random Function) proof system
10. **Draft Room Chat** - Text and voice chat for players in draft room (collapsible, with unread badges)
11. **Batch Progress Indicator** - Header component showing current batch progress (X/100), Jackpot remaining, HOF remaining with color-coded status
12. **Minimal Home Page** - Removed stats section and "How It Works" section for cleaner experience
13. **Unified Entry Flow Modal** - Single 2-step modal for pass type + speed selection (replaces 2 separate modals)
14. **Shared Draft Type Constants** - Single source of truth in `/lib/draftTypes.ts` for colors, labels, odds across the site
15. **Modal Stack Hook** - Stack-based modal management (`useModalStack`) replacing individual boolean states

## VRF Verification (Chainlink VRF)
**Status: UI MOCKED** ✅ (needs backend integration)

Proves fairness of randomness using Chainlink VRF (Verifiable Random Function). Users can verify that draft type selection and draft order were truly random.

### Components
- `/components/ui/VerifiedBadge.tsx` - Small "Verified" badge with tooltip
- `/components/modals/VerificationModal.tsx` - Detailed proof modal with Summary/Technical tabs

### Where Verified Badges Appear
- **Top bar**: Next to draft type badge (e.g., "JACKPOT ✓ Verified")
- **Pick position**: Next to "Your pick position: #X"
- **Slot machine result**: Next to the revealed draft type after spin

### Badge Behavior
- Hover: Shows tooltip with proof details (chain, block, TX hash, time)
- Click: Opens block explorer (Basescan for Base chain)

### Verification Modal Tabs
**Summary Tab**:
- Draft type result or pick position
- Chain name (Base)
- Block number
- Transaction hash
- "View on Basescan" button

**Technical Tab**:
- VRF Request ID
- Random Seed
- VRF Proof
- Random Words (raw output)
- "How to Verify" explanation
- Links to TX and Chainlink VRF docs

### What Gets Verified
| Event | Type | Description |
|-------|------|-------------|
| Draft Type Reveal | `draft-type` | Jackpot/HOF/Pro assignment |
| Draft Order | `draft-order` | Your pick position (1-10) |
| Team (future) | `team` | NFT team verification |

### Backend Requirements (Future)
- Chainlink VRF integration on Base chain
- Store VRF proof data: txHash, blockNumber, requestId, seed, proof, randomWords
- API endpoint to fetch proof for any draft/event

## Batch Progress Indicator (Header)
**Status: BUILT** ✅ (uses mock data, needs backend integration)

Shows current batch progress in the header, visible on all pages. Since JP/HOF percentages were removed from ContestCard, this is now the primary place users see remaining Jackpots/HOF.

### Location
- `/components/layout/Header.tsx` - `BatchProgressIndicator` component
- Positioned before Draft Passes ticket in header right-side icons

### Mechanics
- Every 100 drafts = 1 batch
- 1 Jackpot guaranteed per batch (random position)
- 5 HOF guaranteed per batch (random positions)
- Batch resets after 100 drafts

### Display
```
[████████░░] 80/100
🔥 JP: 1 left | 🏆 HOF: 2 left
```

### States
| Jackpot | Display |
|---------|---------|
| Remaining | `🔥 JP: 1 left` (red text #ef4444) |
| Hit | `🔥 JP: Hit! ✓` (green text) |

| HOF | Display |
|-----|---------|
| Remaining | `🏆 HOF: X left` (gold text #D4AF37) |
| All Hit | `🏆 HOF: All 5! ✓` (green text) |

### Hover Tooltip
- "Draft X of 100 in this batch"
- "Jackpot must hit in next X drafts!" (if remaining)
- "X HOF guaranteed in next X drafts!" (if remaining)
- "Batch resets after 100 drafts"

### Mock Data (Replace with API)
```typescript
const batchProgress = {
  current: 80,
  total: 100,
  jackpotRemaining: 1,  // 0 or 1
  hofRemaining: 2,      // 0-5
};
```

### Backend Requirements (Future)
- API endpoint to get current batch state
- Real-time updates when drafts complete
- Track: current draft number, jackpot hit status, HOF remaining count

## Slot Machine Design (Used in Draft Room)
- **3 reels** with purple gradient background (#a78bfa → #8b5cf6 → #7c3aed)
- **Symbols**: JACKPOT (red text), HOF (gold text), Banana emoji (pro)
- **Apple-like cabinet**: Dark, minimal, premium feel
- **Horizontal lines** between each symbol row
- **Center highlight** when reels stop (white glow on middle row)

### Win Logic
- **3 Jackpots** = JACKPOT win (1% base odds per reel)
- **3 HOFs** = HOF win (5% base odds per reel)
- **Any other combo** = PRO (regular draft, 94% base odds per reel)
- **Never 3 bananas** - always at least one jackpot or HOF in the mix

### Celebration Effects
- **JACKPOT**: Screen shake, red flash, confetti, win fanfare
- **HOF**: Screen shake, gold flash, confetti, win fanfare
- **PRO**: No celebration, just shows "Pro Draft"

### Testing Slot Machine
To test specific outcomes in `/app/draft-room/page.tsx`, replace `generateReelResults()`:
```typescript
const reelResults: DraftType[] = ['jackpot', 'jackpot', 'jackpot']; // Force jackpot
const reelResults: DraftType[] = ['hof', 'hof', 'hof']; // Force HOF
const reelResults: DraftType[] = ['pro', 'jackpot', 'pro']; // Force PRO (mixed)
```

## Draft Room Flow (Unified - No Separate Lobby)
**Status: BUILT** ✅

Users go directly from contest card → draft room (`/app/draft-room/page.tsx`), which handles filling, reveal, and drafting all in one place. The separate lobby is deprecated.

### URL Parameters
The draft room accepts these URL params:
- `id` - Draft ID
- `name` - Contest name
- `speed` - "fast" or "slow"
- `players` - Initial player count (e.g., entering a 7/10 draft shows 7 players already there)
- `type` - Draft type if already revealed (jackpot/hof/pro)

### User Flow
1. **Enter from Contest Box** - User clicks Enter → goes directly to `/draft-room` with `players` param
2. **Filling Phase** - Draft board visible immediately (Underdog-style), starts with correct player count
   - Explainer: "Room fills → Draft type revealed — Jackpot, HOF, or Pro → Draft begins"
   - Your slot: Shows your profile picture + username (yellow)
   - Other joined players: 🍌 emoji only (no text)
   - Empty slots: Faded 🍌 emoji
   - Big centered display: "X/10" with "Waiting for players..."
3. **10/10 Players Joined** - Two timers start
   - **Main countdown**: 60 seconds until draft starts (big, prominent)
   - **Reveal countdown**: 15 seconds until slot machine (smaller, below)
   - Draft order randomized, user position shown
4. **Reveal Countdown Hits 0** - Slot machine overlay appears
   - 3-reel slot machine animation (~6 seconds, reels stop at 2s, 4s, 6s)
   - Main countdown continues running during animation
   - X button appears after animation to close overlay
   - Click outside overlay to close (only after animation done)
   - Auto-closes at 15 seconds remaining on main timer
5. **Post-Reveal** - Background color changes for Jackpot (red) or HOF (gold)
   - Screen shake + continuous word rain (JACKPOT or HOF) until 15 seconds remaining
   - Confetti effect
6. **Draft Starts** - Main timer hits zero → drafting phase begins

### Slot Machine Overlay Details
- **Main countdown**: Visible inside overlay, continues counting down
- **Close options**: X button (top-right) or click outside (only after animation)
- **Auto-close**: At 15 seconds remaining
- **Result display**: Draft type with perks explanation
  - Jackpot: "Skip to the Finals" - win league and bypass 2 weeks of playoffs
  - HOF: "Bonus Prizes" - additional prizes on top of regular rewards
- **Celebration**: Screen shake, confetti, word rain for Jackpot/HOF (stops at 15s remaining)

### File Location
- `/app/draft-room/page.tsx` - Orchestrator (~600 lines, decomposed from 1224)
- `/components/drafting/DraftBoard.tsx` - Draft grid component
- `/components/drafting/SlotMachineOverlay.tsx` - Slot machine overlay
- `/components/drafting/PositionPicker.tsx` - Position picker modal
- `/hooks/useDraftAudio.ts` - Sound effects hook
- `/lib/draftRoomConstants.ts` - Constants, types, helpers
- Routes changed from `/draft-lobby` to `/draft-room` in:
  - `/app/page.tsx`
  - `/app/drafting/page.tsx`

## Planned Features (Not Yet Built)
1. **Slow Drafts** - 8 hour pick timer, needs notifications + pre-queue system
2. **Backend Integration** - Connect to real draft APIs
3. **Real-time Updates** - Live draft data instead of mock data

## File Structure Notes

### Pages
- `/app/draft-room/page.tsx` - **Main unified draft room** (filling → reveal → drafting), orchestrator using extracted components
- `/app/drafting/page.tsx` - My Drafts page with DemoCard, DemoListRow components
- `/app/page.tsx` - Home page (minimal: ContestCard + PromoCarousel + Footer + Onboarding trigger)
- `/app/buy-drafts/page.tsx` - Buy draft passes page

### Shared Constants & Types
- `/lib/draftTypes.ts` - **Single source of truth** for draft type colors, labels, odds (`DRAFT_TYPE_COLORS`, `getDraftTypeColor()`)
- `/lib/draftRoomConstants.ts` - Draft room constants: `ALL_POSITIONS`, `DRAFT_PLAYERS`, `DRAFT_TYPES`, `getPositionColor()`, `generateReelResults()`, `Pick` interface
- `/lib/mockData.ts` - Mock data for all pages (replace with real APIs)

### Hooks
- `/hooks/useAuth.tsx` - Auth system (auto-login for testing)
- `/hooks/useDraftAudio.ts` - AudioContext-based sound effects for draft room (spinning, reel stop, countdown, win)
- `/hooks/useDraftStage.ts` - Shared draft stage cycling/timer/animation logic (used by DemoCard, DemoListRow)
- `/hooks/useCountdown.ts` - Reusable countdown timer logic
- `/hooks/useModalStack.ts` - Stack-based modal management (`push/pop/replace/closeAll/isOpen`)
- `/hooks/useBatchProgress.ts` - Batch progress tracking for header indicator

### Layout Components
- `/components/layout/Header.tsx` - Header with batch progress indicator
- `/components/layout/BatchProgressIndicator.tsx` - Batch progress (X/100), Jackpot remaining, HOF remaining

### Draft Room Components (extracted from draft-room/page.tsx)
- `/components/drafting/DraftBoard.tsx` - Draft grid with player headers + pick cells (snake draft board)
- `/components/drafting/SlotMachineOverlay.tsx` - Slot machine 3-reel animation + result display overlay
- `/components/drafting/PositionPicker.tsx` - Position selection modal for making draft picks

### Other Drafting Components
- `/components/drafting/PackReveal.tsx` - Pack opening animation (hold to reveal draft type)
- `/components/drafting/SlotMachineReveal.tsx` - Slot machine reveal component (used in drafting page)
- `/components/drafting/DraftRoomChat.tsx` - Chat/voice panel for draft room (collapsible)
- `/components/drafting/DraftLobby.tsx` - Old lobby (deprecated, kept for reference)

### Modal Components
- `/components/modals/EntryFlowModal.tsx` - Unified 2-step modal: pass type + draft speed selection
- `/components/modals/VerificationModal.tsx` - Detailed VRF proof modal

### UI Components
- `/components/ui/VerifiedBadge.tsx` - VRF verification badge with tooltip

### Assets
- `/public/jackpot-logo.png` - Jackpot logo (red)
- `/public/hof-logo.jpg` - HOF logo (red, display as gold with `.hof-gold-filter`)

## Brand Assets
- Jackpot logo: Red gradient text on black
- HOF logo: Red stamp-style badge (apply gold filter: `sepia(100%) saturate(400%) brightness(110%) hue-rotate(10deg)`)
- SBS logos in `/public/sbs-logo.*`

## Onboarding Tutorial (`/components/onboarding/OnboardingTutorial.tsx`)
**Status: BUILT** ✅

### Trigger Behavior
- **Triggers on first sign-in only** - not on first visit
- Checks `hasSeenOnboarding` in localStorage
- Only shows when `isLoggedIn` is true AND flag is not set
- Sets flag after user completes or dismisses tutorial
- Logged-out visitors don't see the tutorial

### Slides (10 total)
1. **Intro** - "Fantasy Football Evolved" welcome screen
2. **Contest** - Banana Best Ball IV details ($100k prize pool, $25 entry)
3. **Best Ball** - Draft-and-done format explanation
4. **Team Positions** - Draft KC QB not Patrick Mahomes
5. **Injury Protection** - "One injury can destroy your season — Not Here."
6. **Draft Reveal** - Slot machine visual showing Jackpot example with guaranteed distribution
7. **Banana Wheel** - Spin for free drafts, Jackpot entries, HOF entries
8. **Marketplace** - NFT teams you can buy/sell
9. **USDC Prizes (Base)** - Stablecoin prize pools paid in USDC on Base
10. **Ready** - "You're ready. Draft smart. Win big."

### Layout
- Fixed full-screen overlay with flex-col layout
- Scrollable content area with `pt-24 pb-12` padding
- Fixed progress dots at bottom (`py-5`)
- Back/Next buttons on all slides (except first has no Back)
- Close X button in top-right corner

### Slot Machine Visual (Draft Reveal Slide)
- 3 reels showing varied symbols (not all same on top/bottom rows)
- Example shows Jackpot win in center row
- Explains each draft type:
  - **Jackpot (1%)**: Win your league and skip to the finals
  - **HOF (5%)**: Compete for bonus prizes on top of regular rewards
  - **Pro (94%)**: Standard draft
- Guaranteed distribution box at bottom

## Testing Notes
- Draft type odds are set to 33% each for testing (see PackReveal.tsx)
- Change back to real odds (1%/5%/94%) before production
- Test draft reveal: Go to /drafting → click Enter on 10/10 draft → hold pack

## API Integration Notes (For Future)
When connecting to real backend:
1. Replace mock data in `/lib/mockData.ts` with API calls
2. Draft rooms need: id, contestName, players, maxPlayers, status, type, draftSpeed
3. Exposure data needs: player picks, team exposure percentages
4. User auth already stubbed in `/hooks/useAuth.ts`

## Owner Preferences
- Wants addictive UX (pack opening > slot machine for engagement)
- Values premium feel over flashy
- Iterates quickly - build then refine
- Existing product works - this is enhancement, not rebuild

## Product-Market Fit & Competitive Advantages

### Problems in Best Ball Fantasy (Industry-Wide)
1. **Illiquidity** - Once drafted, users are stuck with their team
2. **Injury devastation** - One key injury can eliminate a team entirely
3. **Fixed prizes** - USD prizes don't appreciate
4. **Boring entry** - Pay, draft, done. No excitement.
5. **High barrier** - Expensive to enter meaningfully
6. **Late-season disengagement** - Users forget about teams after drafting
7. **Trust issues** - Centralized platforms control odds/outcomes

### How SBS Solves These

| Problem | SBS Solution |
|---------|--------------|
| Illiquidity | **NFT Teams on OpenSea** - Buy, sell, trade teams anytime. Recoup value from bad teams, buy contenders mid-season. *No other platform does this.* |
| Injury devastation | **Team Positions Format** - Draft "KC QB" not "Patrick Mahomes". Backup players count. Users are *always in it*. |
| Fixed prizes | **USDC Prize Pools (Base)** - Stablecoin prize pools paid in USDC on Base. |
| Boring entry | **Pack Reveal + Jackpot/HOF** - 1% Jackpot chance creates real excitement. Gamified reveal animation. |
| High barrier | **Banana Wheel + Free Drafts** - Easy onboarding, low risk entry. |
| Trust issues | **Onchain** - Verifiable randomness, transparent odds. |

### Key Differentiators to Emphasize
- **"Never out of it"** - Team positions protect against injuries
- **"Your team, your asset"** - NFT ownership + OpenSea liquidity
- **"Win in USDC"** - Stablecoin prizes paid in USDC on Base
- **"Every entry could be THE one"** - Jackpot/HOF excitement

### Additional Opportunities
1. Weekly "still alive" notifications to combat late-season disengagement
2. Show case studies: teams that would be dead on Underdog but alive on SBS
3. Display trading volume / average resale values to prove liquidity
4. Emphasize stable USDC payouts on Base (no ETH price narrative)

## User Segments

| Segment | Description | Needs |
|---------|-------------|-------|
| **Web3 + Best Ball** | Ideal customer. Plays Underdog, has crypto | Team positions explainer, NFT liquidity as bonus |
| **Web3 + No Best Ball** | Crypto native, new to best ball | Best ball 101 + team positions |
| **Web2 + Best Ball** | Underdog/Sleeper player, no crypto | Team positions, zero crypto friction |
| **Web2 + No Best Ball** | Traditional fantasy or new | Full onboarding, simplest flow |

**Universal Hook**: Team Positions - "Draft KC QB, not Patrick Mahomes. Injuries don't kill your team."

**Key Principle**: Product should feel like polished web2 fantasy app with web3 superpowers under the hood. Web2 users never need to know it's crypto. Web3 users can access everything.

## Payment System

**Entry Fee**: $25 fixed (**paid in USDC on Base**)

**Payment Methods**:
- Card (Coinbase Onramp via Privy → purchases USDC on Base)
- Crypto wallet transfer: **USDC (Base)**

**Payment Flow (USDC on Base)**:
1. User selects USDC (Base)
2. Connects wallet / opens Privy wallet
3. Pays $25 in USDC on Base
4. System mints/sends the Base NFT (draft pass) to their wallet
5. Credits awarded to account

**Withdrawal Methods**:
- Bank/card (Coinbase Offramp)
- Direct to wallet: **USDC (Base)**

**UX Note**: All users see the same UI regardless of login method (no web2/web3 differentiation).

### Card Payment Implementation (Coinbase Onramp)
**Status: CODE DONE** — Dashboard config pending (needs CDP API keys)

**Files changed:**
- `lib/contracts/bbb4.ts` — Added `getUsdcBalance(address)` utility
- `components/modals/BuyPassesModal.tsx` — Coinbase preferred provider, USDC polling, flow steps
- `providers/PrivyProvider.tsx` — Added `fundingMethodConfig`

**Card flow:**
1. User selects "Card / Apple Pay" → clicks Buy
2. `fundWallet()` opens Coinbase Onramp popup (not MoonPay)
3. User completes payment → popup closes
4. Poll USDC balance every 3s (max 2 min) — "Waiting for USDC..."
5. Balance sufficient → approve USDC + mint NFT (gas sponsored)
6. Success → transition to pick-speed phase

**Dashboard setup needed:**
- Privy Dashboard → Account Funding → Enable Coinbase Onramp
- Requires CDP API Key ID + Private Key from portal.cdp.coinbase.com
- Key format: Privy says ECDSA PEM; CDP may offer Ed25519 — try ECDSA first
- If settings won't save: try Configuration > Integrations tab instead

## Deployment & Infrastructure
**Status: LIVE on staging**

- **Frontend**: Vercel at `banana-fantasy-sbs.vercel.app`
- **Drafts API**: Cloud Run at `sbs-drafts-api-staging-652484219017.us-central1.run.app`
- **WebSocket**: Cloud Run at `sbs-drafts-server-w5wydprnbq-uc.a.run.app`
- **Firebase**: `sbs-prod-env` project
- Currently all Vercel traffic routes to staging Cloud Run backend
- Staging mode: `?staging=true` param (persists in sessionStorage)

## API Layer (`lib/api/`)
**Status: BUILT** — wired to real backend

- `client.ts` — Base HTTP client
- `config.ts` — URL configuration
- `leagues.ts` — League join, batch progress, bot filling
- `owner.ts` — User profile CRUD
- `drafts.ts` — Draft state
- `websocket.ts` — Real-time draft updates
- `firebase.ts` — Firebase Realtime DB

## Drafting Page UX Decisions
- **Most users have 1 draft** at a time, maybe a few slow drafts at most
- **Type is UNKNOWN until draft fills** - You cannot know if it's Jackpot/HOF/Pro until 10/10 players join
- **Filling drafts**: Show yellow accent (unrevealed), display player count
- **Revealed drafts**: Show type with color + badge (JACKPOT/HOF/PRO)

### Draft Sorting Rules (IMPORTANT)
Drafts are sorted by urgency - most urgent at top:
1. **Your turn drafts** - You're on the clock, needs immediate action
2. **In-progress drafts** - Sorted by picks away (1 pick away before 5 picks away)
3. **Filling drafts** - Sorted by join time (oldest first, newest at bottom) — new drafts start at the bottom and bubble up as they become urgent

### Status Display
- **Your turn**: Show countdown timer (e.g., "22s left to pick!")
- **Waiting**: Show "X picks away"
- **Filling**: Show "X/10 joined"

### UI Rules
- Button always visible (not just on hover)
- **Your turn drafts**: Yellow border + yellow background tint + "Pick Now" button (yellow)
- **Filling drafts**: Clickable "Enter" button (white with black text) - takes you to draft room with current player count
- Fixed-width buttons (w-20) so "Pick Now" and "Enter" are same size
- No emojis/icons in draft rows - keep it clean, start with contest name

### Draft Type Naming
- **Pro** pairs well with **Hall of Fame** (sports theme progression)
- **Jackpot** is the exciting wildcard (casino/gambling themed - stands out)
- Considered "Classic" but Pro has better thematic consistency with HOF

## Buy Drafts Page (`/app/buy-drafts/page.tsx`)
**Status: BUILT** ✅

### Layout
- Two-column layout on desktop (selection left, order summary right)
- Full width max-w-5xl container
- Spin promo banner at top (hero position, very prominent)

### Pricing
- **$25 per draft** (fixed USD price)
- Quantity options: 1, 5, 10, 20, 30, 40
- Custom quantity input (no spinner arrows)

### Spin Promo (Buy 10 Get 1 Free Spin)
- Hero banner at top of page - can't miss it
- Progress bar showing X/10 toward next spin
- Banana Wheel spin earned for every 10 drafts purchased
- When quantity >= 10, shows "Free spins included: +X" in quantity section

### Payment Methods
- Crypto: **USDC (Base)**
- Card (Visa, Mastercard)
- Selectable with visual feedback

### Order Summary (Right Column)
- Sticky on scroll
- Shows: Draft Passes count, Price per Pass ($25), Total
- Big yellow "Buy X Drafts" button

## Drafting Page (`/app/drafting/page.tsx`)
**Status: BUILT** ✅

### Active Drafts Display - Row Layout
Two-column layout: drafts on left, promos sidebar on right.

**Draft Row Columns** (evenly spaced with `justify-between`, fixed widths for alignment):

| Element | Width | Alignment | Content |
|---------|-------|-----------|---------|
| Name | w-20 | left | "BBB #142" |
| Speed | w-16 | center | "30 sec" or "8 hour" |
| Type | w-28 | center | "PRO", "HALL OF FAME", "JACKPOT" or "Unrevealed" |
| Status | w-28 | center | Progress bar + X/10, or "X picks away", or "Xs" with pulse |
| Button | w-20 | right | "Enter" (grey) or "Pick Now" (yellow, pulsing) |

### Row Styling
- Left accent bar (3px) with type color
- Left gradient based on type color (fades to transparent)
- **Your turn rows**: Yellow border (`border-2 border-banana`) + yellow background tint (`bg-banana/10`)
- Small progress bar (w-12) for filling drafts
- Padding: px-5 py-3
- Tight spacing between rows (space-y-1.5)
- No dividers - use `justify-between` for even spacing

### Button Styling
- **Filling drafts**: White button with black text (`bg-white text-black`) - clickable, goes to draft room
- **Your turn**: Yellow button with black text (`bg-banana text-black`) - "Pick Now"
- **In progress (not your turn)**: Type-colored button - "Enter"

### Join Timestamp Tooltip
- Drafts you enter save a `joinedAt` timestamp
- Hover over contest name to see "Joined X ago" (e.g., "Joined 5 min ago", "Joined just now")
- Uses `formatRelativeTime()` helper function
- Only shows on drafts with timestamps (not demo drafts)

### Sequential BBB Numbering
- New drafts get sequential BBB numbers (BBB #145, #146, #147, etc.)
- System finds highest existing number from localStorage + demo drafts, then increments
- Uses `getNextBBBNumber()` helper function
- Demo drafts are BBB #142 and #144, so new drafts start at #145

### Demo Drafts (For Testing)
Currently only 2 demo drafts for cleaner testing:
- **BBB #142** - Filling (7/10), Pro type
- **BBB #144** - Your turn, Pro type, 22s remaining

To clear user drafts: `localStorage.removeItem('banana-active-drafts')`

### Promos Sidebar (Right)
- Width: w-56, hidden on mobile (`hidden lg:block`)
- Shows first 4 promos vertically stacked
- Cards match home page style: light bg (#fbfbfd), dark text, rounded-[16px]
- Progress bars, claim buttons same as PromoCarousel
- Hover: banana border glow

### Empty States (Active Tab)

**When user has 0 Draft Passes:**
- Shows contest info card with red warning "You have 0 Draft Passes"
- Displays: Banana Best Ball 4, $100k prize pool, odds (94% Pro, 5% HOF, 1% Jackpot)
- Entry info: 1 Draft Pass, 10 players, 30 second timer
- "Buy Draft Pass" button → routes to /buy-drafts

**When user HAS Draft Passes but 0 active drafts:**
- Same contest info card with yellow "You have X Draft Passes"
- "Join a draft to start playing" message
- "Join Draft" button → enters draft room

### Completed Tab Empty State
- Clean empty state with checkmark icon
- "No Completed Drafts" message
- "Finished drafts will appear here" subtext

### Draft Syncing
- Active drafts persist to localStorage (`banana-active-drafts`)
- Completed drafts persist to localStorage (`banana-completed-drafts`)
- When user joins a draft, it saves to localStorage and shows in drafting page
- To clear drafts for testing: tell Claude "clear my drafts"

### Draft Type Generation
- Random type assigned when joining: 94% Pro, 5% HOF, 1% Jackpot
- Based on real odds from guaranteed distribution system

## Buy Drafts Page Banana Wheel Icon
- Custom SVG matching actual Banana Wheel design
- 12 segments with real colors (gray, green, red, purple, gold, orange)
- SBS logo in center
- Yellow/banana glowing border

## Home Page (`/app/page.tsx`)
**Status: MINIMAL & CLEAN** ✅

### Structure (After Cleanup)
1. **ContestCard** - Prize pool, 1st place, entry fee, Enter button (no JP/HOF percentages)
2. **PromoCarousel** - Scrolling promo cards
3. **Footer** - Copyright, Terms, Privacy, Support, Discord links

### Removed Sections
- ~~Stats Section~~ - "$2.5M+ Prizes Paid", "50K+ Active Players", etc.
- ~~How It Works~~ - 3-step cards explaining the platform

### JP/HOF Display
- **Removed from ContestCard** - No longer shows percentages in top-right corner
- **Moved to Header** - BatchProgressIndicator shows batch progress and remaining JP/HOF
- Users can still see JP/HOF details in Contest Details Modal (info button)

### First-Time User Flow
1. User visits site → sees clean minimal page (no tutorial for logged-out users)
2. User signs in for the first time → Onboarding Tutorial pops up
3. User completes/dismisses tutorial → `hasSeenOnboarding` flag set
4. Future visits → straight to clean page

## No Passes Modal (Home Page)
When user tries to enter draft with 0 passes:
- Modal pops up: "No Draft Passes" with ticket emoji
- "You need a draft pass to enter. Buy one to join the action!"
- Cancel and "Buy Passes" buttons

## Pass Type Selection (`/components/modals/PassTypeModal.tsx`)
**Status: BUILT** ✅

When entering a draft, users choose which pass type to use:
- **Paid Pass** - Purchased draft passes (yellow/banana themed)
- **Free Pass** - From promos & rewards (green themed)

### Flow
1. User clicks Enter on a draft
2. If user has BOTH paid and free passes → PassTypeModal appears
3. If user has only one type → auto-selects and continues
4. Selected pass is deducted when entering draft room

### UI
- Shows count of each pass type
- Disabled state for pass types with 0 available
- Appears before speed selection (home page) or directly enters (drafting page)

## Auth System
- **Auto-login enabled** for testing - user is always signed in on page load
- Profile persists to localStorage (username, profile picture, NFL team)
- Located in `/hooks/useAuth.tsx`
- Default user: 5 paid passes, 3 free drafts

## Testing Helpers
- **Clear drafts**: Run in browser console: `localStorage.removeItem('banana-active-drafts')`
- **Change passes**: Tell Claude to set specific pass count
- Mock user data in `/lib/mockData.ts`
- Demo drafts defined in `/app/drafting/page.tsx` around line 550

## FAQ Updates (`/lib/mockData.ts`)
Added new FAQ questions:
- **Jackpot Drafts section**:
  - "How does the guaranteed distribution work?" - Explains every 100 drafts system
  - "What do I get if I win a Jackpot draft?" - Skip to finals perk
- **HOF Drafts section**:
  - "What are the odds of getting a HOF draft?" - 5% with guaranteed distribution

## Backend Repositories (Downloaded)

### Repository Locations
All repositories are located at `/Users/borisvagner/`:
1. **sbs-draft-web-main** - Old Next.js frontend (reference for API integration)
2. **sbs-drafts-api-main** - Go API for draft management
3. **SBS-Football-Drafts-main** - Go WebSocket server for real-time drafting
4. **SBS-Backend-main** - Firebase Cloud Functions & admin scripts

### API Documentation
See `/API_INTEGRATION.md` for complete API documentation including:
- All API endpoints and data structures
- WebSocket events and real-time communication
- Authentication flow (wallet-based)
- Smart contract integration
- How to replace mock data with real APIs

### API Endpoints (Production)
- **Drafts API**: `https://sbs-drafts-api-w5wydprnbq-uc.a.run.app`
- **WebSocket Server**: `wss://sbs-drafts-server-w5wydprnbq-uc.a.run.app`
- **Firebase Realtime DB**: `https://sbs-prod-env-default-rtdb.firebaseio.com`

### Key Integrations Needed
1. **Owner API** - Get user profile, draft passes, update profile
2. **League API** - Join drafts, get leaderboards, leave drafts
3. **Draft API** - Get draft state, rosters, player rankings
4. **WebSocket** - Real-time draft updates (picks, timers, completion)
5. **Firebase Realtime DB** - Live player counts in drafts
6. **Web3Auth** - Wallet authentication (MetaMask primary)
7. **OpenSea API** - NFT profile pictures
8. **Smart Contract** - Minting draft passes (0x2BfF6f4284774836d867CEd2e9B96c27aAee55B7)

### Environment Variables Required
```
NEXT_PUBLIC_ENVIRONMENT=prod
NEXT_PUBLIC_DRAFTS_API_URL=https://sbs-drafts-api-w5wydprnbq-uc.a.run.app
NEXT_PUBLIC_DRAFT_SERVER_URL=wss://sbs-drafts-server-w5wydprnbq-uc.a.run.app
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=
NEXT_PUBLIC_INFURA_KEY=
NEXT_PUBLIC_OPENSEA_API_KEY=
NEXT_PUBLIC_THIRDWEB_CLIENT_ID=
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_AUTH_DOMAIN=
NEXT_PUBLIC_DATABASE_URL=https://sbs-prod-env-default-rtdb.firebaseio.com
NEXT_PUBLIC_PROJECT_ID=sbs-prod-env
NEXT_PUBLIC_STORAGE_BUCKET=
NEXT_PUBLIC_MESSAGING_SENDER_ID=
NEXT_PUBLIC_APP_ID=
NEXT_PUBLIC_MEASUREMENT_ID=
```

### Live Site
- **URL**: https://draft.sbsfantasy.com
- **Status**: Geared for last week of previous season (some empty states)
- **Layout**: Leaderboard-focused with table view for player cards and scores

## Future Tasks (Boris's List)
> Add items here for Claude to help with later. Just tell Claude to "add X to my list" or "show my list".

1. Jackpot promo
2. API Integration - Replace mock data with real backend APIs
3. Web3Auth setup - Implement wallet authentication
4. WebSocket integration - Real-time draft updates
