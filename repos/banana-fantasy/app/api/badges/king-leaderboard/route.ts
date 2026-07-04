import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { getPublicUsers } from '@/lib/friends';
import { currentKingWeek, tallyKingDrafts, rankKingContenders } from '@/lib/kingWeek';
import { fetchDraftRosters } from '@/lib/kingRoster';
import { fetchOwnerPaidFilledCount } from '@/lib/api/owner';
import { bananaPlaceholderName } from '@/utils/helpers';
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

interface Standing { wallet: string; name: string; pfp: string | null; count: number; rank: number }

let cache: { ts: number; weekStartIso: string; standings: Standing[]; totalPlayers: number; tieForFirst: boolean } | null = null;
const CACHE_TTL_MS = 30_000;

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

  try {
    const me = (new URL(req.url).searchParams.get('me') || '').toLowerCase();
    const now = Date.now();
    const week = currentKingWeek(now); // Mon 5am PT → Sun 11pm PT
    const weekStartIso = week.startIso;

    if (!cache || now - cache.ts > CACHE_TTL_MS || cache.weekStartIso !== weekStartIso) {
      const db = getAdminFirestore();
      const snap = await db
        .collection(ACTIVITY_EVENTS_COLLECTION)
        .where('createdAtIso', '>=', weekStartIso)
        .get();

      // Tally + rank via the SHARED helper (lib/kingWeek) — IDENTICAL basis +
      // tiebreakers to the crowning cron, so "who's in first" here is exactly
      // who gets crowned. Rules: most paid drafts → reached the count first →
      // grinding longest → joined the final lobby first.
      const ranked = await rankKingContenders(tallyKingDrafts(snap.docs, week.endIso), fetchDraftRosters);
      const sorted: [string, number][] = ranked.map(([wallet, t]) => [wallet, t.count]);
      // Two or more people tied on paid-draft count at the top → a tiebreaker
      // decides #1, so the UI should explain how. (false the rest of the time.)
      const tieForFirst = sorted.length >= 2 && sorted[0][1] === sorted[1][1];

      const profileMap = await getPublicUsers(sorted.slice(0, 10).map(([w]) => w)).catch(() => new Map());
      const standings: Standing[] = sorted.map(([wallet, count], i) => {
        const p = profileMap.get(wallet);
        return {
          wallet,
          // getPublicUsers floors covered rows to the server-assigned handle;
          // deeper rows (outside the top 10) get the neutral placeholder —
          // never the colliding wallet-hash handle, never a raw wallet slice.
          name: p?.username || bananaPlaceholderName(wallet),
          pfp: p?.profilePicture ?? null,
          count,
          rank: i + 1,
        };
      });

      cache = { ts: now, weekStartIso, standings, totalPlayers: sorted.length, tieForFirst };
    }

    const meEntry = me ? cache.standings.find((s) => s.wallet === me) ?? null : null;

    // Lifetime paid filled drafts for the viewer — same authoritative Go
    // count ripeness uses, so "this week" and "all-time" can sit side by side.
    const lifetime = me
      ? await fetchOwnerPaidFilledCount(me).catch(() => null)
      : null;

    return json({
      weekStartIso,
      finalizesAtIso: week.endIso,
      totalPlayers: cache.totalPlayers,
      tieForFirst: cache.tieForFirst,
      top: cache.standings.slice(0, 10),
      me: me
        ? { rank: meEntry?.rank ?? null, count: meEntry?.count ?? 0, lifetime }
        : null,
    });
  } catch (err) {
    logger.error('badges.king_leaderboard.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
