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

/** Search recent tweets using a query string. */
async function searchTweets(query: string): Promise<boolean> {
  const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`X API search error (${res.status}): ${body}`);
    throw new ApiError(502, `X API error (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.meta?.result_count ?? 0) > 0;
}

/** Check if a user quote-tweeted a specific tweet using the quote_tweets endpoint. */
async function checkQuoteTweets(tweetId: string, handle: string): Promise<boolean> {
  // Paginate through up to 100 quote tweets to find the user's
  let nextToken: string | undefined;
  const lowerHandle = handle.toLowerCase();

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      max_results: '100',
      expansions: 'author_id',
      'user.fields': 'username',
    });
    if (nextToken) params.set('pagination_token', nextToken);

    const url = `https://api.x.com/2/tweets/${tweetId}/quote_tweets?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`X API quote_tweets error (${res.status}): ${body}`);
      throw new ApiError(502, `X API error (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const users: Array<{ id: string; username: string }> = data.includes?.users ?? [];

    // Check if any author matches the handle
    if (users.some((u) => u.username.toLowerCase() === lowerHandle)) {
      return true;
    }

    nextToken = data.meta?.next_token;
    if (!nextToken || (data.meta?.result_count ?? 0) === 0) break;
  }

  return false;
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

    // Check replies via search (conversation_id is a valid search operator)
    const repliedQuery = `conversation_id:${tweetId} from:${handle}`;
    const hasReplied = await searchTweets(repliedQuery);

    // Check quote tweets via dedicated endpoint
    const hasQuoted = await checkQuoteTweets(tweetId, handle);

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
