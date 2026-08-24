# Transferred DRAFTED TEAMS were being re-registered as fresh passes (found 8/24)

**What:** when a drafted team NFT changes wallets (marketplace buy or OTC), the frontend
`reconcile-pass-transfers` cron saw an on-chain token the engine didn't know for the NEW wallet
and POSTed `/owner/{w}/draftToken/mint` for it. The engine's collision-proof registration
re-homed the already-used id under a 19-digit synthetic cardId with `RealTokenId` set, as a
brand-new VALID pass. Net effect: buy a $9 drafted team on the marketplace, get a $25 draft
(tagged PAID for promos). Original drafter keeps the team too.

**Confirmed 13 phantom passes** (prior holder's engine still shows the real id drafted):
- GatorMAB ×6 (marketplace buys): 1081→BBB #742, 2099→BBB #744, plus 4 UNUSED synthetic
  passes still in validDraftTokens: 1786936838069515041 (7971), 1787451319159223120 (8738),
  1787578833158095325 (8698), 1787578833315118787 (9089)
- sdotdfs ×5 (OTC, 8/5 backfill): 815→BBB #534, 3743→#537, 3744→#586, 3745→KFFL #1,
  3747→UNUSED synthetic 1786147540948760683
- AkFF ×1: 9283 (9erFan's #852, bought for $9) → BBB #879
- JonnyCanuck ×1: 4156 (tomalom69's #496) → KFFL #1

**Frontend fix LIVE (sbs-frontend-v2 2066d993):** `reconcilePassesForWallet` now skips any
on-chain id that is already a drafted team (engine card metadata has the roster / marketplace
index says 'team') and logs `reconcile.skip_drafted_team_transfer`. Fails closed.

**Engine-side ask (yours):** `/owner/{w}/draftToken/mint` should refuse (or at least register as
USED, not valid) an id that already exists in ANY owner's usedDraftTokens — the re-home-as-valid
behaviour is what turned a transfer into a free draft. Also: the special-* wheel seats legitimately
wrap a real pass via RealTokenId, so don't key the check on RealTokenId alone.

**Remediation is Richard's call** (delete the 5 unused phantom passes; void or keep the 8 drafts).
Nothing has been changed on any user yet.
