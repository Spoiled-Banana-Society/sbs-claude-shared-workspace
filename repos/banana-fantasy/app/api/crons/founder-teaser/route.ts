export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // broadcasting to all users — give it room

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';

function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
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
    if (now >= eventMs) return json({ ok: true, skipped: 'event already started' }, 200);

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
      message: 'Draft in it for a Founders badge — paid entries also earn a Free Spin. Tap to see how it works.',
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
