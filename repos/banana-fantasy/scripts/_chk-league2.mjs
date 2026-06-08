import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
for(const id of['11677','51']){const m=await fs.collection('draftTokenMetadata').doc(id).get();const a=m.exists?(m.data().Attributes||[]):[];
  const ln=(a.find(x=>/league-?name/i.test(String(x.Trait_Type||x.trait_type)))||{}).Value;
  const lvl=(a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value;
  const img=String(m.exists?m.data().Image:'').slice(0,120);
  console.log(`token ${id}: LEVEL=${lvl} LEAGUE-NAME="${ln}"`);console.log(`   image=${img}`);}
// also index leagueNumber
for(const id of['11677','51']){const d=await fs.collection('marketplace_index').doc(id).get();console.log(`index ${id}: ${d.exists?JSON.stringify({level:d.data().level,leagueNumber:d.data().leagueNumber}):'NONE'}`);}
process.exit(0);
