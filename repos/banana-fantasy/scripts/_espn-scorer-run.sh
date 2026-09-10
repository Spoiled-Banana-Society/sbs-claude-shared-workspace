#!/bin/zsh
# launchd com.sbs.espn.scorer → one scoring pass every 5 minutes (Richard 2026-09-09: ESPN scoring live for Week 1).
# Skips if a previous pass is still running. Log: ~/Library/Logs/sbs-espn-scorer.log
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
LOCK=/Users/richardvagner/banana-fantasy/.espn-scorer/run.lock
cd /Users/richardvagner/banana-fantasy || exit 1
if [ -f "$LOCK" ] && kill -0 "$(cat $LOCK)" 2>/dev/null; then echo "$(date) previous pass still running, skip"; exit 0; fi
echo $$ > "$LOCK"
node scripts/espn-scorer.mjs --apply
rc=$?
rm -f "$LOCK"
echo "$(date) pass done rc=$rc"
exit $rc
