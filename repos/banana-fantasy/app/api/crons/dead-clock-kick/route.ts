import { FieldValue } from 'firebase-admin/firestore';

import { getAdminApp, getAdminDatabase, getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logErrorEvent } from '@/lib/errorEvents';
import { LOG_SOURCES } from '@/lib/logSources';
import { logger } from '@/lib/logger';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dead-clock kick — the missing backstop for a draft whose pick clock has
 * EXPIRED and nothing is going to advance it.
 *
 * Born 2026-08-27, BBB #757 (2026-slow-draft-108): pick 128's roster write hit
 * Firestore DeadlineExceeded mid-pick (summary written, advance + next-pick
 * Cloud Task lost). The pointer heal moved it to pick 129 with a fresh clock
 * but — like every pointer heal, manual or cron — could not arm the Go
 * auto-draft Cloud Task. The clock ran out at 3:39 PM PT and the draft sat
 * dead for 3 hours while the on-clock user got "pick time expired" 15 times.
 * The Go watchdog never saw it: it sweeps only the 30 NEWEST ids per lane and
 * slow drafts run for days, so an older-but-active slow draft falls out of the
 * window (it also skips 2025-slow-draft-* entirely). The stall canary never
 * alerted either: it takes the 40 highest-numbered ids across BOTH lanes,
 * which are all fast drafts.
 *
 * What this does: every 2 min, for EVERY started, unfinished draft on any lane
 * (2026 fast/slow + 2025 slow specials) whose clock expired ≥ GRACE ago, POST
 * the engine's OWN auto-draft endpoint for the on-clock user with the pick
 * number it is on. That is byte-for-byte what the lost Cloud Task would have
 * sent: the handler recomputes the pick from the user's queue/ADP, counts the
 * miss, processes the pick, and ProcessNewPick arms the NEXT pick's task — so
 * the draft is back on the normal machinery from there.
 *
 * Safety:
 *  - Only fires when the clock is already past (the handler sleeps until
 *    PickEndTime otherwise — we never hold a request open).
 *  - Idempotent target: the handler no-ops with "Pick already completed" if
 *    the pick advanced meanwhile. A half-committed pick (summary ahead of the
 *    pointer) is rejected benignly by the engine and left to the pointer heal.
 *  - Zombie guard like the Go watchdog: clocks dead > 48h are old wreckage
 *    (abandoned experiments) and are reported, never kicked.
 *  - Per-(draft, pick) marker with a RETRY_MS cooldown, MAX_KICKS per run.
 *  - Every kick lands in the admin Logs feed (critical) + bells the admin
 *    wallet — nothing happens silently.
 */

const GRACE_SEC = 3 * 60;              // engine autopick lag is seconds; 3 min = certainly dead
const ZOMBIE_SEC = 48 * 60 * 60;       // older than this = don't revive (mirrors Go watchdog)
const RETRY_MS = 10 * 60_000;          // re-kick the same (draft, pick) at most every 10 min
const MAX_KICKS = 5;
const LANES = ['2026-fast-draft-', '2026-slow-draft-', '2025-slow-draft-'] as const;
const NEWEST_PER_LANE = 400;           // fast drafts finish in ~75 min; slow lanes are fully covered
const MARKERS = 'draft_deadclock_kicks';
const ADMIN_BELL_WALLET = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const STAGING_API = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

interface RealTimeDraftInfo {
  currentDrafter?: string;
  pickNumber?: number;
  roundNum?: number;
  pickEndTime?: number;
  draftStartTime?: number;
  isDraftComplete?: boolean;
  isDraftClosed?: boolean;
}

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

function goApiBase(): string {
  return (process.env.STAGING_DRAFTS_API_URL || process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || STAGING_API).replace(/\/$/, '');
}

/** All draft ids on the covered lanes, newest N per lane by trailing number (shallow RTDB read — keys only). */
async function candidateIds(): Promise<string[]> {
  const app = getAdminApp();
  const opts = app.options as { databaseURL?: string; credential?: { getAccessToken(): Promise<{ access_token: string }> } };
  const dbUrl = opts.databaseURL || process.env.NEXT_PUBLIC_DATABASE_URL || 'https://sbs-staging-env-default-rtdb.firebaseio.com';
  const token = opts.credential ? await opts.credential.getAccessToken().catch(() => null) : null;
  if (!token?.access_token) return [];
  const res = await fetch(`${dbUrl}/drafts.json?shallow=true&access_token=${encodeURIComponent(token.access_token)}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const keys = Object.keys(((await res.json()) ?? {}) as Record<string, unknown>);
  const out: string[] = [];
  for (const lane of LANES) {
    const nums = keys
      .filter((k) => k.startsWith(lane) && /^\d+$/.test(k.slice(lane.length)))
      .map((k) => Number(k.slice(lane.length)))
      .sort((a, b) => b - a)
      .slice(0, NEWEST_PER_LANE);
    for (const n of nums) out.push(`${lane}${n}`);
  }
  return out;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  const db = getAdminFirestore();
  const rtdb = getAdminDatabase();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const ids = await candidateIds();
  const dead: Array<{ id: string; rt: RealTimeDraftInfo; deadForSec: number }> = [];
  const zombies: string[] = [];

  // Bounded concurrency: a few hundred tiny RTDB reads every 2 min.
  const CONC = 25;
  for (let i = 0; i < ids.length; i += CONC) {
    await Promise.all(ids.slice(i, i + CONC).map(async (id) => {
      try {
        const rt = ((await rtdb.ref(`drafts/${id}/realTimeDraftInfo`).get()).val() ?? null) as RealTimeDraftInfo | null;
        if (!rt || rt.isDraftComplete || rt.isDraftClosed) return;
        if (!rt.pickEndTime || !rt.draftStartTime || nowSec < rt.draftStartTime) return;
        if (!rt.pickNumber || !rt.currentDrafter) return;
        const deadForSec = nowSec - rt.pickEndTime;
        if (deadForSec < GRACE_SEC) return;
        if (deadForSec > ZOMBIE_SEC) { zombies.push(id); return; }
        dead.push({ id, rt, deadForSec });
      } catch { /* one unreadable draft never sinks the sweep */ }
    }));
  }
  dead.sort((a, b) => b.deadForSec - a.deadForSec);

  const kicked: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const base = goApiBase();

  for (const { id, rt, deadForSec } of dead) {
    if (kicked.length >= MAX_KICKS) { skipped.push(`${id} (cap)`); continue; }
    const pick = Number(rt.pickNumber);
    const marker = db.collection(MARKERS).doc(`${id}__pick-${pick}`);
    const prev = (await marker.get()).data() as { kickedAtMs?: number; attempts?: number } | undefined;
    if (prev?.kickedAtMs && nowMs - prev.kickedAtMs < RETRY_MS) { skipped.push(`${id} (cooldown)`); continue; }
    await marker.set({
      draftId: id, pick, drafter: rt.currentDrafter, kickedAtMs: nowMs,
      attempts: FieldValue.increment(1), deadForSec, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    try {
      const url = `${base}/draft-actions/${id}/owner/${rt.currentDrafter}/actions/autoDraft`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPickNumber: pick, currentRound: Number(rt.roundNum) || 1, isServerPick: true }),
        cache: 'no-store',
      });
      const text = (await res.text()).slice(0, 200);
      await marker.set({ lastStatus: res.status, lastBody: text }, { merge: true });
      const line = `${id} pick ${pick} (dead ${Math.round(deadForSec / 60)} min) → ${res.status} ${text}`;
      if (res.ok) kicked.push(line); else failed.push(line);
      logger[res.ok ? 'warn' : 'error']('cron.dead_clock_kick', { draftId: id, pick, drafter: rt.currentDrafter, deadForSec, status: res.status, body: text });
      await logErrorEvent({
        source: LOG_SOURCES.draft.STALLED_NO_ADVANCE,
        route: '/api/crons/dead-clock-kick',
        message: `Dead clock KICKED: ${line}`,
        actor: rt.currentDrafter,
        context: { draftId: id, pick, round: rt.roundNum ?? null, deadForSec, status: res.status, body: text },
      });
    } catch (err) {
      failed.push(`${id} pick ${pick}: ${(err as Error).message}`);
      logger.error('cron.dead_clock_kick.failed', { draftId: id, pick, err: (err as Error).message });
    }
  }

  if (kicked.length || failed.length) {
    const msg = [
      kicked.length ? `Kicked expired clocks: ${kicked.join(' | ')}` : '',
      failed.length ? `KICK FAILED (manual look): ${failed.join(' | ')}` : '',
    ].filter(Boolean).join('\n');
    await db.collection('marketplace_notifications').doc(`${ADMIN_BELL_WALLET}__deadclock-${nowMs}`).create({
      wallet: ADMIN_BELL_WALLET, type: 'promo', title: '⏱ Dead-clock kick',
      message: msg, link: '/admin?tab=drafts', dedupeKey: `deadclock-${nowMs}`,
      icon: '⏱', read: false, createdAt: FieldValue.serverTimestamp(),
    }).catch(() => { /* bell is best-effort */ });
  }

  await recordCronHeartbeat('dead-clock-kick', { checked: ids.length, dead: dead.length, kicked: kicked.length });
  return json({ ok: true, checked: ids.length, dead: dead.length, kicked, skipped, failed, zombies });
}
