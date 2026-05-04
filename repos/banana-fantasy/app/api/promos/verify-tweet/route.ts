import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { API_CONFIG } from '@/lib/api/config';
import { getPromos, updatePromo } from '@/lib/db';
import { searchTweetsRaw } from '@/lib/xApi';

/** Check if user has directly replied to the target tweet (not to other replies in thread). */
async function checkDirectReply(tweetId: string, handle: string): Promise<boolean> {
  const query = `conversation_id:${tweetId} from:${handle}`;
  const tweets = await searchTweetsRaw(query);

  // Filter to only tweets that are direct replies to the target tweet
  return tweets.some((t) =>
    t.referenced_tweets?.some((ref) => ref.type === 'replied_to' && ref.id === tweetId)
  );
}

/** Check if user has quote-tweeted the target tweet. */
async function checkQuoteTweet(tweetId: string, handle: string): Promise<boolean> {
  // Search for quote tweets by the user, then filter by referenced_tweets
  const query = `from:${handle} is:quote`;
  const tweets = await searchTweetsRaw(query);
  return tweets.some((t) =>
    t.referenced_tweets?.some((ref) => ref.type === 'quoted' && ref.id === tweetId)
  );
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

    // Check direct replies (conversation_id + filter by referenced_tweets)
    const hasReplied = await checkDirectReply(tweetId, handle);

    // Check quote tweets (is:quote search + referenced_tweets filter)
    const hasQuoted = await checkQuoteTweet(tweetId, handle);

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
