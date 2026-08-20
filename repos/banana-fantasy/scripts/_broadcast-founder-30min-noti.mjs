/**
 * ⚠️ ONE-SHOT bell blast (Boris 2026-08-19): "30 min till Founder Draft".
 * One 'promo' notification per v2_users wallet → header bell. Idempotent:
 * doc id = `${wallet}__founder-30min-2026-08-19` via .create().
 * Tap → /faq#founder-draft.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const APPLY = process.argv.includes('--apply');
const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1],'base64').toString('utf8'))) });
const db = admin.firestore();
const DEDUPE = 'founder-30min-2026-08-19';
const ZERO = '0x0000000000000000000000000000000000000000';
const NOTI = {
  type: 'founder_draft',
  title: '30 min till Founder Draft',
  message: 'Join with a paid draft and get a Free Spin. Tap to learn more.',
  link: '/faq#founder-draft',
  dedupeKey: DEDUPE,
  icon: 'crown',
  read: false,
};
const refs = await db.collection('v2_users').listDocuments();
const wallets = refs.map(r=>r.id.toLowerCase()).filter(w=>w.startsWith('0x') && w!==ZERO);
console.log(`${APPLY?'APPLYING':'DRY RUN'} — ${wallets.length} wallets`);
let created=0, skipped=0, failed=0;
for (const w of wallets) {
  if (!APPLY) { created++; continue; }
  try {
    await db.collection('marketplace_notifications').doc(`${w}__${DEDUPE}`).create({ ...NOTI, wallet: w, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    created++;
  } catch (e) { if (e.code===6) skipped++; else failed++; }
}
console.log(JSON.stringify({created, skipped, failed}));
