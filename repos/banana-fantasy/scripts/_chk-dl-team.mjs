import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const W = '0x696012486d4629baa75e0f44a481f127f6705e1e';

const u = await db.collection('v2_users').doc(W).get();
console.log('user:', JSON.stringify({ username: u.data()?.username, name: u.data()?.name }));

// Go tokens — active teams, find most recent
const res = await fetch(`https://sbs-drafts-api-staging-652484219017.us-central1.run.app/owner/${W}/draftToken/all`);
const body = await res.json();
const active = body.active ?? [];
console.log('active teams:', active.length);
for (const t of active) {
  const roster = [];
  const posOrder = ['QB', 'RB', 'WR', 'TE', 'DST'];
  if (t.roster) for (const pos of posOrder) for (const p of t.roster[pos] ?? []) roster.push(`${p.team}-${p.position}`);
  console.log(`token ${t._cardId ?? t.CardId} league=${t.LeagueId ?? t._leagueId} level=${t.Level} roster=[${roster.join(' ')}]`);
}

// marketplace_index for his tokens (truth for card rendering)
for (const t of active.slice(-3)) {
  const id = String(t._cardId ?? t.CardId);
  const mi = await db.collection('marketplace_index').doc(id).get();
  if (mi.exists) {
    const x = mi.data();
    console.log(`marketplace_index/${id}:`, JSON.stringify({ owner: x.owner, leagueId: x.leagueId, leagueNo: x.leagueNo ?? x.leagueNumber, players: (x.players ?? []).map((p) => p.playerId ?? p) }).slice(0, 400));
  } else {
    console.log(`marketplace_index/${id}: MISSING`);
  }
}
