import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
const pm=(await fs.collection('playerStats2026').doc('playerMap').get()).data().Players;
console.log('playerMap ADP check:');
for(const k of ['CIN-WR1','DET-RB1','LAR-WR1','MIA-WR1','HOU-DST','CLE-QB']) console.log(`  ${k}: ADP=${pm[k]?.ADP}`);
const rk=(await fs.collection('playerStats2026').doc('rankings').get()).data().Ranking;
console.log('rankings doc top3:', rk.slice(0,3).map(r=>`${r.rank}:${r.playerId}`).join('  '));
process.exit(0);
