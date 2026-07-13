/**
 * Count how many user docs have an email on file (email / blueCheckEmail),
 * and export the list to ~/Downloads/sbs_user_emails.csv.
 * Read-only. Usage: node scripts/_count-user-emails.mjs
 */
import admin from 'firebase-admin';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
if (!m) { console.error('no SA'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

async function pickUsers() {
  const v2 = db.collection('v2_users');
  if (!(await v2.limit(1).get()).empty) return v2;
  return db.collection('users');
}

const col = await pickUsers();
let total = 0, withEmail = 0;
const rows = [];
let last = null;
while (true) {
  let q = col.orderBy('__name__').limit(500);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  for (const doc of snap.docs) {
    total++;
    const d = doc.data();
    const email = (typeof d.blueCheckEmail === 'string' && d.blueCheckEmail) || (typeof d.email === 'string' && d.email) || '';
    if (email) {
      withEmail++;
      const name = d.username || (typeof d.bananaNumber === 'number' ? `Banana${d.bananaNumber}` : '');
      rows.push(`${email.toLowerCase()},${String(name).replace(/,/g, ' ')},${doc.id}`);
    }
  }
  last = snap.docs[snap.docs.length - 1];
  if (snap.size < 500) break;
}

console.log(JSON.stringify({ collection: col.id, totalUsers: total, withEmail }, null, 2));
const seen = new Set();
const unique = rows.filter(r => { const e = r.split(',')[0]; if (seen.has(e)) return false; seen.add(e); return true; });
writeFileSync(join(os.homedir(), 'Downloads', 'sbs_user_emails.csv'), 'email,username,wallet\n' + unique.join('\n'));
console.log(`unique emails: ${unique.length} → ~/Downloads/sbs_user_emails.csv`);
