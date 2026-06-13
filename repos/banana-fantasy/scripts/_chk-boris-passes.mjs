#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const wallets = {
  'Boris drafting 0x438b': '0x438bbe98eed1dd2df244b007dab0583cc9be72e0',
  'Admin/owner 0xccdF':    '0xccdf79a51d292cf6de8807abc1bb58d07d26441d',
  'Boris old Privy 0xd330':'0xd3301bc039faf4223da98bceb5fb81abc9399362',
};
for (const [label, w] of Object.entries(wallets)) {
  const valid = (await db.collection(`owners/${w}/validDraftTokens`).count().get()).data().count;
  const used  = (await db.collection(`owners/${w}/usedDraftTokens`).count().get()).data().count;
  const u = await db.collection('v2_users').doc(w).get();
  const dp = u.exists ? (u.data().draftPasses ?? 'n/a') : 'no doc';
  let go = 'n/a';
  try { const r = await (await fetch(`${API}/owner/${w}/draftToken/all`)).json(); go = `avail:${(r.available||[]).length} active:${(r.active||[]).length}`; } catch(e){ go = 'fetch-fail'; }
  console.log(`${label}\n  Firestore ledger: valid=${valid} used=${used} | draftPasses counter=${dp}\n  Go API: ${go}`);
}
process.exit(0);
