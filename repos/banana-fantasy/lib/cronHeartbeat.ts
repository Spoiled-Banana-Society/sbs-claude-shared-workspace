/**
 * Cron heartbeats — "who watches the watchers."
 *
 * The canaries, state audits, and mint-fulfillment all DEPEND on their cron
 * firing. If a cron silently stops (Vercel hiccup, config change, deploy error),
 * the safety net it powers goes dark with NO alert — the worst kind of blind
 * spot. So each critical cron stamps a heartbeat on every successful run, and a
 * frequently-running cron checks that none have gone stale.
 *
 * Cold-start safe: a MISSING heartbeat is skipped (a cron that has never run
 * yet, e.g. right after deploy, shouldn't false-alarm). We only alert when a
 * heartbeat EXISTS but is older than the cron's interval + grace — i.e. it was
 * running and then stopped, which is the real signal.
 *
 * Self-monitoring limit: a checker can't detect its own death. So the check runs
 * in BOTH the 5-min canary (fast) and the 6-h audit (backstop) — they cross-
 * cover each other. If the entire cron system dies, the Logs feed + daily digest
 * also go quiet, which is the human-noticeable fallback.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirestoreConfigured } from './firebaseAdmin';
import type { AuditFinding } from './audits/checks';

const HEARTBEAT_COLLECTION = 'cron_heartbeats';

/** The crons whose silence is dangerous, with how often they should run. */
const CRITICAL_CRONS: Array<{ name: string; everyMin: number; graceMin: number; does: string }> = [
  { name: 'fulfill-failed-mints', everyMin: 2,   graceMin: 13, does: 'auto-fulfills paid-but-unminted passes (users who paid get their pass)' },
  { name: 'health-canary',        everyMin: 5,   graceMin: 15, does: 'live endpoint canaries (promo/withdraw contract checks)' },
  { name: 'audit-integrity',      everyMin: 360, graceMin: 90, does: 'state-integrity audits (pass drift, duplicates, balances)' },
  { name: 'wheel-period-keeper',  everyMin: 5,   graceMin: 15, does: 'wheel period rollover' },
  { name: 'capture-draft-data',   everyMin: 5,   graceMin: 15, does: 'server-side draft-close pick-data capture (the safety net that guarantees every team card gets its pick data even if no client fires the close trigger)' },
];

/** Stamp a successful run. Best-effort — never throws into the cron.
 *  `summary` (optional) is stored verbatim on the heartbeat doc — cheap
 *  observability for crons whose logger output doesn't persist anywhere
 *  (the deposit sweep ran "green" for days while crediting nothing, and
 *  there was no way to see why — 2026-08-04). */
export async function recordCronHeartbeat(name: string, summary?: Record<string, unknown>): Promise<void> {
  if (!isFirestoreConfigured()) return;
  try {
    await getAdminFirestore()
      .collection(HEARTBEAT_COLLECTION)
      .doc(name)
      .set({ name, lastRunAt: FieldValue.serverTimestamp(), ...(summary ? { lastRunSummary: summary } : {}) }, { merge: true });
  } catch {
    /* heartbeat is best-effort; don't fail the cron over it */
  }
}

/** Returns a critical finding for each critical cron that ran before but has gone stale. */
export async function checkCronHeartbeats(nowMs: number): Promise<AuditFinding[]> {
  if (!isFirestoreConfigured()) return [];
  const db = getAdminFirestore();
  const findings: AuditFinding[] = [];
  for (const c of CRITICAL_CRONS) {
    let lastMs = 0;
    try {
      const snap = await db.collection(HEARTBEAT_COLLECTION).doc(c.name).get();
      if (!snap.exists) continue; // never run yet (cold start) — don't false-alarm
      const ts = snap.data()?.lastRunAt;
      lastMs = ts?.toMillis ? ts.toMillis() : 0;
    } catch {
      continue;
    }
    if (!lastMs) continue;
    const ageMin = Math.round((nowMs - lastMs) / 60000);
    const maxMin = c.everyMin + c.graceMin;
    if (ageMin > maxMin) {
      findings.push({
        source: 'audit.cron.stopped',
        severity: 'critical',
        message: `Cron "${c.name}" has not run in ${ageMin} min (expected every ${c.everyMin} min). It ${c.does} — that safety net is currently DARK. Check Vercel cron status / last deploy.`,
        context: { cron: c.name, ageMin, expectedEveryMin: c.everyMin },
      });
    }
  }
  return findings;
}
