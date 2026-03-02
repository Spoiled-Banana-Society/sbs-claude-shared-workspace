# New Git Workflow — Personal Branches

We switched to personal branches so we can both work at the same time without overwriting each other.

## What Changed
- You now have your own branch: `boris`
- Richard has his own branch: `richard`
- **Never commit directly to `main`** — main only gets merges when deploying

## Your New Workflow

### Start of session:
```bash
cd ~/sbs-claude-shared-workspace
git fetch origin
git checkout boris
git pull origin boris
git merge origin/main --no-edit
```

### End of session:
```bash
cd ~/sbs-claude-shared-workspace
git add -A
git commit -m "Boris: <what you did>"
git push origin boris
```

### To deploy:
```bash
git fetch origin && git merge origin/main --no-edit
git checkout main && git pull origin main
git merge boris --no-edit && git push origin main
git checkout boris
```
Then sync to sbs-frontend-v2 and trigger deploy hook (see CLAUDE.md for full steps).

## Why
We were both pushing to main and overwriting each other. Personal branches mean your pushes never conflict with mine. We only merge when deploying.
