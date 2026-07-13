import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
const pm=(await fs.collection('playerStats2026').doc('playerMap').get()).data().Players;
const rk=(await fs.collection('playerStats2026').doc('rankings').get()).data().Ranking;
const rankBy="rank";
console.log('slot           playerMap.ADP   rankings.rank');
for(const id of ['CIN-WR1','SF-RB1','MIA-WR1','MIN-WR1','DET-WR1','DAL-WR1']){
  const r=rk.find(x=>x.playerId===id);
  console.log(id.padEnd(14), String(pm[id]?.ADP).padStart(6), '       ', r?.rank);
}
// count mismatches global
let mism=0; for(const r of rk){ if(pm[r.playerId] && pm[r.playerId].ADP!==r.rank) mism++; }
console.log('\nglobal ADP != rank mismatches:', mism, 'of', rk.length);
process.exit(0);
