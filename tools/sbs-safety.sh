#!/usr/bin/env bash
# SBS safety hook — blocks dangerous Bash commands
#
# Modes:
#   pre   → PreToolUse, blocks bad commands before they run
#   post  → PostToolUse, touches sentinel after shared workspace pushes
#
# Install: wired in ~/.claude/settings.json under hooks.PreToolUse + hooks.PostToolUse, matcher "Bash"
#
# What it blocks (PreToolUse):
#   1. Any git commit/push/add/reset/rm inside prod repos (sbs-drafts-api-main,
#      SBS-Backend-main, sbs-draft-web-main)
#   2. `git push origin main` in ~/banana-fantasy/ when the shared-workspace sentinel
#      is missing or older than 10 minutes (enforces step 7 before step 8 of deploy)
#
# What it does (PostToolUse):
#   Touches ~/.claude/sbs-shared-pushed after a successful `git push origin main`
#   (or similar) run from ~/sbs-claude-shared-workspace
#
# Bypass: Boris can always touch the sentinel manually or edit this script.

set -uo pipefail

MODE="${1:-pre}"
# Sentinel lives outside ~/.claude/ so Claude Code doesn't treat each touch
# as a config-dir write (which triggers permission prompts even with Bash(*)
# allowed). Fallback-read the legacy path for backward compat during switchover.
SENTINEL="$HOME/sbs-shared-pushed"
LEGACY_SENTINEL="$HOME/.claude/sbs-shared-pushed"
RICHARD_SENTINEL="$HOME/sbs-richard-checked"
SHARED_WORKSPACE="$HOME/sbs-claude-shared-workspace"
BANANA_FANTASY="$HOME/banana-fantasy"

# Prod repos — read-only references, no writes allowed
PROD_REPOS=(
  "sbs-drafts-api-main"
  "SBS-Backend-main"
  "sbs-draft-web-main"
)

# Prod GCP / Firebase projects — Claude can READ (list/describe/get) but not
# write. Blocks any gcloud/firebase/gsutil/bq command that names one of these
# projects AND uses a mutating verb. Boris can run writes from his own shell.
PROD_GCP_PROJECTS=(
  "sbs-prod-env"
  "sbs-test-env"
)
# Mutating verbs in gcloud-family CLIs. Anything matching these against a
# prod project gets blocked.
GCLOUD_WRITE_VERBS_RE='(create|update|delete|deploy|patch|replace|import|restore|set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding|set-secret|create-tag|undelete|enable|disable|promote|start|stop|restart|migrate|reset|cancel|revert|grant|reschedule|move|rename|reauthorize|rollback|undeploy|copy|sync[[:space:]]|rsync[[:space:]]|cp[[:space:]]|mv[[:space:]]|rm[[:space:]])'

# Prod Vercel project slugs — Claude can READ (vercel ls/inspect/env ls/projects ls)
# but cannot deploy or mutate env vars on these. The `banana-fantasy` project
# is STAGING (banana-fantasy-sbs.vercel.app) and stays writable; the projects
# below own the prod custom domains.
PROD_VERCEL_PROJECTS=(
  "sbs-draft-web"
  "sbsfantasycom"
  "sbs-staging-landing"
)
# Vercel CLI write subcommands (anything that mutates a deployment, env, or
# domain). `vercel deploy` is included even without subcommand because that's
# the implicit default `vercel` invocation.
VERCEL_WRITE_VERBS_RE='vercel[[:space:]]+(deploy|build|env[[:space:]]+(add|rm|pull[[:space:]]+--environment=production)|domains[[:space:]]+(add|rm|move|buy|transfer)|alias[[:space:]]+set|rollback|promote|remove|rm|redeploy|git[[:space:]]+(connect|disconnect)|integration[[:space:]]+(add|remove)|certs[[:space:]]+(add|rm|issue|renew)|teams[[:space:]]+(invite|remove)|secrets[[:space:]]+(add|rm)|--prod)'

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

# Empty or unreadable input → allow
[ -z "$cmd" ] && exit 0

# Strip single- and double-quoted substrings before matching, so strings like
# `echo 'cd ~/banana-fantasy && git push'` don't trigger rules. This is a
# heuristic (doesn't handle nested/escaped quotes) but covers the common cases.
stripped=$(echo "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

block() {
  local reason="$1"
  jq -n --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# ─── PreToolUse ────────────────────────────────────────────────────────────
if [ "$MODE" = "pre" ]; then

  # Rule 1: block git writes in prod repos
  for repo in "${PROD_REPOS[@]}"; do
    # Match either "cd /path/to/repo" patterns or repo path appearing with git write ops
    if echo "$stripped" | grep -qE "(^|[^a-zA-Z0-9_-])${repo}([^a-zA-Z0-9_-]|$)"; then
      if echo "$stripped" | grep -qE "git[[:space:]]+(commit|push|add|reset|rm|checkout[[:space:]]+-b|branch[[:space:]]+-[Dd])|^[[:space:]]*rm[[:space:]]+-[rRf]|>[[:space:]]*[^&=]|tee[[:space:]]|sed[[:space:]]+-i"; then
        block "SBS safety: ${repo} is a READ-ONLY prod reference per ~/claude-desktop-handoff/SBS_HANDOFF.md. Writes/commits/pushes/rms blocked. If this is intentional, run from outside the repo or bypass via the shell directly."
      fi
    fi
  done

  # Rule 1b: block writes against prod GCP / Firebase projects
  # Reads (list/describe/get) are allowed; writes (create/update/delete/deploy/etc) are blocked.
  # Iterate over each pipe/&/;-separated command segment so a Python heredoc
  # in one segment doesn't trigger false positives for a gcloud read in another.
  for proj in "${PROD_GCP_PROJECTS[@]}"; do
    # Split on shell separators; each line is one command segment
    while IFS= read -r segment; do
      [ -z "$segment" ] && continue
      if echo "$segment" | grep -qE "(^|[[:space:]\"'=])${proj}([[:space:]\"'=,;\\\\]|$)"; then
        # The segment must contain a gcloud-family CLI followed by a write
        # verb in the same segment (i.e., the verb is part of THIS command,
        # not in a piped Python/awk/sed script).
        if echo "$segment" | grep -qE "(gcloud|firebase|gsutil|bq)[[:space:]][^|;&]*$GCLOUD_WRITE_VERBS_RE"; then
          block "SBS safety: ${proj} is a PROD GCP project — Claude is restricted to staging only. Write commands blocked (reads are allowed). Run prod writes from your own shell directly."
        fi
      fi
    done < <(echo "$stripped" | tr ';|&' '\n')
  done

  # Rule 1c: block Vercel CLI writes against prod Vercel projects
  # Reads (vercel ls / inspect / projects ls / env ls) are allowed; deploys,
  # env mutations, domain changes etc against prod projects are blocked.
  if echo "$stripped" | grep -qE "$VERCEL_WRITE_VERBS_RE"; then
    for vproj in "${PROD_VERCEL_PROJECTS[@]}"; do
      if echo "$stripped" | grep -qE "(^|[[:space:]\"'=/])${vproj}([[:space:]\"'=,;/\\\\]|$)"; then
        block "SBS safety: ${vproj} is a PROD Vercel project — Claude is restricted to staging only. Write commands blocked. Run prod Vercel writes from your own shell."
      fi
    done
  fi

  # Rule 1d: block `git add -A` / `git add .` / `git add --all` in banana-fantasy
  # This is the command that nuked Richard's files on 2026-03-11. Specific-file
  # adds (`git add path/to/file.ts`) are still allowed.
  if echo "$stripped" | grep -qE "git[[:space:]]+add[[:space:]]+(-A|--all|\.([[:space:]]|$|;|&|\|))"; then
    in_banana=0
    if echo "$stripped" | grep -qE "banana-fantasy"; then
      in_banana=1
    elif [ "$(pwd)" = "$BANANA_FANTASY" ]; then
      in_banana=1
    fi
    if [ "$in_banana" = "1" ]; then
      block "SBS safety: 'git add -A' / 'git add .' / 'git add --all' in ~/banana-fantasy/ is blocked. Stale local files would overwrite Richard's work (this is what happened 2026-03-11). Add specific files by path instead: git add path/to/file.ts"
    fi
  fi

  # Rule 1e: block ~/sync-shared-workspace.sh unless Richard's branch was
  # checked recently (sentinel touched within last 10 minutes). This forces
  # STEP 0 of the deploy workflow before sync, so we catch any new Richard
  # commits before they get overwritten by the rsync.
  if echo "$stripped" | grep -qE "sync-shared-workspace\.sh"; then
    if [ ! -f "$RICHARD_SENTINEL" ]; then
      block "SBS deploy-order: Richard's branch hasn't been checked yet. Run STEP 0 first:
  git -C ~/sbs-claude-shared-workspace fetch origin
  git -C ~/sbs-claude-shared-workspace log origin/main..origin/richard --oneline
Then re-run the sync. To override: touch $RICHARD_SENTINEL"
    fi
    rage=$(( $(date +%s) - $(stat -f %m "$RICHARD_SENTINEL" 2>/dev/null || stat -c %Y "$RICHARD_SENTINEL" 2>/dev/null || echo 0) ))
    if [ "$rage" -gt 600 ]; then
      block "SBS deploy-order: Richard-check sentinel is ${rage}s old (>10min). Re-run:
  git -C ~/sbs-claude-shared-workspace fetch origin
  git -C ~/sbs-claude-shared-workspace log origin/main..origin/richard --oneline
Or touch $RICHARD_SENTINEL to override."
    fi
  fi

  # Rule 2: banana-fantasy push requires recent shared workspace push
  # Match: `git push` that's happening from banana-fantasy context
  if echo "$stripped" | grep -qE "git[[:space:]]+push"; then
    # Is this in banana-fantasy? Check for explicit path, or cwd via pwd fallback
    in_banana=0
    if echo "$stripped" | grep -qE "banana-fantasy"; then
      in_banana=1
    elif [ "$(pwd)" = "$BANANA_FANTASY" ]; then
      in_banana=1
    fi

    if [ "$in_banana" = "1" ]; then
      # Pick whichever sentinel actually exists (prefer new location, fall back to legacy)
      active_sentinel="$SENTINEL"
      [ -f "$active_sentinel" ] || active_sentinel="$LEGACY_SENTINEL"
      if [ ! -f "$active_sentinel" ]; then
        block "SBS deploy-order: the shared-workspace push sentinel is missing. Step 7 (push origin main in ~/sbs-claude-shared-workspace) must run before step 8 (push banana-fantasy → Vercel). See ~/claude-desktop-handoff/SBS_HANDOFF.md. To override intentionally: touch $SENTINEL"
      fi
      age=$(( $(date +%s) - $(stat -f %m "$active_sentinel" 2>/dev/null || stat -c %Y "$active_sentinel" 2>/dev/null || echo 0) ))
      if [ "$age" -gt 600 ]; then
        block "SBS deploy-order: the shared-workspace sentinel is ${age}s old (>10min). Re-run step 7 (push origin main in ~/sbs-claude-shared-workspace) before pushing banana-fantasy, or touch $SENTINEL to override."
      fi
    fi
  fi

  exit 0
fi

# ─── PostToolUse ───────────────────────────────────────────────────────────
if [ "$MODE" = "post" ]; then
  # If the command was a git push from shared workspace, refresh sentinel.
  # Also catches ~/sync-shared-workspace.sh (which pushes shared workspace
  # internally — without this branch, the wrapping shell sees only the
  # script path, not the inner `git push`, and the sentinel never updates).
  if echo "$stripped" | grep -qE "git[[:space:]]+push"; then
    if echo "$stripped" | grep -qE "sbs-claude-shared-workspace" || [ "$(pwd)" = "$SHARED_WORKSPACE" ]; then
      touch "$SENTINEL"
    fi
  elif echo "$stripped" | grep -qE "sync-shared-workspace\.sh"; then
    touch "$SENTINEL"
  fi

  # If the command was the Richard-check log (origin/main..origin/richard),
  # refresh Richard sentinel so the next sync-shared-workspace.sh can run.
  if echo "$stripped" | grep -qE "log[[:space:]].*origin/main\.\.origin/richard"; then
    touch "$RICHARD_SENTINEL"
  fi

  exit 0
fi

exit 0
