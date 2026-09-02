/**
 * Promo code switch — system_config/promoCode (read by lib/promoCode.ts, 30s cache).
 *
 *   node scripts/_promo-code-banana.mjs --status
 *   node scripts/_promo-code-banana.mjs --on [--hours 48] [--code BANANA] [--spins 4]
 *       → enabled, startsAtMs = NOW, endsAtMs = now + hours. Run the moment the post goes up.
 *   node scripts/_promo-code-banana.mjs --off      → enabled:false (redemptions stop; already-redeemed users keep their spins)
 *   node scripts/_promo-code-banana.mjs --extend 12 → push endsAtMs out by N hours
 *   node scripts/_promo-code-banana.mjs --redemptions → count + list who redeemed
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const ref = db.collection('system_config').doc('promoCode');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const fmt = (ms) => ms ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT' : '—';

const cur = (await ref.get()).data() || {};
const show = (d) => console.log(JSON.stringify({ ...d, starts: fmt(d.startsAtMs), ends: fmt(d.endsAtMs), liveNow: !!d.enabled && Date.now() >= (d.startsAtMs||0) && Date.now() < (d.endsAtMs||0) }, null, 2));

if (flag('on')) {
  const hours = Number(val('hours', 48));
  const now = Date.now();
  const next = { enabled: true, code: String(val('code', cur.code || 'BANANA')).toUpperCase(), spins: Number(val('spins', cur.spins || 4)), startsAtMs: now, endsAtMs: now + hours * 3600_000, updatedAt: new Date().toISOString() };
  await ref.set(next, { merge: true }); console.log('ON'); show(next);
} else if (flag('off')) {
  await ref.set({ enabled: false, updatedAt: new Date().toISOString() }, { merge: true }); console.log('OFF'); show({ ...cur, enabled: false });
} else if (flag('extend')) {
  const h = Number(val('extend', 0)); const endsAtMs = (cur.endsAtMs || Date.now()) + h * 3600_000;
  await ref.set({ endsAtMs, updatedAt: new Date().toISOString() }, { merge: true }); console.log(`EXTENDED +${h}h`); show({ ...cur, endsAtMs });
} else if (flag('redemptions')) {
  const snap = await db.collection('promo_code_redemptions').orderBy('redeemedAt', 'desc').get();
  console.log(`redemptions: ${snap.size}`);
  snap.forEach((d) => { const r = d.data(); console.log(`  ${r.redeemedAt}  ${r.username || '?'}  ${d.id}  ${r.mode}  now=${r.spinsNow} onClaim=${r.spinsOnClaim}`); });
} else {
  show(cur);
}
