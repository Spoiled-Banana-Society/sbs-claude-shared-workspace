import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

// find RisBrian
const users = await db.collection('v2_users').get();
const hits = users.docs.filter((d) => {
  const x = d.data();
  return [x.name, x.displayName, x.username].filter(Boolean).some((f) => String(f).toLowerCase().includes('risbrian'));
});
for (const h of hits) {
  console.log('user:', h.id, JSON.stringify({ username: h.data().username, name: h.data().name }));
}
if (!hits.length) { console.log('no user found'); process.exit(0); }
const W = hits[0].id;

// his special drafts / wheel wins
const spins = await db.collectionGroup('wheelSpins').where('walletAddress', '==', W).get().catch(() => null);
if (spins) {
  for (const s of spins.docs) {
    const x = s.data();
    if (x.segmentId && x.segmentId !== '1draft') console.log('spin:', s.ref.path, JSON.stringify({ segmentId: x.segmentId, prize: x.prizeLabel ?? x.label }));
  }
}

// his tokens in Go (active = teams)
const res = await fetch(`https://sbs-drafts-api-staging-652484219017.us-central1.run.app/owner/${W}/draftToken/all`);
const body = await res.json();
for (const t of body.active ?? []) {
  console.log('Go active token:', JSON.stringify({ cardId: t._cardId ?? t.CardId, draftType: t._draftType ?? t.DraftType, level: t.Level ?? t._level, leagueId: t.LeagueId ?? t._leagueId }).slice(0, 300));
}

// marketplace_index entries for his wallet
const mk = await db.collection('marketplace_index').where('owner', '==', W).get().catch(() => null);
if (mk) for (const d of mk.docs) {
  const x = d.data();
  console.log('marketplace_index:', d.id, JSON.stringify({ tier: x.tier, leagueNo: x.leagueNo ?? x.leagueNumber, draftId: x.draftId }));
}
