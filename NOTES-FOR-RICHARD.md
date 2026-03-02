# Notes for Richard — March 2, 2026

## What Changed

### 1. Twitter/X Verification (Phase 1) — NEW
Full anti-sybil Twitter verification system using Firestore.

**API: `/api/auth/verify-twitter`**
- `POST` — Links a Twitter account to a wallet (anti-sybil: one Twitter per wallet)
- `GET?walletAddress=0x...` — Checks if wallet has a verified Twitter link
- `PATCH` — Marks the new-user promo as claimed for a wallet

**Flow:**
1. User logs in → `useAuth` checks Privy linkedAccounts for Twitter
2. If Twitter already linked via Privy → auto-verifies with backend (POST)
3. If not linked → user clicks "Connect" in New User promo → Privy OAuth → redirect back → auto-verify
4. Once verified → CLAIM button enables → claim persisted to Firestore

**Files changed:**
- `app/api/auth/verify-twitter/route.ts` — NEW: Firestore-backed API
- `hooks/useAuth.tsx` — Added `isTwitterVerified`, `newUserPromoClaimed`, `claimNewUserPromo`
- `components/modals/PromoModal.tsx` — Login gate for new-user/tweet-engagement promos, persisted claim
- `components/home/PromoCarousel.tsx` — Respects `newUserPromoClaimed` from Firestore
- `lib/db.ts` — Always uses jsonDb (Firestore only for verify-twitter)
- `lib/firebaseAdmin.ts` — Firebase Admin SDK init (uses `FIREBASE_SERVICE_ACCOUNT_JSON` env var)

### 2. Vercel Env Var Fix
`FIREBASE_SERVICE_ACCOUNT_JSON` was re-added as compact single-line JSON (was causing build errors when multi-line).

### 3. db.ts Always Uses JSON DB
Adding the Firebase env var accidentally switched ALL data queries to Firestore (empty collections). Fixed: `db.ts` always uses `jsonDb`. Firestore is only used directly by `verify-twitter` route.

## What Needs Testing

**End-to-end Twitter verification with a fresh account:**
1. Log in with a wallet that has NO Twitter linked in Privy
2. Open the "New Users" promo card → should see "Connect" button
3. Click Connect → Privy Twitter OAuth popup → authorize
4. Return to site → should auto-verify with backend
5. CLAIM button should enable → click it
6. Refresh page → CLAIM button should stay disabled (persisted in Firestore)

Boris's account (@BorisVagner) already had Twitter linked via Privy, so the verification happened automatically on login. Needs testing with a fresh account to confirm the full manual Connect flow.

**Also note:** The wheel spin wasn't working when Boris tested — separate issue, not related to these changes.

## Firestore Collections
- `v2_twitter_links` — documents keyed by Twitter ID, contains `{ twitterId, twitterHandle, walletAddress, linkedAt, newUserPromoClaimed }`
