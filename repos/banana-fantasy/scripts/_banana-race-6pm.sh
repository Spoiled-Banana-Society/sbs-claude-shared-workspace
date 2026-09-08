#!/bin/zsh
# BANANA RACE — Tue 9/8 6:00 PM PT seating (re-runnable; assignments flip done).
export PATH=/usr/local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
cd /Users/richardvagner/banana-fantasy
LOG=$HOME/Downloads/banana-race-6pm.log
{
  echo "=== 6PM RUN $(date) ==="
  node scripts/_banana-race-seat.mjs --commit
  echo "=== 6PM DONE $(date) ==="
} >> "$LOG" 2>&1
