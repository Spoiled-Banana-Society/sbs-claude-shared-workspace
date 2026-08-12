# KFFL private-league entry cap + commissioner admin view (2026-08-12)

Ticket-3338 follow-up. Tjbonitz flagged the hole in the shared-password design:
a member with spare SBS passes could take a SECOND KFFL seat without paying him
his league fee. Fix shipped in two parts:

## Go (rev after 00194 — synced here)
- `PrivateLeagueConfig` gains `DefaultEntries` (0 = 1), `Entries` map
  (lowercase wallet → allowed seats; explicit 0 blocks), `AdminWallets`.
- `seatTokenInLeagueTx` takes `privateMaxEntries`; for private joins it counts
  the wallet's ACTUAL seats across the league's drafts with a query inside the
  seat transaction and rejects over-cap with
  `no entries left for this private league — ask your commissioner for another entry`
  (frontend matches this string in useEnterDraft — change both together).
  Public/bot callers pass 0, nothing changes for them.
- Seats-as-truth means no counter doc, nothing to seed, nothing to drift.

## Frontend
- `/private/[id]/admin` — commissioner page: rosters per league ("KFFL #1…",
  never internal draft ids), per-member "used X / allowed Y", +1/−1 bumps, and
  pre-authorize-by-wallet. Server-gated via `/api/private-league/[id]/admin`:
  league config's `AdminWallets` OR site admins (requireAdmin). Bumps audit to
  `v2_admin_actions` as `private-league-bump`.
- `scripts/set-private-league-admins.mjs <id> <wallet…>` seeds AdminWallets.

## State
- KFFL `AdminWallets` is EMPTY for now → team-only. Richard reviews first;
  Tjbonitz's wallet (0xc166d9089D7EA2bfB11e239b504780b1E84e8c8a — has never
  signed in yet, no owners doc) gets added after Richard's go.
