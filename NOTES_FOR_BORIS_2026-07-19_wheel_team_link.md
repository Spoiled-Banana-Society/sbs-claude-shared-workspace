# Wheel-won JP/HOF NFTs never revealed into teams — fixed frontend-side 7/19, two Go ride-alongs for you

## What was broken (FC ticket-2661)
Fantasy Couch's HOF #10 + #12 (from Wheel) finished but showed a blank placeholder on My Teams — no card, no download. Root cause: the wheel DOES mint a real pass NFT per JP/HOF win (his tokens 651, 1066) and the queue binds each seat to that tokenId, but `join-special-draft`/`create-special-draft` always seat with a fresh synthetic `special-…` token and never touch the NFT. So after the draft: the NFT still reads "Draft Pass" (never revealed), the team card doc has `RealTokenId: ""`, and a leftover `validDraftTokens/{tokenId}` "available pass" doc makes the token classify as an unlistable undrafted free pass.

## What I shipped (frontend, live 7/19)
1. **Backfill** — all 20 seats of the two completed wheel drafts (`2025-slow-draft-3` = HOF #10, `2025-slow-draft-5` = HOF #12) linked: `RealTokenId` set on the card docs, leftover available-pass docs deleted, roster Attributes copied from the `special-…` finalize doc onto the on-chain-id `draftTokenMetadata` key, `marketplace_index` flipped to team/hof, `nft_league_map` written, OpenSea refreshed (20/20 OK). Backups of every touched doc are in my session scratchpad.
2. **`/api/crons/link-wheel-teams`** (every 10 min) — does the same automatically for any token-bound queue seat once its special draft completes. Covers HOF #15 (`2025-slow-draft-11`, mid-draft) and Jackpot #7 (`2025-slow-draft-7`, filling) with zero manual work. Idempotent (`nft_league_map` written last = marker).

## Ride-alongs for your next Go deploy (both small)
1. **Serialize `RealTokenId`** in `/owner/{wallet}/draftToken/all` responses. The Firestore card docs carry it (backfill + cron now set it) but the API drops the field, so the frontend's authoritative `realTokenId` match can't fire and we lean on `nft_league_map` instead. One field in the response struct.
2. **Bind the NFT at seat creation**: have `join-special-draft` / `create-special-draft` accept an optional `tokenId` (frontend `ensureSpecialDraftSeat` has it from the queue member) and set `RealTokenId` on the card it creates + delete the winner's `owners/{wallet}/validDraftTokens/{tokenId}` doc. Then the link is atomic and the cron becomes a pure backstop.

## Also
- Your direct push to sbs-frontend-v2 (`cf03d0ff`, adminAlerts comped-player fix) is reconciled into the workspace (`lib/adminAlerts.ts` synced verbatim) — deploy-order guard caught it, nothing was reverted.
