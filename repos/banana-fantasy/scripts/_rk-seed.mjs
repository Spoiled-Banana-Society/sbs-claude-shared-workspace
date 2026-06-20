import admin from 'firebase-admin';import {readFileSync} from 'fs';
const WRITE = process.argv.includes('--write');
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});
const fs=admin.firestore();
const ABBR={'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB','Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC','Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Las Vegas Raiders':'LV','Miami Dolphins':'MIA','Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG','New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','Seattle Seahawks':'SEA','San Francisco 49ers':'SF','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS'};

// parse our converter CSV -> [{rank, playerId, value}]
const csv=readFileSync(process.env.HOME+'/sbs-rankings/team_position_rankings.csv','utf8').trim().split('\n').slice(1);
const ours=[];
for(const line of csv){
  const m=line.match(/^(\d+),(.+?),([-0-9.]+),/); if(!m) continue;
  const tp=m[2]; const pos=tp.split(' ').pop(); const team=tp.slice(0,tp.length-pos.length-1);
  const ab=ABBR[team]; if(!ab){console.log('!! no abbrev for team:',team);continue;}
  ours.push({rank:Number(m[1]), playerId:`${ab}-${pos}`, value:Number(m[3])});
}

// system truth
const pmDoc=await fs.collection('playerStats2026').doc('playerMap').get();
const Players=pmDoc.data().Players||{};
const sysIds=new Set(Object.keys(Players));
const ourIds=new Set(ours.map(o=>o.playerId));

const notInSystem=ours.filter(o=>!sysIds.has(o.playerId)).map(o=>o.playerId);
const missingFromOurs=[...sysIds].filter(id=>!ourIds.has(id));
console.log(`ours=${ours.length}  system=${sysIds.size}`);
console.log('OUR slots NOT in system (must be 0):', notInSystem.length?notInSystem.join(', '):'none');
console.log('System slots WE did not rank (will go to bottom):', missingFromOurs.length?missingFromOurs.join(', '):'none');

if(notInSystem.length){console.log('\nABORT: key mismatch, fix abbrev/pos before writing.');process.exit(1);}

// final order: our ranks 1..N, then any missing system slots appended
const final=[...ours.sort((a,b)=>a.rank-b.rank)];
for(const id of missingFromOurs) final.push({playerId:id, value:0});
const Ranking=final.map((o,i)=>({rank:i+1, score:Math.round((o.value||0)*1000)/1000, playerId:o.playerId}));

console.log('\nTOP 8:'); Ranking.slice(0,8).forEach(r=>console.log(`  #${r.rank} ${r.playerId}`));
console.log('BOTTOM 5:'); Ranking.slice(-5).forEach(r=>console.log(`  #${r.rank} ${r.playerId}`));

if(!WRITE){console.log('\nDRY RUN — no writes. Re-run with --write to apply.');process.exit(0);}

// WRITE: set each slot's ADP = its rank; set rankings doc
for(const r of Ranking){ if(Players[r.playerId]) Players[r.playerId].ADP=r.rank; }
await fs.collection('playerStats2026').doc('playerMap').set({...pmDoc.data(),Players},{merge:false});
await fs.collection('playerStats2026').doc('rankings').set({Ranking});
console.log('\nWROTE playerMap (ADP) + rankings ('+Ranking.length+' slots).');
process.exit(0);
