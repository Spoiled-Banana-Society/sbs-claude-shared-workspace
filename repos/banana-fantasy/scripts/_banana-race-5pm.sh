#!/bin/zsh
# BANANA RACE — Tue 9/8 5:00 PM PT (Richard 9/8: "this all happens at 5pm").
# Freeze + winners bell + Packs off. Wheel season switch is armed separately at 4:52
# (scripts/_banana-race-452pm.sh) so the new period is live by 5. Every step is idempotent.
export PATH=/usr/local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
cd /Users/richardvagner/banana-fantasy
LOG=$HOME/Downloads/banana-race-5pm.log
{
  echo "=== 5PM RUN $(date) ==="
  node scripts/_banana-race-freeze.mjs --commit
  node scripts/_banana-race-bells.mjs --winners --apply
  node scripts/_zone-drop-toggle.mjs --off
  echo "=== 5PM DONE $(date) ==="
} >> "$LOG" 2>&1
