import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { getPublicUsers } from '@/lib/friends';
import { logger } from '@/lib/logger';

/**
 * GET /api/badges/king-leaderboard[?me=0x...]
 *
 * LIVE King-of-Drafts standings for the current Mon–Sun week (closes Sunday
 * 11pm PT = Monday 06:00 UTC, when the weekly cron crowns the winner).
 * Same counting basis as the cron — `draft_filled` activity events, PAID
 * passes only — so what users watch all week is exactly what gets crowned.
 *
 * Returns top 10 (with display names + pfps) plus the caller's own rank and
 * count when `me` is passed (even when outside the top 10). Cached 30s in
 * memory per instance; the client refetches on the user-event stream ping so
 * a fresh fill shows within seconds.
 */

const WEEK_CLOSE_UTC_HOUR = 6; // Monday 06:00 UTC == Sunday 11pm PT (PDT)

/** Start of the current King week: the most recent Monday 06:00 UTC ≤ now. */
function currentWeekStart(nowMs: number): Date {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  // Days since the most recent Monday (UTC).
  let daysSinceMonday = (day + 6) % 7;
  // Before Monday 06:00 UTC we're still in the PREVIOUS week.
  if (daysSinceMonday === 0 && d.getUTCHours() < WEEK_CLOSE_UTC_HOUR) daysSinceMonday = 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday, WEEK_CLOSE_UTC_HOUR, 0, 0));
  return start;
}

interface Standing { wallet: string; name: string; pfp: string | null; count: number; rank: number }

let cache: { ts: number; weekStartIso: string; standings: Standing[]; totalPlayers: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  try {
    const me = (new URL(req.url).searchParams.get('me') || '').toLowerCase();
    const now = Date.now();
    const weekStart = currentWeekStart(now);
    const weekStartIso = weekStart.toISOString();
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    if (!cache || now - cache.ts > CACHE_TTL_MS || cache.weekStartIso !== weekStartIso) {
      const db = getAdminFirestore();
      const snap = await db
        .collection(ACTIVITY_EVENTS_COLLECTION)
        .where('createdAtIso', '>=', weekStartIso)
        .get();

      const counts = new Map<string, number>();
      for (const doc of snap.docs) {
        const e = doc.data() as { type?: string; userId?: string; metadata?: { passType?: string } };
        if (e.type !== 'draft_filled') continue;
        if (e.metadata?.passType !== 'paid') continue;
        const wallet = (e.userId || '').toLowerCase();
        if (!wallet || wallet.startsWith('bot-')) continue;
        counts.set(wallet, (counts.get(wallet) ?? 0) + 1);
      }

      const sorted = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); // count desc, wallet asc (same tiebreak as the cron)

      const profileMap = await getPublicUsers(sorted.slice(0, 10).map(([w]) => w)).catch(() => new Map());
      const standings: Standing[] = sorted.map(([wallet, count], i) => {
        const p = profileMap.get(wallet);
        return {
          wallet,
          name: p?.username || `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
          pfp: p?.profilePicture ?? null,
          count,
          rank: i + 1,
        };
      });

      cache = { ts: now, weekStartIso, standings, totalPlayers: sorted.length };
    }

    const meEntry = me ? cache.standings.find((s) => s.wallet === me) ?? null : null;

    return json({
      weekStartIso,
      finalizesAtIso: weekEnd.toISOString(),
      totalPlayers: cache.totalPlayers,
      top: cache.standings.slice(0, 10),
      me: meEntry ? { rank: meEntry.rank, count: meEntry.count } : me ? { rank: null, count: 0 } : null,
    });
  } catch (err) {
    logger.error('badges.king_leaderboard.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
