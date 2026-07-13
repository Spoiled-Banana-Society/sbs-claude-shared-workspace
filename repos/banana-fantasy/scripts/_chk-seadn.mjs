import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
const S='https://banana-fantasy-sbs.vercel.app';
for(const id of['1453','1452','1451','1449','1450','1438']){
  const d=await fs.collection('marketplace_index').doc(id).get();
  const idx=d.exists?d.data():null;
  const m=await(await fetch(`${S}/api/nft/metadata/${id}?cb=${Math.floor(performance.now())}`)).json();
  const st=(m.attributes||[]).find(a=>a.trait_type==='Status')?.value;
  const imgIsOg=String(m.image||'').includes('/api/og/team-card');
  console.log(`${id}: indexStatus=${idx?idx.status:'NONE'} indexImgOG=${idx?String(idx.image||'').includes('/api/og/team-card'):'-'} | metaStatus=${st} metaImgOG=${imgIsOg}`);
}
process.exit(0);
