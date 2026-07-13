#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env=readFileSync('.env.production','utf8');
const sa=JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({credential:cert(sa)});
const db=getFirestore();
const mi=await db.collection('marketplace_index').doc('1').get();
console.log('marketplace_index/1:', mi.exists ? `status=${mi.data().status} players=${mi.data().players?.length??0} level=${mi.data().level}` : 'MISSING');
const nlm=await db.collection('nft_league_map').doc('1').get();
console.log('nft_league_map/1:', nlm.exists ? JSON.stringify(nlm.data()) : 'MISSING (token->league)');
const dr=(await db.collection('drafts').doc('2024-fast-draft-0').get()).data()||{};
console.log('draft:', 'status='+(dr._status||dr.status), 'Name='+dr.DisplayName, 'Level='+dr.Level, 'hasRoster='+!!dr.Roster);
const B='0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const used=await db.collection('owners/'+B+'/usedDraftTokens').get();
const valid=await db.collection('owners/'+B+'/validDraftTokens').get();
console.log('Boris: validDraftTokens='+valid.size, 'usedDraftTokens='+used.size, 'usedIds='+JSON.stringify(used.docs.map(d=>d.id)));
// Go API: is the roster available for this draft?
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
try { const r=await (await fetch(`${API}/draft/2024-fast-draft-0/state/summary`)).json(); console.log('Go summary items:', (r.summary||r||[]).length || 'shape:'+JSON.stringify(r).slice(0,100)); } catch(e){ console.log('Go summary fetch:', e.message); }
process.exit(0);
