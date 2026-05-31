/**
 * State-integrity audit — standalone CLI.
 *
 * The proactive complement to the error feed: it audits *state* (money/fairness
 * invariants that can silently drift) rather than waiting for an event to throw.
 * Mirrors lib/audits/checks.ts so the dev (or Claude) can run it with just a
 * service account + node — no Next build. Keep the two in sync.
 *
 * Usage:
 *   SA_PATH=/path/to/staging-sa.json node scripts/audit.mjs
 *   SA_PATH=... node scripts/audit.mjs --json     # machine-readable
 *
 * Same findings the admin route (/api/admin/integrity) and the daily cron
 * (/api/crons/audit-integrity) produce and post into the admin Logs feed.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const saPath = process.env.SA_PATH || '/tmp/sa-staging.json';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const asJson = process.argv.includes('--json');

const passTypeOf = (d) => (String(d.PassType ?? d.passType ?? '').toLowerCase() === 'free' ? 'free' : 'paid');

async function spendableByOwner() {
  const snap = await db.collectionGroup('validDraftTokens').get();
  const map = new Map();
  snap.forEach((d) => {
    const m = d.ref.path.match(/owners\/([^/]+)\/validDraftTokens/);
    if (!m) return;
    const w = m[1].toLowerCase();
    const cur = map.get(w) || { paid: 0, free: 0 };
    if (passTypeOf(d.data()) === 'free') cur.free++; else cur.paid++;
    map.set(w, cur);
  });
  return map;
}

async function auditPassLedger() {
  const out = [];
  const spend = await spendableByOwner();
  const users = await db.collection('v2_users').get();
  users.forEach((doc) => {
    const x = doc.data() || {};
    const w = doc.id.toLowerCase();
    const dp = Math.max(0, Number(x.draftPasses) || 0);
    const fd = Math.max(0, Number(x.freeDrafts) || 0);
    const real = spend.get(w) || { paid: 0, free: 0 };
    if (dp > real.paid || fd > real.free) {
      out.push({ source: 'audit.passes.over', severity: 'critical', actor: doc.id, message: `counter ${dp}/${fd} > real ${real.paid}/${real.free} — blocked at join` });
    } else if (dp < real.paid || fd < real.free) {
      out.push({ source: 'audit.passes.under', severity: 'warning', actor: doc.id, message: `counter ${dp}/${fd} < real ${real.paid}/${real.free} — under-credited` });
    }
  });
  return out;
}

async function auditNegativeBalances() {
  const out = [];
  const fields = ['draftPasses', 'freeDrafts', 'wheelSpins', 'jackpotEntries', 'hofEntries', 'availableCredit', 'pendingCredit'];
  const users = await db.collection('v2_users').get();
  users.forEach((doc) => {
    const x = doc.data() || {};
    const bad = fields.filter((f) => typeof x[f] === 'number' && x[f] < 0);
    if (bad.length) out.push({ source: 'audit.balance.negative', severity: 'critical', actor: doc.id, message: bad.map((f) => `${f}=${x[f]}`).join(', ') });
  });
  return out;
}

const findings = [...(await auditPassLedger()), ...(await auditNegativeBalances())];
const crit = findings.filter((f) => f.severity === 'critical');
const warn = findings.filter((f) => f.severity === 'warning');

if (asJson) {
  console.log(JSON.stringify({ summary: { total: findings.length, critical: crit.length, warning: warn.length }, findings }, null, 2));
} else {
  console.log(`\n=== STATE INTEGRITY AUDIT ===`);
  console.log(`critical: ${crit.length}   warning: ${warn.length}   total: ${findings.length}\n`);
  for (const f of [...crit, ...warn]) {
    const tag = f.severity === 'critical' ? '🔴' : '🟡';
    console.log(`${tag} [${f.source}] ${f.actor || ''}\n     ${f.message}`);
  }
  if (!findings.length) console.log('✅ all invariants hold — counters match real spendable tokens, no negative balances.');
}
process.exit(crit.length ? 1 : 0);
