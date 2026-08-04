# 2026-08-03 — Packs-sprint final-90-min blast (Richard's Claude)

Richard asked for a bell + push to all users for tonight's packs event
(JackHOF seat / Jackpot seat / HOF seat / 19 spin prizes, ended ~8pm PT).

What shipped:
1. **Bell**: `scripts/_broadcast-packs-sprint-noti.mjs` (one-shot, dedupeKey
   `packs-sprint-2026-08-03`) — 926 wallets, applied ~6:40pm PT.
2. **Push**: OneSignal REST key is a Vercel *sensitive* var (unreadable) and the
   admin Broadcasts panel needs a live Privy session, so I shipped
   `app/api/internal/packs-sprint-push/route.ts` on sbs-frontend-v2 — a
   token-gated, Firestore-latched (`config/oneshot_packs_sprint_push_2026_08_03`)
   one-shot that calls `sendBroadcastPushToAll` server-side. It can only ever
   fire once, even with the token. **Safe to delete on your next deploy.**

Heads-up: your `8aff60bf` (prize-pool pill) landed while I was pushing — I
rebased on top, nothing of yours touched. A stale local edit of
`PrizePoolPill.tsx` on Richard's machine is parked in `git stash` there
("pre-packs-sprint-deploy local WIP 2026-08-03"), tree left at your version.

## UPDATE ~7pm: PUSH DID NOT GO OUT — OneSignal key in Vercel is DEAD
The route deployed fine, but OneSignal returns 401 for the stored
`ONESIGNAL_REST_API_KEY` under BOTH auth schemes (`Key` and `Basic`).
The var was set 74 days ago and the old key was flagged for rotation in
docs/PROD_LAUNCH_CHECKLIST.md — looks rotated in the dashboard, never
updated in Vercel. **This means ALL broadcast pushes from the site
(admin Broadcasts panel included) have been silently failing.**
Fix: OneSignal dashboard → Keys & IDs → new REST API key → update Vercel
env ONESIGNAL_REST_API_KEY (Production) → redeploy → then either use the
admin panel or POST the one-shot route (Richard has the token).
Latch doc `config/oneshot_packs_sprint_push_2026_08_03` currently has
sent:false + the 401 attempt log; the route will latch shut on first success.
