#!/bin/zsh
# Slow clock 4h → 1h flip (Richard 2026-09-03). Runs via launchd com.sbs.slowclock.1h at 10pm PT Sep 3
# and again 6am Sep 4 as a retry. Idempotent: flip sets the same values, restamp only touches picks
# whose clock ends later than the 1h rule allows. Marker stops any later firings; unload the plist after.
MARK=/Users/richardvagner/banana-fantasy/.slow-clock-1h-done
if [ -f "$MARK" ]; then echo "$(date) done marker present, skipping"; exit 0; fi
cd /Users/richardvagner/banana-fantasy || exit 1
echo "===== $(date) flip start ====="
/usr/local/bin/node scripts/_slow-clock-toggle.mjs --hours 1 --pause-end 9 --start none || exit 1
APPLY=1 /usr/local/bin/node scripts/_slow-clock-restamp-1h.mjs || exit 1
echo "===== $(date) flip done ====="
# second (6am) run reaches here too; mark done only once it's Sep 4 in PT
if [ "$(TZ=America/Los_Angeles date +%Y-%m-%d)" = "2026-09-04" ]; then touch "$MARK"; fi
