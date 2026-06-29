import admin from 'firebase-admin';
import fs from 'fs';
const b64 = fs.readFileSync('lib/firebaseAdmin.ts','utf8').match(/STAGING_SA_B64 = '([^']+)'/)[1];
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(b64,'base64').toString('utf8'))), databaseURL:'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db=admin.firestore(); const rtdb=admin.database();

// token 408 full draftTokens + metadata + index
console.log('=== token 408 ===');
const dt=(await db.collection('draftTokens').doc('408').get()).data()||{};
console.log('draftTokens/408:', JSON.stringify(dt).slice(0,400));
const md=(await db.collection('draftTokenMetadata').doc('408').get()).data()||{};
console.log('metadata Name:', md.Name, '| attrs:', JSON.stringify(md.Attributes));
const ix=(await db.collection('marketplace_index').doc('408').get()).data()||{};
console.log('marketplace_index/408:', JSON.stringify({status:ix.status,level:ix.level,league:ix.leagueNumber,roster:(ix.roster||[]).length}));

// HOF Draft #3 status (2025-slow-draft-3)
console.log('\n=== HOF Draft #3 (2025-slow-draft-3) ===');
const rt=(await rtdb.ref('drafts/2025-slow-draft-3/realTimeDraftInfo').get()).val()||{};
console.log('RTDB:', JSON.stringify({complete:rt.isDraftComplete,closed:rt.isDraftClosed,pick:rt.pickNumber,type:rt.type,numPlayers:(await rtdb.ref('drafts/2025-slow-draft-3/numPlayers').get()).val()}));
const info=(await db.collection('drafts').doc('2025-slow-draft-3').collection('state').doc('info').get()).data()||{};
console.log('info DisplayName:', info.DisplayName);
