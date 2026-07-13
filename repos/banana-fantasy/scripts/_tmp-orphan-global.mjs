// Global orphan drafted-history cleanup. An orphan = a usedDraftTokens record
// whose LeagueId is blank OR points at a draft that no longer exists. These are
// the leftover byproduct of past stale-DRAFT deletions that didn't cascade to
// the token side. Does NOT touch validDraftTokens (spendable passes) or pass
// counts. DRY_RUN=1 (default) reports only.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';
const REPO = '/Users/borisvagner/banana-fantasy';
const DRY = process.env.DRY_RUN !== '0';
function loadSA() {
  const src = readFileSync(join(REPO, 'lib', 'firebaseAdmin.ts'), 'utf8');
  const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
}
admin.initializeApp({ credential: admin.credential.cert(loadSA()) });
const db = admin.firestore();

// 1. All existing draft ids (cheap: ids only).
console.log('loading existing draft ids...');
const draftSnap = await db.collection('drafts').select().get();
const existing = new Set(draftSnap.docs.map((d) => d.id));
console.log('existing drafts:', existing.size);

// 2. Scan every wallet's usedDraftTokens.
console.log('scanning all usedDraftTokens (collectionGroup)...');
const used = await db.collectionGroup('usedDraftTokens').get();
let total = 0, orphanBlank = 0, orphanGone = 0, live = 0;
const orphans = []; // {ref}
const perWallet = new Map();
used.forEach((d) => {
  const m = d.ref.path.match(/owners\/([^/]+)\/usedDraftTokens/);
  if (!m) return;
  total++;
  const w = m[1].toLowerCase();
  const lid = String(d.data().LeagueId ?? '').trim();
  const isOrphan = !lid || !existing.has(lid);
  if (!isOrphan) { live++; return; }
  if (!lid) orphanBlank++; else orphanGone++;
  orphans.push(d.ref);
  perWallet.set(w, (perWallet.get(w) || 0) + 1);
});

console.log(`\n=== GLOBAL ORPHAN AUDIT ${DRY ? '(DRY RUN)' : '(LIVE DELETE)'} ===`);
console.log(`usedDraftTokens total=${total} | LIVE=${live} | ORPHAN=${orphans.length} (blankLeagueId=${orphanBlank} + draftDeleted=${orphanGone})`);
console.log(`wallets with orphans: ${perWallet.size}`);
const top = [...perWallet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('top affected wallets:', top.map(([w, n]) => `${w.slice(0, 10)}…=${n}`).join(', '));

if (DRY) { console.log('\nDRY RUN — re-run with DRY_RUN=0 to delete these orphan records.'); process.exit(0); }

let done = 0;
for (let i = 0; i < orphans.length; i += 400) {
  const batch = db.batch();
  for (const ref of orphans.slice(i, i + 400)) batch.delete(ref);
  await batch.commit();
  done += Math.min(400, orphans.length - i);
}
console.log(`\nDeleted ${done} orphan drafted-history records. (validDraftTokens / pass counts untouched.)`);
process.exit(0);
