#!/bin/zsh
# Wheel season switch: no Jackpot/HOF/JackHOF wedge from 5 PM PT 9/8 (Richard 9/8).
# Armed at 4:52 because the keeper ticks every 5 min and VRF takes ~5 more.
export PATH=/usr/local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
cd /Users/richardvagner/banana-fantasy
LOG=$HOME/Downloads/banana-race-5pm.log
{
  echo "=== 4:52 WHEEL RUN $(date) ==="
  node scripts/_wheel-force-rotate.mjs --no-specials --set
} >> "$LOG" 2>&1
