export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // broadcasting to all users — give it room

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';
import { promoWeekendActive } from '@/lib/promoWindow';

function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

// Don't advance until the event is comfortably over: the fill window is
// ±windowMinutes and the safety-net credit reads the live schedule, so rolling
// the date too early could strand a draft that fills right at the boundary.
const ADVANCE_GRACE_MS = 2 * 60 * 60 * 1000;

/** UTC instant for 18:00 (6 PM) America/Los_Angeles on the given PT calendar day. */
function sixPmPTUtcMs(y: number, m: number, d: number): number {
  // 6 PM PT is 01:00 UTC next day during PDT (UTC-7) or 02:00 UTC during PST
  // (UTC-8). Try both and keep the one that round-trips to 18:00 PT.
  for (const offset of [7, 8]) {
    const ms = Date.UTC(y, m - 1, d, 18 + offset, 0, 0);
    const pt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false, day: '2-digit',
    }).formatToParts(new Date(ms));
    const hour = Number(pt.find((p) => p.type === 'hour')?.value) % 24;
    const day = Number(pt.find((p) => p.type === 'day')?.value);
    if (hour === 18 && day === d) return ms;
  }
  return Date.UTC(y, m - 1, d, 18 + 8, 0, 0); // unreachable fallback
}

/**
 * The weekly cadence (Richard 2026-07-08): Founder Draft is ALWAYS Wednesday
 * 6 PM PT for now. Returns the first Wednesday-6PM-PT instant strictly after
 * `afterMs`, as an ISO string.
 */
function nextWednesday6pmPT(afterMs: number): string {
  const dayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  for (let d = 0; d <= 8; d++) {
    const probe = new Date(afterMs + d * 86_400_000);
    const parts = dayParts.formatToParts(probe);
    if (parts.find((p) => p.type === 'weekday')?.value !== 'Wed') continue;
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const ms = sixPmPTUtcMs(y, m, day);
    if (ms > afterMs) return new Date(ms).toISOString();
  }
  return new Date(afterMs + 7 * 86_400_000).toISOString(); // unreachable fallback
}

/**
 * GET /api/crons/founder-teaser  (hourly Vercel cron + manual admin trigger)
 *
 * The ONE and ONLY Founder Draft ping (Boris 2026-07-08: "only one ping about
 * founder draft"): a single day-OF broadcast at ~5am PT to EVERY logged-in user
 * — "Weekly Founder Draft today at <time> PT" — that deep-links to the Founder
 * Draft FAQ. Real-time bell via createNotification (no toast). There is no
 * day-before ping and no second on-login ping (both removed).
 *
 * "~5am PT": the cron ticks hourly, so this fires on the FIRST tick on the event
 * day at/after 5am PT (i.e. the 5am PT tick), never earlier. Idempotent via
 * `teaserDayofKey` on the schedule doc — later ticks that day no-op — and each
 * user's bell is deduped on `founder-today-<minuteKey>`, so no one is doubled.
 * Keying on the event minute means an admin re-time re-fires cleanly for the new
 * time (fresh key), still once.
 *
 * Auth: Vercel injects `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);

  try {
    const db = getAdminFirestore();
    const fsRef = db.collection('founderSchedule').doc('next');
    const fsSnap = await fsRef.get();
    const fs = fsSnap.exists ? (fsSnap.data() as { at?: string; active?: boolean; teaserDayofKey?: string }) : null;
    const eventMs = fs?.active && typeof fs.at === 'string' ? Date.parse(fs.at) : NaN;
    if (!Number.isFinite(eventMs)) return json({ ok: true, skipped: 'no active founder schedule' }, 200);

    const now = Date.now();
    if (now >= eventMs) {
      // AUTO-ADVANCE (incident 2026-07-08: schedule left on the prior week →
      // BBB #104 silently got no tag/spins). Once the event is 2h past, roll
      // the schedule to the next Wednesday 6 PM PT so it can never go stale.
      // Admin re-times still stick: any manually set future `at` is untouched.
      if (now >= eventMs + ADVANCE_GRACE_MS) {
        const nextAt = nextWednesday6pmPT(now);
        await fsRef.set({ at: nextAt, dayLabel: 'Wednesday at 6 PM PT', updatedAt: new Date(now).toISOString() }, { merge: true });
        logger.info('cron.founder-teaser.auto-advanced', { from: fs?.at, to: nextAt });
        return json({ ok: true, advanced: { from: fs?.at, to: nextAt } }, 200);
      }
      return json({ ok: true, skipped: 'event already started' }, 200);
    }

    const timePT = new Date(eventMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) + ' PT';
    const ptDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });

    // Day-of only: skip until we're on the event's PT calendar day.
    if (ptDate(now) !== ptDate(eventMs)) return json({ ok: true, skipped: 'not event day', ptNow: ptDate(now), ptEvent: ptDate(eventMs) }, 200);
    // ~5am PT gate: hold until the 5am PT tick (mod 24 defeats the midnight
    // "24" some Intl builds emit, so 0–4 correctly read as before-5am).
    const ptHour = Number(new Date(now).toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Los_Angeles' })) % 24;
    if (ptHour < 5) return json({ ok: true, skipped: 'before 5am PT', ptHour }, 200);

    const minuteKey = new Date(eventMs).toISOString().slice(0, 16); // per-event (to the minute)
    if (fs?.teaserDayofKey === minuteKey) return json({ ok: true, skipped: 'already broadcast', minuteKey }, 200);

    // Broadcast one payload to EVERY logged-in user (orderBy firstLoginAt excludes
    // never-logged-in imports). createNotification dedupes per (wallet, dedupeKey).
    const usersSnap = await db.collection('v2_users').orderBy('firstLoginAt').get();
    const wallets = usersSnap.docs.map((d) => d.id).filter((w) => /^0x[0-9a-f]{40}$/.test(w.toLowerCase()));
    let sent = 0;
    const BATCH = 50;
    const payload: Parameters<typeof createNotification>[1] = {
      type: 'founder_draft',
      title: `Weekly Founder Draft today at ${timePT}`,
      // Spin is the hook but it's PAID-only (free-pass entrants get the badge,
      // not the spin) — qualify it so we never promise a spin we won't grant.
      message: promoWeekendActive()
        ? 'Draft in it for a Founders badge — and this week FREE and paid entries BOTH earn a Free Spin. Tap to see how it works.'
        : 'Draft in it for a Founders badge — paid entries also earn a Free Spin. Tap to see how it works.',
      link: '/faq#founder-draft',
      dedupeKey: `founder-today-${minuteKey}`,
      icon: 'crown',
    };
    for (let i = 0; i < wallets.length; i += BATCH) {
      const chunk = wallets.slice(i, i + BATCH);
      const results = await Promise.allSettled(chunk.map((w) => createNotification(w, payload)));
      sent += results.filter((r) => r.status === 'fulfilled').length;
    }
    await fsRef.set({ teaserDayofKey: minuteKey, teaserDayofAt: new Date(now).toISOString() }, { merge: true });
    logger.info('cron.founder-teaser.dayof', { minuteKey, users: wallets.length, sent, timePT, ptHour });
    return json({ ok: true, phase: 'day-of-5am', minuteKey, users: wallets.length, sent, timePT }, 200);
  } catch (err) {
    logger.error('cron.founder-teaser.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
