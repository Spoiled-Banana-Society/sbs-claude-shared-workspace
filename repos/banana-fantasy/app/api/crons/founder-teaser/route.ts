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
 * Sends the "Founder Draft tomorrow — <time> PT" BELL (no toast, real-time via
 * createNotification) to EVERY logged-in user, ONCE, at exactly 24h before the
 * Founder Draft (i.e. the day-before at the same clock time). On launch day the
 * Founder Draft is Wed 6PM PT, so this fires Tue 6PM PT — a single clean ping
 * that lands well after the launch-hour onboarding flood, not buried in it.
 *
 * The day-OF bell stays on-login (returning-check). The day-BEFORE on-login
 * bell was removed so the only "tomorrow" ping is this broadcast.
 *
 * Idempotent two ways: a `teaserBroadcastKey` flag on the schedule doc stops a
 * re-broadcast, and each user's bell uses the SAME dedupeKey as the on-login
 * path (`founder-tomorrow-<eventDate>`) so no one can be double-pinged.
 *
 * Auth: Vercel injects `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);

  try {
    const db = getAdminFirestore();
    const fsRef = db.collection('founderSchedule').doc('next');
    const fsSnap = await fsRef.get();
    const fs = fsSnap.exists ? (fsSnap.data() as { at?: string; active?: boolean; teaserBroadcastKey?: string }) : null;
    const eventMs = fs?.active && typeof fs.at === 'string' ? Date.parse(fs.at) : NaN;
    if (!Number.isFinite(eventMs)) return json({ ok: true, skipped: 'no active founder schedule' }, 200);

    const now = Date.now();
    if (now >= eventMs) return json({ ok: true, skipped: 'event already started' }, 200);

    const timePT = new Date(eventMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) + ' PT';
    const ptDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
    const isEventDay = ptDate(now) === ptDate(eventMs);
    const dateKey = new Date(eventMs).toISOString().slice(0, 10);      // day-before key
    const minuteKey = new Date(eventMs).toISOString().slice(0, 16);    // day-of key — MATCHES the
                                                                       // returning-check on-login bell
                                                                       // (`founder-today-<minuteKey>`)
                                                                       // so a user who got the login
                                                                       // bell is deduped, never doubled.
    const fsd = fs as { teaserBroadcastKey?: string; teaserDayofKey?: string };

    // Broadcast one payload to EVERY logged-in user (orderBy firstLoginAt excludes
    // never-logged-in imports). createNotification dedupes per (wallet, dedupeKey).
    const usersSnap = await db.collection('v2_users').orderBy('firstLoginAt').get();
    const wallets = usersSnap.docs.map((d) => d.id).filter((w) => /^0x[0-9a-f]{40}$/.test(w.toLowerCase()));
    const broadcast = async (payload: Parameters<typeof createNotification>[1]) => {
      let sent = 0;
      const BATCH = 50;
      for (let i = 0; i < wallets.length; i += BATCH) {
        const chunk = wallets.slice(i, i + BATCH);
        const results = await Promise.allSettled(chunk.map((w) => createNotification(w, payload)));
        sent += results.filter((r) => r.status === 'fulfilled').length;
      }
      return sent;
    };

    // DAY-OF (event day, before event time): ping ALL users "today" — same as the
    // on-login bell but reaching everyone, not just people who happen to open the
    // app. Idempotent via `teaserDayofKey`.
    if (isEventDay) {
      if (fsd?.teaserDayofKey === minuteKey) return json({ ok: true, skipped: 'day-of already broadcast', minuteKey }, 200);
      const sent = await broadcast({
        type: 'founder_draft',
        title: `Founder Draft today — ${timePT}`,
        message: 'The Founder Draft drops today. Tap to learn how Founder Drafts work.',
        link: '/faq#founder-draft',
        dedupeKey: `founder-today-${minuteKey}`,
        icon: 'crown',
      });
      await fsRef.set({ teaserDayofKey: minuteKey, teaserDayofAt: new Date(now).toISOString() }, { merge: true });
      logger.info('cron.founder-teaser.dayof', { minuteKey, users: wallets.length, sent, timePT });
      return json({ ok: true, phase: 'day-of', minuteKey, users: wallets.length, sent, timePT }, 200);
    }

    // DAY-BEFORE (from 24h before until the event day begins): "tomorrow" ping.
    const broadcastAt = eventMs - 86_400_000;
    if (now < broadcastAt) return json({ ok: true, skipped: 'too early', broadcastAt: new Date(broadcastAt).toISOString() }, 200);
    if (fsd?.teaserBroadcastKey === dateKey) return json({ ok: true, skipped: 'day-before already broadcast', dateKey }, 200);
    const sent = await broadcast({
      type: 'founder_draft',
      title: `Founder Draft tomorrow — ${timePT}`,
      message: 'A Founder Draft drops tomorrow. Tap to learn how Founder Drafts work.',
      link: '/faq#founder-draft',
      dedupeKey: `founder-tomorrow-${dateKey}`,
      icon: 'crown',
    });
    await fsRef.set({ teaserBroadcastKey: dateKey, teaserBroadcastAt: new Date(now).toISOString() }, { merge: true });
    logger.info('cron.founder-teaser.broadcast', { dateKey, users: wallets.length, sent, timePT });
    return json({ ok: true, phase: 'day-before', dateKey, users: wallets.length, sent, timePT }, 200);
  } catch (err) {
    logger.error('cron.founder-teaser.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
