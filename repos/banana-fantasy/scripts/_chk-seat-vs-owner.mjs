// READ-ONLY: for every non-completed special-draft round, compare the recorded
// queue member wallet vs the pass NFT's CURRENT on-chain owner, and vs the Go
// league's CurrentUsers (drafts/{draftId}.CurrentUsers[].OwnerId) — the list
// that actually decides who drafts.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync('/Users/richardvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const sa = JSON.parse(Buffer.from(src.match(/STAGING_SA_B64 = '([^']+)'/)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const CONTRACT = '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80';
const RPC = 'https://mainnet.base.org';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ownerOf(tokenId) {
  const hex = BigInt(tokenId).toString(16).padStart(64, '0');
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CONTRACT, data: '0x6352211e' + hex }, 'latest'] }),
      });
      if (!r.ok) { await sleep(400 * (i + 1)); continue; }
      const j = await r.json();
      if (j.result && j.result !== '0x') return '0x' + j.result.slice(-40).toLowerCase();
      if (j.error) { await sleep(400 * (i + 1)); continue; }
      return null;
    } catch { await sleep(400 * (i + 1)); }
  }
  return null;
}

const users = new Map();
for (const d of (await db.collection('v2_users').get()).docs) {
  const u = d.data();
  users.set(d.id.toLowerCase(), u.username || u.handle || u.displayName || '');
}
const name = (w) => `${w.slice(0, 10)}… ${users.get(w.toLowerCase()) || '(no handle)'}`;

for (const type of ['jackpot', 'hof', 'jackhof']) {
  const q = await db.collection('v2_queues').doc(type).get();
  if (!q.exists) { console.log(`\n=== ${type}: no doc`); continue; }
  const d = q.data();
  console.log(`\n=== ${type} (nextRoundId=${d.nextRoundId})`);
  for (const r of d.rounds || []) {
    if (r.status === 'completed') continue;
    let cu = [];
    let started = false;
    if (r.draftId) {
      const L = await db.collection('drafts').doc(r.draftId).get();
      cu = (L.data()?.CurrentUsers || []).map(u => String(u?.OwnerId || '').toLowerCase());
      started = (await db.collection('drafts').doc(r.draftId).collection('state').doc('info').get()).exists;
    }
    console.log(` round ${r.roundId} status=${r.status} source=${r.source || '(untagged)'} members=${(r.members || []).length}/10 draftId=${r.draftId || '-'} leagueSeats=${cu.length} started=${started}`);

    for (const m of r.members || []) {
      const w = m.wallet.toLowerCase();
      const oc = m.tokenId ? await ownerOf(m.tokenId) : null;
      const drift = oc && oc !== w;
      const flag = drift
        ? (cu.includes(w) && !cu.includes(oc) ? '  <<< DRIFT — SEAT NOT MOVED' : '  <<< DRIFT')
        : '';
      console.log(`   - token ${m.tokenId || '(none)'} queued=${name(w)} | onchain=${m.tokenId ? (oc ? name(oc) : 'RPC FAIL') : 'n/a'} | seat(queued)=${cu.includes(w)} seat(onchain)=${oc ? cu.includes(oc) : '-'}${flag}`);
    }
  }
}
process.exit(0);
