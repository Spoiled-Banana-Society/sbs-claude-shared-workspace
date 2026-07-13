#!/bin/bash
# Applies the staging RTDB security rules (adds the userEvents read rule that
# unblocks the real-time notification/promo/flag sync). Targets sbs-staging-env
# ONLY. Safe to re-run.
set -e
TOKEN=$(gcloud auth print-access-token)
URL="https://sbs-staging-env-default-rtdb.firebaseio.com/.settings/rules.json?access_token=$TOKEN"
RULES="/Users/borisvagner/banana-fantasy/database.rules.json"

echo "=== Applying rules... ==="
curl -s -X PUT "$URL" --data-binary @"$RULES"
echo ""
echo "=== Verifying live rules (should now include userEvents) ==="
curl -s "$URL"
echo ""
