/**
 * Unstick 2025-slow-draft-45 (HOF #60): pick 8 completed but the turn pointer
 * never advanced (pointer-only freeze, 2026-08-25). Writes exactly what the
 * engine's own advance would have: pointer → pick 9 (Gabman114), fresh 8h
 * clock, lastPick = the real pick 8. Boris-approved 2026-08-25.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = admin.firestore();
const rtdb = admin.database();
const info = (await db.doc('drafts/2025-slow-draft-45/state/info').get()).data();
const order = info.DraftOrder;
const p9 = order[8].OwnerId, p10 = order[9].OwnerId;
console.log('pick 9 drafter:', p9, '| on deck:', p10);
const nowS = Math.floor(Date.now() / 1000);
await rtdb.ref('drafts/2025-slow-draft-45/realTimeDraftInfo').update({
  lastPick: { displayName: 'MIN-WR1', ownerAddress: '0xc54fb4a88b1b5b02503fb6edb64e45d34147d85b', pickNum: 8, playerId: 'MIN-WR1', position: 'WR', round: 1, team: 'MIN' },
  pickNumber: 9, pickInRound: 9, roundNum: 1,
  currentDrafter: p9, onDeckDrafter: p10,
  pickStartTime: nowS, pickEndTime: nowS + 28800,
});
await db.doc('drafts/2025-slow-draft-45/state/info').update({
  CurrentPickNumber: 9, PickInRound: 9, CurrentRound: 1, CurrentDrafter: p9,
});
const check = (await rtdb.ref('drafts/2025-slow-draft-45/realTimeDraftInfo').once('value')).val();
console.log('AFTER: pick', check.pickNumber, '| drafter', check.currentDrafter, '| clock ends', new Date(check.pickEndTime * 1000).toISOString());
process.exit(0);
