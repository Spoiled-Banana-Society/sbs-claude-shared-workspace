// One-time: create system_config/botBrain — the bot brain's dials + kill switch.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const ref = db.collection('system_config').doc('botBrain');
const existing = await ref.get();
if (existing.exists) { console.log('already exists:', existing.data()); process.exit(0); }
const cfg = {
  enabled: true, // safe: brain only acts on botWallets members (pool currently empty)
  fastMinDelaySec: 10,
  fastMaxDelaySec: 30,
  slowMinDelaySec: 30,
  slowMaxDelaySec: 90,
  topN: 5,
  positionCaps: { QB: 3, RB: 7, WR: 8, TE: 3, DST: 3 },
  createdAt: new Date().toISOString(),
  note: 'Dials for functions onBotTurn (house-bot picking). enabled:false = hard off.',
};
await ref.set(cfg);
console.log('created system_config/botBrain:', cfg);
