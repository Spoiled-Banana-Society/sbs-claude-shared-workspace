/**
 * READ-ONLY audit: how much "Buy 2 → 1 Free" (buy-bonus) credit has silently
 * accrued across all users while the promo was hidden. If the promo goes
 * public as-is, every user with claimCount > 0 sees an instant CLAIM.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
if (!m) { console.error('no SA'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

// buy-bonus promo doc id is '7' for every user (seeded)
const userRefs = await db.collection('v2_users').listDocuments();
console.log('users:', userRefs.length);
let usersWithClaims = 0, totalUnclaimedDrafts = 0, usersWithProgress = 0;
const top = [];
for (let i = 0; i < userRefs.length; i += 100) {
  const chunk = userRefs.slice(i, i + 100).map((u) => u.collection('promos').doc('7'));
  const snaps = await db.getAll(...chunk);
  for (const s of snaps) {
    if (!s.exists) continue;
    const d = s.data();
    const claims = d.claimCount || 0;
    const prog = d.progressCurrent || 0;
    if (claims > 0) {
      usersWithClaims++;
      totalUnclaimedDrafts += claims; // bonusFreeDrafts = 1 per milestone
      top.push({ user: s.ref.parent.parent.id, claims, prog });
    } else if (prog > 0) {
      usersWithProgress++;
    }
  }
}
top.sort((a, b) => b.claims - a.claims);
console.log('users with UNCLAIMED milestones (claimCount>0):', usersWithClaims);
console.log('total unclaimed free drafts owed if made public as-is:', totalUnclaimedDrafts);
console.log('users mid-progress only (1/2):', usersWithProgress);
console.log('top 15 holders:', top.slice(0, 15));
