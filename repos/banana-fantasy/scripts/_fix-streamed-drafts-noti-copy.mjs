/**
 * One-time fix: rewrite the streamed-drafts bell (Boris-approved copy,
 * 2026-08-24) — corrects Justin's day to Wednesday and splits the nights
 * onto separate lines. Idempotent: rewrites title+message on every
 * *__streamed-drafts-herzig-castro doc.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
if (!m) { console.error('no SA'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const TITLE = '🍌 SBS streamed drafts with Best Ball legends this week';
const MESSAGE = "Tuesday 9:30PM ET — Felix Castro, DK Best Ball Milly winner, drafts SBS live on his stream.\nWednesday 9PM ET — Founder Draft with Justin Herzig, best ball's GOAT and SBS advisor.\nTap to learn more.";

const snap = await db.collection('marketplace_notifications').where('dedupeKey', '==', 'streamed-drafts-herzig-castro').get();
console.log(`found ${snap.size} docs`);
let updated = 0, failed = 0;
for (const doc of snap.docs) {
  try { await doc.ref.update({ title: TITLE, message: MESSAGE }); updated++; }
  catch (e) { failed++; console.error('FAIL', doc.id, String(e).slice(0, 80)); }
}
console.log(`done: updated=${updated} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
