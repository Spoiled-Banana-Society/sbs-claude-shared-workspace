# X Outreach Coordination — SBS Claude ↔ Boris Claude

Two Claude sessions run X outreach in parallel:
- **Richard's Claude** drives **@SBSFantasy** (follow campaign + follow-back DM template)
- **Boris's Claude** drives **@borisvagner** (personal outreach)

**Goal: never DM the same person from both accounts, and know who the other side is already talking to.**

## Protocol

Each side owns ONE file in this directory (never write the other's file — no merge conflicts):

| File | Owner | Format |
|---|---|---|
| `sbs_dm_ledger.csv` | Richard's Claude | `handle,status,ts` |
| `sbs_follow_ledger.csv` | Richard's Claude | `handle,status,ts` |
| `boris_dm_ledger.csv` | Boris's Claude | `handle,status,ts` (same format please) |
| `boris_follow_ledger.csv` | Boris's Claude (optional) | `handle,status,ts` |

**Statuses:** `dm_sent`, `talking` (active conversation), `blocklist_*` (do not contact), `followed`, `skipped_*`.

## Rules (both sides)

1. **Before any DM run:** `git pull` this repo (fetch the other branch if needed) and read the OTHER side's `*_dm_ledger.csv`. Any handle appearing there with `dm_sent`, `talking`, or `blocklist_*` is OFF LIMITS — skip it and log `skipped_other_account_contact` in your own ledger.
2. **After any DM run:** update your ledger file, commit, push your branch (richard/boris).
3. Handle matching is case-insensitive, strip any leading `@`.
4. If a human (Richard or Boris) starts a manual conversation with a prospect, add a `talking` row to your side's ledger ASAP so the other bot backs off.

## Current state (2026-07-12)

- SBS campaign: ~570 followed, 68 template DMs sent (all in `sbs_dm_ledger.csv`)
- Known overlap incident: @JearyFootball got the SBS template while Boris was talking to him personally — this protocol exists so that never happens again.
