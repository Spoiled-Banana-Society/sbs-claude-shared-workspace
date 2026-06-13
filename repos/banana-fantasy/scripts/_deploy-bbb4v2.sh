#!/bin/bash
# One-shot deploy of SBSDraftPassBBB4V2 ("BBB4 Staging") to Base.
# Reads BBB4_OWNER_PRIVATE_KEY from the environment or from
# ~/banana-fantasy/.env.local (gitignored, never synced or deployed).
set -e
cd ~/banana-fantasy
node scripts/_deploy-bbb4v2.mjs
