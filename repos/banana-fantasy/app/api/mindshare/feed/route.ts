/**
 * Banana X Mindshare — the live tweet feed (/mindshare bottom section).
 *
 * Returns the real tweets behind the board — every community post, quote and
 * reply the scan has stored since launch, PLUS @SBSFantasy's own posts —
 * newest first, so the page can render a clickable catalog that links out to
 * X for engagement. Merges the last two week docs so the feed survives the
 * Thursday-night board reset instead of blanking with it.
 *
 * Synthetic RT-credit docs (id `rt-…`, written per-retweeter for scoring) are
 * NOT tweets and never appear here.
 */
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { WEEKS_COLLECTION, EXCLUDED_HANDLES } from '@/lib/mindshare';
import { json, jsonError } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

interface FeedTweet {
  id: string;
  handle: string;
  text: string;
  createdAtMs: number;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  isReply: boolean;
  isQuote: boolean;
  /** House content: the company handle AND the founders' personal handles. */
  ours: boolean;
  /** @sbsdraftbot — its tweets get their own Draft Bot filter, never SBS. */
  bot: boolean;
}

export async function GET() {
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 500);
  try {
    const db = getAdminFirestore();
    const weeksSnap = await db.collection(WEEKS_COLLECTION)
      .orderBy('startsAtMs', 'desc').limit(2).get();

    const byId = new Map<string, FeedTweet>();
    await Promise.all(weeksSnap.docs.map(async (week) => {
      const snap = await week.ref.collection('tweets')
        .orderBy('createdAtMs', 'desc').limit(150).get();
      for (const d of snap.docs) {
        if (d.id.startsWith('rt-')) continue; // synthetic RT credit, not a tweet
        const t = d.data();
        const handle = String(t.authorHandle ?? '').trim();
        const text = String(t.text ?? '');
        if (!handle || !text || text.startsWith('RT of ')) continue;
        const hLower = handle.toLowerCase();
        const isBot = hLower === 'sbsdraftbot';
        // House replies stay in the feed — they just live under the Replies
        // filter like everyone else's; the SBS filter is posts-only
        // (Boris 8/14). The bot gets its own filter with only its tweets.
        byId.set(d.id, {
          id: d.id,
          handle,
          text,
          createdAtMs: Number(t.createdAtMs) || 0,
          likes: Number(t.likes) || 0,
          retweets: Number(t.retweets) || 0,
          replies: Number(t.replies) || 0,
          views: Number(t.views) || 0,
          isReply: Boolean(t.isReply),
          isQuote: Boolean(t.isQuote),
          ours: EXCLUDED_HANDLES.has(hLower) && !isBot,
          bot: isBot,
        });
      }
    }));

    // House + bot content ALWAYS survives the cap (Boris 8/14: the SBS pill
    // vanished because 50 fresh replies + bot posts crowded our older posts
    // out of a newest-80 slice) — only community tweets get truncated.
    const all = [...byId.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const house = all.filter((t) => t.ours || t.bot);
    const community = all.filter((t) => !t.ours && !t.bot).slice(0, Math.max(120 - house.length, 60));
    const tweets = [...house, ...community].sort((a, b) => b.createdAtMs - a.createdAtMs);

    return json({ tweets }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'feed read failed', 500);
  }
}
