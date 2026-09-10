#!/usr/bin/env node
/**
 * Season close (Richard 2026-09-09 4 PM PT): every numbered lobby that never
 * filled is emptied through the REAL Go leave endpoint, so each seat's pass
 * goes back to its owner and My Drafts stops showing a lobby that can never
 * start. Passes can't be used for anything after the close (pass counts are
 * hidden site-wide), so no bell.
 *
 *   node scripts/_season-close-leave-open-lobbies.mjs            dry run
 *   node scripts/_season-close-leave-open-lobbies.mjs --commit   leave for real
 *
 * Afterwards prints /api/owner/active-drafts for every affected wallet
 * (runbook: verify APP-visible state, not just backend state).
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const COMMIT = process.argv.includes('--commit');
const GO = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const SITE = 'https://sbsfantasy.com';
const src = readFileSync('/Users/richardvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const snap = await db.collection('drafts').select('DisplayName', 'CurrentUsers', 'DraftType', 'NumPlayers').get();
const open = [];
snap.forEach((d) => {
  if (!/draft-\d+$/.test(d.id)) return;
  const users = d.data().CurrentUsers || [];
  if (users.length === 0 || users.length >= 10) return;
  open.push({ id: d.id, name: d.data().DisplayName, users });
});
log(`open lobbies with people: ${open.length}; seats: ${open.reduce((s, l) => s + l.users.length, 0)}; commit=${COMMIT}`);
const wallets = new Set();
let ok = 0, fail = 0;
for (const l of open) {
  for (const u of l.users) {
    const ownerId = String(u.OwnerId || '').toLowerCase();
    const tokenId = String(u.TokenId || '');
    wallets.add(ownerId);
    if (!COMMIT) { log(`  dry  ${l.id} ${l.name} ${ownerId} token ${tokenId}`); continue; }
    try {
      const res = await fetch(`${GO}/league/${l.id}/actions/leave`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, tokenId }),
      });
      const text = await res.text();
      if (res.ok) { ok++; log(`  left ${l.id} ${l.name} ${ownerId} token ${tokenId}`); }
      else { fail++; log(`  FAIL ${l.id} ${l.name} ${ownerId} token ${tokenId} → ${res.status} ${text.slice(0, 160)}`); }
    } catch (e) { fail++; log(`  FAIL ${l.id} ${ownerId} ${e.message}`); }
  }
}
log(`done: left ${ok}, failed ${fail}, wallets ${wallets.size}`);
if (COMMIT) {
  log('post-check: app-visible active drafts per wallet');
  for (const w of wallets) {
    try {
      const r = await fetch(`${SITE}/api/owner/active-drafts?wallet=${w}`, { cache: 'no-store' });
      const body = await r.json().catch(() => null);
      const list = Array.isArray(body) ? body : body?.drafts || body?.active || [];
      const filling = list.filter((d) => (d.playerCount ?? d.numPlayers ?? 10) < 10);
      log(`  ${w}: ${list.length} active drafts, ${filling.length} still filling`);
    } catch (e) { log(`  ${w}: check failed ${e.message}`); }
  }
}
process.exit(0);
