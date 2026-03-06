import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { API_CONFIG } from '@/lib/api/config';
import { getPromos, updatePromo } from '@/lib/db';

function getToken(): string {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new ApiError(500, 'X API bearer token not configured');
  return token;
}

/** Search recent tweets and return matching tweet data. */
async function searchTweetsRaw(query: string): Promise<Array<{ id: string; referenced_tweets?: Array<{ type: string; id: string }> }>> {
  const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=referenced_tweets`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`X API search error (${res.status}): ${body}`);
    throw new ApiError(502, `X API error (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

/** Check if user has directly replied to the target tweet (not to other replies in thread). */
async function checkDirectReply(tweetId: string, handle: string): Promise<boolean> {
  const query = `conversation_id:${tweetId} from:${handle}`;
  const tweets = await searchTweetsRaw(query);

  // Filter to only tweets that are direct replies to the target tweet
  return tweets.some((t) =>
    t.referenced_tweets?.some((ref) => ref.type === 'replied_to' && ref.id === tweetId)
  );
}

/** Check if user has quote-tweeted the target tweet using url: search. */
async function checkQuoteTweet(tweetUrl: string, handle: string): Promise<boolean> {
  // Quote tweets embed the original tweet URL — search for tweets by the user containing that URL
  const query = `from:${handle} url:"${tweetUrl}"`;
  const tweets = await searchTweetsRaw(query);
  return tweets.length > 0;
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
    const { tweetId, tweetUrl } = API_CONFIG.promos.tweetEngagement;

    // Check if already verified
    const promos = await getPromos(userId);
    const tweetPromo = promos.find((p) => p.type === 'tweet-engagement');
    if (tweetPromo?.claimable && (tweetPromo.claimCount ?? 0) > 0) {
      return json({ verified: true, alreadyVerified: true, hasReplied: true, hasQuoted: true });
    }

    // Check direct replies (conversation_id + filter by referenced_tweets)
    const hasReplied = await checkDirectReply(tweetId, handle);

    // Check quote tweets (url: search finds tweets containing the original tweet link)
    const hasQuoted = await checkQuoteTweet(tweetUrl, handle);

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
