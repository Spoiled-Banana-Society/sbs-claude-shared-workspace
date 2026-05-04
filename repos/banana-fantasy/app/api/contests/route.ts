import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getContests } from '@/lib/db';

const DRAFTS_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

interface LeagueSummary {
  numPlayers: number;
}

async function getLiveEntryCount(): Promise<number> {
  try {
    const res = await fetch(`${DRAFTS_API_URL}/league/`, { next: { revalidate: 30 } });
    if (!res.ok) return 0;
    const leagues: LeagueSummary[] = await res.json();
    if (!Array.isArray(leagues)) return 0;
    return leagues.reduce((sum, l) => sum + (l.numPlayers || 0), 0);
  } catch {
    return 0;
  }
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const [contests, liveEntries] = await Promise.all([
      getContests(),
      getLiveEntryCount(),
    ]);

    // Patch first contest with live entry count and correct odds
    if (contests.length > 0) {
      contests[0].currentEntries = liveEntries;
      contests[0].jpPercent = 1;
      contests[0].hofPercent = 5;
    }

    return json(contests, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
