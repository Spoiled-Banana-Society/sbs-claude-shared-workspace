import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { API_CONFIG } from '@/lib/api/config';
import { getPromos, updatePromo } from '@/lib/db';

async function searchTweets(query: string): Promise<boolean> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    throw new ApiError(500, 'X API bearer token not configured');
  }

  const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`X API error (${res.status}): ${body}`);
    // Surface the actual error to the client so we can debug
    throw new ApiError(502, `X API error (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.meta?.result_count ?? 0) > 0;
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const xHandle = requireString(body.xHandle, 'xHandle');

    // Strip @ prefix if present
    const handle = xHandle.replace(/^@/, '');
    const { tweetId } = API_CONFIG.promos.tweetEngagement;

    // Check if already verified
    const promos = await getPromos(userId);
    const tweetPromo = promos.find((p) => p.type === 'tweet-engagement');
    if (tweetPromo?.claimable && (tweetPromo.claimCount ?? 0) > 0) {
      return json({ verified: true, alreadyVerified: true, hasReplied: true, hasQuoted: true });
    }

    // Search for replies (conversation_id matches the tweet)
    const repliedQuery = `conversation_id:${tweetId} from:${handle}`;
    const hasReplied = await searchTweets(repliedQuery);

    // Search for quote tweets
    const qrtQuery = `quoted_tweet_id:${tweetId} from:${handle}`;
    const hasQuoted = await searchTweets(qrtQuery);

    // Both are required
    if (!hasReplied || !hasQuoted) {
      return json({
        verified: false,
        hasReplied,
        hasQuoted,
        message: !hasReplied && !hasQuoted
          ? 'No reply or quote tweet found yet.'
          : !hasReplied
            ? 'Quote tweet found! Now reply to the tweet to complete verification.'
            : 'Reply found! Now quote-retweet the tweet to complete verification.',
      });
    }

    // Both found — update the promo to claimable
    if (tweetPromo) {
      await updatePromo(userId, tweetPromo.id, { claimable: true, claimCount: 1 });
    }

    return json({ verified: true, hasReplied: true, hasQuoted: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
