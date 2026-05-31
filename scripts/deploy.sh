#!/bin/bash
# Safe deploy script — mirrors the workspace banana-fantasy tree into
# sbs-frontend-v2 by content checksum, so it picks up EVERY divergence
# (not just the last commit's files).
# Usage: ./scripts/deploy.sh "commit message"

set -e

WORKSPACE="$HOME/sbs-claude-shared-workspace/repos/banana-fantasy"
DEPLOY_REPO="/tmp/sbs-frontend-v2"
MSG="${1:-Deploy from shared workspace}"

# Files/dirs that must NEVER sync workspace → deploy.
# - .git/, node_modules/, build artifacts: not source code
# - .env.local, .env.*.local: developer-local secrets
# - .env.production, .env.vercel-check: deploy-side prod secrets, must not be
#   overwritten or deleted by --delete
# - playwright-report/, test-results/, coverage/: local test artifacts
# - .last-richard-sync: deploy-side sync marker
# Mirrors deploy repo's .gitignore plus deploy-only files.
RSYNC_EXCLUDES=(
  --exclude='.git/'
  --exclude='node_modules/'
  --exclude='.pnp' --exclude='.pnp.js' --exclude='.yarn/'
  --exclude='coverage/'
  --exclude='.next/' --exclude='.next-old/' --exclude='out/' --exclude='build/'
  --exclude='.DS_Store' --exclude='*.pem'
  --exclude='*-debug.log*' --exclude='yarn-error.log*'
  --exclude='.env' --exclude='.env.local' --exclude='.env.*.local'
  --exclude='.env.production' --exclude='.env.vercel-check'
  --exclude='.vercel'
  --exclude='*.tsbuildinfo' --exclude='next-env.d.ts'
  --exclude='artifacts/' --exclude='cache/' --exclude='typechain-types/'
  --exclude='playwright-report/' --exclude='test-results/' --exclude='blob-report/'
  --exclude='package-lock.json' --exclude='yarn.lock'
  --exclude='.last-richard-sync'
)

# 0. Pre-flight: workspace must be in sync with origin/main, otherwise the
# rsync below would overwrite the other dev's work in sbs-frontend-v2 with
# stale local files. This check is the deploy-side equivalent of the
# pre-push hook described in CLAUDE.md — kept here so it can't be skipped.
cd "$HOME/sbs-claude-shared-workspace"
git fetch origin --quiet
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
WORKSPACE_HEAD=$(git rev-parse HEAD)
MAIN_HEAD=$(git rev-parse origin/main)
if ! git merge-base --is-ancestor "$MAIN_HEAD" "$WORKSPACE_HEAD"; then
  echo "⛔ DEPLOY ABORTED — origin/main has commits not in $CURRENT_BRANCH."
  echo ""
  echo "   Recent commits on origin/main not yet in your branch:"
  git log --oneline "${WORKSPACE_HEAD}..${MAIN_HEAD}" | sed 's/^/     /'
  echo ""
  echo "   Deploying now would overwrite those files in sbs-frontend-v2"
  echo "   with the older copies in your branch."
  echo ""
  echo "   Fix: cd ~/sbs-claude-shared-workspace && git merge origin/main --no-edit"
  echo "        then re-run this script."
  exit 1
fi

# 1. Ensure deploy repo exists and is up to date.
if [ ! -d "$DEPLOY_REPO/.git" ] || [ ! -f "$DEPLOY_REPO/.git/HEAD" ]; then
  echo "Cloning sbs-frontend-v2..."
  rm -rf "$DEPLOY_REPO"
  git clone https://github.com/Spoiled-Banana-Society/sbs-frontend-v2.git "$DEPLOY_REPO"
fi

cd "$DEPLOY_REPO"
git pull origin main

# Mode B safety: Boris pushes directly to sbs-frontend-v2 from his Mac without
# always round-tripping through shared workspace. If sbs-frontend-v2/main has
# advanced since our last deploy, the rsync below would overwrite his commits
# with stale workspace files. Track the last deployed HEAD and abort if it
# moved underneath us.
DEPLOY_MARKER="$HOME/.sbs-last-deploy-frontend-v2-head"
DEPLOY_HEAD_NOW=$(git rev-parse HEAD)
if [ -f "$DEPLOY_MARKER" ]; then
  LAST_DEPLOYED=$(cat "$DEPLOY_MARKER")
  if [ -n "$LAST_DEPLOYED" ] && [ "$DEPLOY_HEAD_NOW" != "$LAST_DEPLOYED" ]; then
    # Make sure the previous-deploy SHA is still in history (else marker is stale)
    if git cat-file -e "$LAST_DEPLOYED^{commit}" 2>/dev/null; then
      AHEAD_COUNT=$(git rev-list --count "${LAST_DEPLOYED}..${DEPLOY_HEAD_NOW}" 2>/dev/null || echo "?")
      if [ "$AHEAD_COUNT" != "0" ] && [ "$AHEAD_COUNT" != "?" ]; then
        # sbs-frontend-v2 advanced since our last deploy. That's ONLY a clobber
        # risk if the workspace is stale for those commits' files (the rsync
        # would revert them). If the workspace already matches sbs-frontend-v2
        # for every file those commits touched — e.g. banana-fantasy was rebased
        # onto the live head before syncing — deploying reverts nothing, so it's
        # safe. Compare content per-file instead of blindly aborting on advance.
        CHANGED=$(git diff --name-only "${LAST_DEPLOYED}" "${DEPLOY_HEAD_NOW}")
        STALE_FILES=""
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          if ! diff -q "$DEPLOY_REPO/$f" "$WORKSPACE/$f" >/dev/null 2>&1; then
            STALE_FILES="${STALE_FILES}${f}\n"
          fi
        done <<< "$CHANGED"
        if [ -z "$STALE_FILES" ]; then
          echo "✓ sbs-frontend-v2 advanced by $AHEAD_COUNT commit(s), but the workspace already"
          echo "  matches every file those commits touched — no clobber risk, proceeding."
        else
          echo "⛔ DEPLOY ABORTED — sbs-frontend-v2 has $AHEAD_COUNT new commit(s) AND the workspace"
          echo "   is stale for these files (deploying would revert them):"
          printf "$STALE_FILES" | sed 's/^/     /'
          echo ""
          echo "   New commits pushed directly to sbs-frontend-v2:"
          git log --oneline "${LAST_DEPLOYED}..${DEPLOY_HEAD_NOW}" | sed 's/^/     /'
          echo ""
          echo "   Reconcile banana-fantasy onto the live head and ship again, OR force"
          echo "   (only if you've manually verified): rm $DEPLOY_MARKER && bash $0 \"$MSG\""
          exit 1
        fi
      fi
    fi
  fi
fi

# Write sync marker with Boris's latest commit hash (for pre-push hook)
BORIS_HASH=$(cd "$HOME/sbs-claude-shared-workspace" && git fetch origin --quiet 2>/dev/null && git rev-parse origin/boris 2>/dev/null)
if [ -n "$BORIS_HASH" ]; then
  echo "$BORIS_HASH" > "$HOME/sbs-claude-shared-workspace/.last-richard-sync"
fi

# 2. Show what would change (dry run, content-checksum based).
echo "Computing diff (workspace → deploy)..."
DRY_RUN=$(rsync -rcin --delete "${RSYNC_EXCLUDES[@]}" "$WORKSPACE/" "$DEPLOY_REPO/" 2>&1)
CHANGES=$(echo "$DRY_RUN" | awk '/^[<>][fdLs]|^\*deleting/ {print}')

if [ -z "$CHANGES" ]; then
  echo "No banana-fantasy changes detected. Nothing to deploy."
  exit 0
fi

echo "Files that will sync:"
echo "$CHANGES"
echo ""

# 2.5 Deletion guard (lesson from 2026-05-26).
# If the dry-run would delete files in sbs-frontend-v2 that aren't in
# workspace, that's *usually* a sign of drift (Boris pushed direct to
# sbs-frontend-v2 without syncing back) — but it CAN also be an intentional
# refactor. Distinguish by asking git: was this file ever in a workspace
# commit and then removed? If yes → intentional, let it through. If the
# file isn't tracked by workspace git history at all → drift, abort with a
# list so the operator can verify and either commit the file or pass
# DEPLOY_ALLOW_DELETES=1 to bypass.
DELETIONS=$(echo "$DRY_RUN" | awk '/^\*deleting/ {print $2}')
if [ -n "$DELETIONS" ]; then
  UNEXPECTED_DELETIONS=""
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    # Strip trailing slash for directory deletions; git log handles either.
    clean="${rel%/}"
    # Was this file (or anything under this path) ever tracked in workspace history?
    # `git log` returns nothing if the path has no history → that's drift.
    if [ -z "$(cd "$HOME/sbs-claude-shared-workspace" && git log -1 --format='%H' -- "repos/banana-fantasy/$clean" 2>/dev/null)" ]; then
      UNEXPECTED_DELETIONS="${UNEXPECTED_DELETIONS}${rel}\n"
    fi
  done <<< "$DELETIONS"
  if [ -n "$UNEXPECTED_DELETIONS" ] && [ "${DEPLOY_ALLOW_DELETES:-0}" != "1" ]; then
    echo "⛔ DEPLOY ABORTED — would delete files that aren't tracked in workspace git history:"
    printf "$UNEXPECTED_DELETIONS" | sed 's/^/   /'
    echo ""
    echo "   These were probably pushed direct to sbs-frontend-v2 without syncing"
    echo "   back to workspace. Either:"
    echo "     1) Copy them into workspace first, then commit, then re-run."
    echo "     2) If you really mean to delete them, re-run with DEPLOY_ALLOW_DELETES=1."
    exit 1
  fi
fi

# 3. Apply for real.
rsync -rc --delete "${RSYNC_EXCLUDES[@]}" "$WORKSPACE/" "$DEPLOY_REPO/" >/dev/null

# 4. Commit, push, and trigger deploy hook (NOT git-push auto-deploy).
cd "$DEPLOY_REPO"
git add -A
if git diff --cached --quiet; then
  echo "No tracked-file differences after sync. Already up to date."
  exit 0
fi

echo ""
git diff --cached --stat
echo ""
git commit -m "$MSG"
git push origin main

# Trigger deploy via hook — the git push auto-deploy gets blocked by Vercel
# deployment protection, so the hook is what actually deploys.
# Record the SHA we just shipped so the next deploy can detect a direct push
# from Boris that would otherwise be silently overwritten.
git rev-parse HEAD > "$DEPLOY_MARKER"

echo ""
echo "Triggering Vercel deploy hook..."
curl -s -X POST "https://api.vercel.com/v1/integrations/deploy/prj_laojah7E1rx3bwkFOPcOAsumG0DO/MjJcGpoznH" | cat
echo ""
echo "Deploy triggered!"
