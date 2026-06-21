/**
 * Frozen-draft watchdog — DETECTION ONLY (no auto-fix).
 *
 * Born from the 2026-06-10 freeze of 2024-fast-draft-1381: a transient
 * Firestore DeadlineExceeded killed ProcessNewPick mid-pick, the advance +
 * next auto-pick Cloud Task were lost, and the draft sat frozen at 00:00
 * forever — with NOTHING in the admin feed (the Go engine's plain-text error
 * prints carry no severity, so the error-sync cron never saw them).
 *
 * Every health-canary run (5 min) this reads the most recent drafts'
 * realTimeDraftInfo straight from RTDB (the engine's own live state) and
 * flags any draft that is started, not complete, and whose pick clock
 * expired more than STALL_GRACE_MS ago. Findings flow into the admin Logs
 * feed as CRITICAL (`draft.stalled_no_advance` matches the admin-badge
 * patterns). A Firestore create-once marker per (draft, pick) keeps the
 * 5-minute cron from re-alerting the same stall forever.
 */

import { getAdminApp, getAdminDatabase, getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { LOG_SOURCES } from '@/lib/logSources';

const STAGING_RTDB_URL = 'https://sbs-staging-env-default-rtdb.firebaseio.com';

const STALL_GRACE_MS = 3 * 60 * 1000; // clock must be >3 min past expiry — no false alarms on normal autopick lag
const RECENT_DRAFTS_TO_CHECK = 40;    // newest N drafts by trailing league number
const ALERT_MARKERS_COLLECTION = 'draft_stall_alerts';

export interface StallFinding {
  source: string;
  message: string;
  context: Record<string, unknown>;
  severity: 'critical';
  actor?: string;
}

interface RealTimeDraftInfo {
  currentDrafter?: string;
  pickNumber?: number;
  roundNum?: number;
  pickEndTime?: number;   // unix seconds
  pickLength?: number;
  isDraftComplete?: boolean;
  isDraftClosed?: boolean;
}

/** Trailing number in a draft id ("2024-fast-draft-1381" → 1381). */
function draftNumber(id: string): number {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : -1;
}

export async function runDraftStallCanary(nowMs: number): Promise<StallFinding[]> {
  const findings: StallFinding[] = [];
  try {
    const rtdb = getAdminDatabase();
    // Shallow read of /drafts (keys only) via the REST `shallow` param — the
    // admin SDK can only fetch full subtrees, which is megabytes here. Key
    // ordering is lexicographic (\"...-999\" > \"...-1381\"), so we list ALL keys
    // cheaply and sort by trailing number ourselves. Auth: a short-lived
    // OAuth token minted from the SAME service-account credential the admin
    // app runs on.
    const app = getAdminApp();
    const opts = app.options as {
      databaseURL?: string;
      credential?: { getAccessToken(): Promise<{ access_token: string }> };
    };
    const dbUrl = opts.databaseURL || process.env.NEXT_PUBLIC_DATABASE_URL || STAGING_RTDB_URL;
    const token = opts.credential ? await opts.credential.getAccessToken().catch(() => null) : null;
    let keys: string[] = [];
    if (token?.access_token) {
      const res = await fetch(`${dbUrl}/drafts.json?shallow=true&access_token=${encodeURIComponent(token.access_token)}`);
      if (res.ok) keys = Object.keys((await res.json()) ?? {});
    }
    if (keys.length === 0) return findings;

    const recent = keys
      .filter((k) => draftNumber(k) >= 0)
      .sort((a, b) => draftNumber(b) - draftNumber(a))
      .slice(0, RECENT_DRAFTS_TO_CHECK);

    const nowSec = Math.floor(nowMs / 1000);
    for (const draftId of recent) {
      try {
        const snap = await rtdb.ref(`drafts/${draftId}/realTimeDraftInfo`).get();
        const info = (snap.val() ?? null) as RealTimeDraftInfo | null;
        if (!info) continue;
        const pick = info.pickNumber ?? 0;
        if (info.isDraftComplete || info.isDraftClosed) continue;
        if (!info.pickEndTime || pick < 1) continue;
        const stalledMs = (nowSec - info.pickEndTime) * 1000;
        if (stalledMs < STALL_GRACE_MS) continue;

        // Create-once marker so the 5-min cron alerts each stalled pick ONCE.
        if (isFirestoreConfigured()) {
          try {
            await getAdminFirestore()
              .collection(ALERT_MARKERS_COLLECTION)
              .doc(`${draftId}__pick-${pick}`)
              .create({ draftId, pick, detectedAt: new Date(nowMs).toISOString() });
          } catch {
            continue; // ALREADY_EXISTS → already alerted this stall
          }
        }

        findings.push({
          source: LOG_SOURCES.draft.STALLED_NO_ADVANCE,
          severity: 'critical',
          actor: info.currentDrafter ?? undefined,
          message: `Draft ${draftId} FROZEN at pick ${pick} (round ${info.roundNum ?? '?'}) — clock expired ${Math.round(stalledMs / 60000)} min ago, no advance. Current drafter: ${info.currentDrafter ?? '?'}.`,
          context: {
            draftId,
            pick,
            round: info.roundNum ?? null,
            currentDrafter: info.currentDrafter ?? null,
            pickEndTime: info.pickEndTime,
            stalledMinutes: Math.round(stalledMs / 60000),
          },
        });
      } catch { /* one unreadable draft never sinks the sweep */ }
    }
  } catch { /* canary is best-effort — never break health-canary */ }
  return findings;
}
