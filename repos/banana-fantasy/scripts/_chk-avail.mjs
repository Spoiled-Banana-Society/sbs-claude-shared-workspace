import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const w='0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const res = await fetch(`${API}/owner/${w}/draftToken/all`);
const data = await res.json();
function decode(t){const rt=String(t.realTokenId??'').trim();if(/^\d+$/.test(rt))return rt;const c=String(t._cardId??t.cardId??'').trim();if(/^\d{1,7}$/.test(c))return c;if(/^\d{10}\d{1,7}$/.test(c))return c.slice(10);return null;}
const avail=(data.available||[]).map(decode).filter(Boolean);
const active=(data.active||[]).map(decode).filter(Boolean);
console.log(`admin available(pass)=${data.available?.length} decoded=${avail.length}  active(team)=${data.active?.length} decoded=${active.length}`);
// of the available (passes), how many have a FULL roster doc?
let fullRosterPasses=[], emptyPasses=0, noDoc=0;
for (const id of avail.slice(0,120)) {
  const m=await fs.collection('draftTokenMetadata').doc(id).get();
  if(!m.exists){noDoc++;continue;}
  const attrs=(m.data().Attributes||[]);
  const roster=attrs.filter(a=>/^(QB|RB|WR|TE|DST)\d+$/i.test(String(a.Trait_Type||a.trait_type||'')));
  if(roster.length>=10) fullRosterPasses.push(id); else emptyPasses++;
}
console.log(`\nSample of ${Math.min(120,avail.length)} AVAILABLE(undrafted-pass) tokens:`);
console.log(`  full-roster doc: ${fullRosterPasses.length}  ${fullRosterPasses.slice(0,15).join(',')}`);
console.log(`  empty-roster doc: ${emptyPasses}`);
console.log(`  no doc: ${noDoc}`);
// Is 994/161 in available or active per admin?
console.log(`\n994 in avail=${avail.includes('994')} active=${active.includes('994')}`);
console.log(`161 in avail=${avail.includes('161')} active=${active.includes('161')}`);
process.exit(0);
