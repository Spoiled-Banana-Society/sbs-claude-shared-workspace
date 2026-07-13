import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const RPC='https://mainnet.base.org';const C='0x14065412b3A431a660e6E576A14b104F1b3E463b';
async function own(id){const data='0x6352211e'+BigInt(id).toString(16).padStart(64,'0');const r=await(await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:C,data},'latest']})})).json();return r.result&&r.result!=='0x'?'0x'+r.result.slice(-40):'ERR';}
for(const id of['1453','1452','1449','1451']){
  const o=await own(id);
  const d=await(await fetch(`${API}/owner/${o.toLowerCase()}/draftToken/all`)).json();
  const inAvail=(d.available||[]).some(t=>String(t.realTokenId)===id);
  const inActive=(d.active||[]).some(t=>String(t.realTokenId)===id);
  const passType=(d.available||[]).find(t=>String(t.realTokenId)===id)?.passType;
  const m=await fs.collection('draftTokenMetadata').doc(id).get();
  const a=m.exists?(m.data().Attributes||[]):[];
  const ln=(a.find(x=>/league-?name/i.test(String(x.Trait_Type||x.trait_type)))||{}).Value;
  const lvl=(a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value;
  console.log(`${id}: owner=${o.slice(0,10)} | GO: available(pass)=${inAvail}${passType?'('+passType+')':''} active(team)=${inActive} | finalizeDoc LEVEL=${lvl} LEAGUE="${ln}"`);
}
process.exit(0);
