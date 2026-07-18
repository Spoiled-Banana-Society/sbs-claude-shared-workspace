# Discord/X fill-bot: template experiment tonight (7/16 ~10pm ET) — RESOLVED, no action needed

**UPDATE 10:15pm: the experiment failed and was ALREADY REVERTED + save-verified the same night.** The 11:06pm Discord ping rendered the token literally (`6 more to fill {{leagueDisplayNameClean}}`) — the bot's template tokens are hardcoded in its code, it doesn't map arbitrary feed fields. Discord template is back to the original `{{leagueDisplayName}}`; expect one ugly ping in the channel history from 11:06pm and normal pings after. Nothing for you to do. Takeaway: Discord-only banana-free names need a bot-code change, and the bot has no dev (Richard: there is no Caleb; a different outside guy built it and is gone) — so Discord keeps sharing X's banana-suffixed name unless someone gets Render/repo access to the bot. The repeat-🍌 fix itself is working great (that's what makes X post leave/rejoin bounces).

Original note kept below for context:

---

**TL;DR: if the Discord fill pings look broken this morning (literal `{{leagueDisplayNameClean}}` text or a missing draft name), revert with the 3 steps below. X is untouched either way.**

## What changed and why

Richard asked why X only announces joins while Discord announces joins AND leaves. Root cause: when someone leaves, the countdown text repeats one already posted and X's duplicate filter silently swallows it (Discord is a webhook, no filter). Shipped tonight on the frontend bot feed (`app/api/bot/league/route.ts`, 3 deploys, all live + verified):

1. **Repeat-🍌 suffix** — any countdown text that would byte-repeat one already served gets 1 🍌 appended on the first repeat, 2 on the second, etc. Ledger in Firestore `bot_feed_state/state` (own collection, 48h TTL). This makes leave/rejoin posts unique so X publishes them. Already firing correctly in prod tonight (fast-166 reached 🍌🍌🍌 from real leave/rejoin churn). Also fixes the two-concurrent-lobbies duplicate risk from 7/11.
2. **Tied odds → Jackpot first** (Richard's call): `Jackpot - 3.45% HOF - 3.45%`.
3. **New feed field `displayNameClean`** — same as `displayName` but never any bananas (odds line kept).

Then, per Richard ("go for it"), the bot's **AdminJS Discord template** was pointed at the clean field so Discord shows no bananas while X keeps them:

- Discord template NOW: `**{{leagueRemainingPlayers}}** more to fill {{leagueDisplayNameClean}}\n \n@everyone`
- Twitter template (UNCHANGED): `{{leagueRemainingPlayers}} more to fill {{leagueDisplayName}}`

**The unknown:** whether the bot's template engine maps arbitrary tokens from the feed response or has `leagueDisplayName` hardcoded (the bot was built by an outside dev who's no longer around, so we can't check the code). If hardcoded, the next Discord ping renders the token literally or blank.

## How to check

Look at the newest fill-countdown ping in the Discord channel. Good = normal ping (bold count, "Draft Lobby (Fast)", odds line), just never bananas. Bad = literal `{{leagueDisplayNameClean}}` text or no name.

## Revert (30 seconds, no deploy needed)

1. Open https://spoiled-banana-society-bot-ll78.onrender.com/admin/resources/Config/records/2/edit (login: email BLANK + the admin password — Richard has it if you don't).
2. Paste this EXACT original value into "Notification Discord Message" (change nothing else):
   `**{{leagueRemainingPlayers}}** more to fill {{leagueDisplayName}}\n \n@everyone`
3. Save. Done — Discord goes back to the shared (banana-carrying) name. Full config backup also at `~/Downloads/sbs_bot_config_backup_2026-07-16.txt` on Richard's Mac.

The `displayNameClean` field in the feed is additive and harmless — no code revert needed in any scenario.

— Richard's Claude, 2026-07-16 late
