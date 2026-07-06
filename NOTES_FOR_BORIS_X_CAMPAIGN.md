# X Follow + Follow-Back DM Campaign — Runbook for Boris's Claude

Written 2026-07-06 after running this exact playbook on @SBSFantasy (122 follows, 14 follow-backs, 13 DMs, zero warnings). Boris runs the same play from his **personal X account**, scraping a **different creator's** follower list. Hand this file to Claude Code on Boris's machine and it has everything it needs.

---

## What this campaign does

1. Scrape the followers of a fantasy-football creator (via twitterapi.io).
2. Filter to fantasy-relevant accounts ≤20k followers → build a queue.
3. Follow ~20 of them every 2 hours through Boris's real Chrome (Claude-in-Chrome extension), so they notice and follow back.
4. Periodically pull Boris's own follower list, diff it against who we followed → anyone who followed back gets ONE promo DM for Banana Best Ball IV.
5. Boris handles replies and Free Draft fulfillment himself in his X inbox.

## Prerequisites

- Claude Code with the **Claude-in-Chrome extension** connected, on a Chrome that is **logged into Boris's personal X account**.
- A **twitterapi.io API key**. Boris pastes it into the Claude session each time. **Never write the key to disk or into any file.**
- Chrome and the terminal must stay open all day — the automation is a session-only cron; it dies when either closes and must be re-created next session.

## Files (all in ~/Downloads — they persist across sessions; scratchpad does NOT)

| File | Purpose |
|---|---|
| `<creator>_followers.csv` | raw scrape of the source creator's followers |
| `x_follow_queue_remaining.csv` | working queue, sorted by follower count desc; remove rows as processed |
| `x_follow_progress.csv` | log: `handle,status,ts` (followed / skipped_* ) |
| `x_already_following.txt` | handles Boris already follows (skip these) |
| `x_dm_progress.csv` | log: `handle,status,ts` (dm_sent / skipped_*) — the double-DM guard |
| `x_dm_template.txt` | the DM copy (included at the bottom of this doc) |

⚠️ Bios in these CSVs contain newlines. Count rows with a real CSV reader in Python, **never `wc -l`**.

---

## Step 1 — Scrape the source creator's followers

Pick the creator with Richard (someone whose audience is fantasy players, e.g. we used @JustinHerzig's 19.6k followers for SBS). Then:

- Endpoint: `GET https://api.twitterapi.io/twitter/user/followers?userName=<creator>&pageSize=200`, header `X-API-Key: <key>`. Cursor-paged: response has `followers[]`, `has_next_page`, `next_cursor`; pass `&cursor=` to continue. Cost ~$0.01 per 1k profiles — negligible.
- **Chunk the pull and save cursor state to a JSON file between runs.** A 13k-follower pull takes several minutes and one long shell command WILL hit the 2-minute timeout. Loop ~60 pages per run, persist `{followers, cursor, done}`, resume until `done`.
- Dedupe by lowercased `userName`.
- Also pull who **Boris already follows**: same API, `/twitter/user/followings?userName=<boris>` → save handles to `x_already_following.txt`.

## Step 2 — Filter to the queue

Keep an account only if ALL of these hold:

- **≤ 20,000 followers** (skip mega accounts — they never notice a follow).
- **Fantasy-relevant bio**: matches fantasy / best ball / dynasty / DFS etc. **Skip NFT-only matches** — NFT art projects, VC funds, and "web3 degens" are not fantasy players. Crypto+fantasy crossover people are fine only if the bio has a real fantasy angle.
- Not already in `x_already_following.txt`, not Boris himself.
- Skip obviously off-topic/political accounts where fantasy is a minor side interest (log as `skipped_offtopic`).

Sort by follower count descending → `x_follow_queue_remaining.csv`.

## Step 3 — The follow loop (Chrome extension)

Cadence: **cron `7 8-18/2 * * *`** (every 2h at :07, 8am–6pm local, quiet by 8pm). Session-only — re-create it every new session. ~20 handles per batch.

Per handle:
1. `navigate` to `https://x.com/<handle>` → wait ~2.5s → screenshot.
2. **Verify the button says "Follow".** If it says **"Following", DO NOT CLICK — that unfollows.** Log `skipped_already_following`.
3. Read the button coordinates from THIS screenshot (window size shifts between 1512×794 and 1440×756; never reuse coords blindly).
4. Click → screenshot to confirm it flipped to "Following" → log to `x_follow_progress.csv`, remove from queue.

**Rate-limit rules (the part that keeps the account safe):**
- The moment X shows **"Sorry, you are rate limited" — STOP the batch instantly.** Never push through it; pushing converts a throttle into a follow-block.
- The daily cap is rolling and tightens through the day. On the aged, active SBS account it worked out to ~40–75 follows/day. **Boris's personal account is an unknown — start the first day at ~20–30 total and watch how X reacts before running full cadence.**
- Extension drops mid-batch a few times a day. Reconnect: `list_connected_browsers` → `select_browser` → screenshot → verify the button state (the click before the drop often did NOT land) → continue.

## Step 4 — Follow-back detection

Once or twice a day (we bolt it onto the cron cycle, after the follow batch):

1. Pull Boris's own followers via the API (chunked, cursor state, as in Step 1).
2. Follow-backs = handles in `x_follow_progress.csv` with status `followed` that now appear in the follower list.
3. New DM targets = follow-backs NOT already in `x_dm_progress.csv`.

Expect ~10% follow-back rate. The first check after a few days of following produces a backlog (we got 14); after that it's a trickle of 1–3 per cycle.

## Step 5 — The DM (the risky part — follow this exactly)

**Pacing: max 15–20 DMs/day, ≥40s between sends, hard-stop on ANY warning dialog.** X punishes DM velocity far harder than follow velocity. Only DM mutuals (follow-backs) — that also guarantees the DM goes through.

Per target:
1. Navigate to the profile → screenshot. **Read the bio first**: if it says anything like "DMs = block" / hostile to promo (we skipped @farquadfantasy for exactly this), log `skipped_bio_warning` and move on. One spam report hurts more than one DM helps.
2. Click the **chat-bubble icon** (left of the Follow/Following button) → the DM thread opens.
3. **Verify the thread is empty.** If there's any prior conversation, log `skipped_prior_thread` and skip — Richard and Boris have both sent manual DMs before; never double-pitch someone.
4. **First DM of a session may show "Enter Passcode"** (X's encrypted-chat unlock). Claude must NOT type this code — it's a credential. Ask Boris to enter it manually in Chrome; it stays unlocked for the rest of the session.
5. Type the message **line by line**: type a line → press `shift+Return shift+Return` for the blank line → next line. **A bare Return SENDS the message**, so it only comes last.
6. Press Return to send → wait 2s → screenshot → **verify the blue bubble contains the whole message, ending with "appreciate you!"**. One of our sends inexplicably went out with only the first line — if that happens, immediately type and send the remaining lines as a follow-up.
7. Log to `x_dm_progress.csv`.

**Have Boris review the first batch** (list of recipients + exact text) before anything sends. After that it can run automatically.

## The DM copy (`x_dm_template.txt`) — Richard's final version, use verbatim

```
Hey hope you're doing well

Our fantasy football contest Banana Best Ball IV is live and you can draft!

$100K Guaranteed Prize Pool

@JustinHerzig is an advisor

Would love to give you a Free Draft - can win up to $500 in Drafts.

Love to see what you think of the product, appreciate you!
```

⚠️ The handle is **@JustinHerzig** — with the "t". Richard has typo'd it "JusinHerzig" twice; a typo'd tag links to nothing and kills the credibility line. After sending, the mention should render as an underlined link in the bubble — that's your check that it tagged.

## Quick sanity checklist before each session

- [ ] Chrome open, logged into the right X account (check the avatar bottom-left of x.com)
- [ ] Terminal/Claude session running, cron re-created
- [ ] API key pasted fresh (never stored)
- [ ] Queue + progress CSVs present in ~/Downloads
- [ ] Stop instantly on: "rate limited", any DM warning, any captcha/challenge — report to Boris instead of retrying
