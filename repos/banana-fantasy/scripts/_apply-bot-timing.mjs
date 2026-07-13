// PREPARED 2026-07-12, RUN ONLY ON RICHARD'S GREEN LIGHT (after draft-122 ends).
// Rich's spec: on a fast 30s clock the bot should pick with 29..9 seconds LEFT
// on the clock — i.e. wait only 1..21s after its turn starts (the old 10-30s
// wait let picks land as late as ~5s left, which reads as buzzer-sniping).
// Slow drafts unchanged (30-90s wait is invisible on an 8h clock).
// Config-only: the CF reads these dials per turn — no redeploy needed.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(readFileSync('lib/firebaseAdmin.ts', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const ref = admin.firestore().collection('system_config').doc('botBrain');
await ref.set(
  {
    fastMinDelaySec: 1,
    fastMaxDelaySec: 21,
    timingNote: 'Richard 2026-07-12: fast picks land with 29..9s LEFT on the 30s clock (wait 1..21s). Was 10-30s wait = as late as 5s left.',
  },
  { merge: true },
);
const after = (await ref.get()).data();
console.log('fast delay now', after.fastMinDelaySec + '-' + after.fastMaxDelaySec + 's (waits) | slow', after.slowMinDelaySec + '-' + after.slowMaxDelaySec + 's | enabled:', after.enabled);
process.exit(0);
