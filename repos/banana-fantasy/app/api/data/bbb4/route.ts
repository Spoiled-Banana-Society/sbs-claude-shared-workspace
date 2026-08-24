import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { bbb4ToCsv, getBbb4Dataset } from '@/lib/bbb4Export';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Public BBB4 team dataset.
 *   ?format=csv      → download (default)
 *   ?format=json     → full dataset
 *   ?format=summary  → counts only, used by /data/bbb4
 *
 * The dataset is built at most once an hour in-process and the response is
 * CDN-cached for an hour, so the Firestore scan is never per request.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const format = new URL(req.url).searchParams.get('format') ?? 'csv';
  const cacheHeaders = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

  try {
    const data = await getBbb4Dataset();
    const stamp = data.generatedAt.slice(0, 10).replace(/-/g, '');

    if (format === 'json') {
      return new Response(JSON.stringify(data), {
        headers: {
          ...cacheHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="sbs_bbb4_teams_${stamp}.json"`,
        },
      });
    }
    if (format === 'summary') {
      const { teams: _teams, ...summary } = data;
      return Response.json(summary, { headers: cacheHeaders });
    }
    return new Response(bbb4ToCsv(data), {
      headers: {
        ...cacheHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sbs_bbb4_teams_${stamp}.csv"`,
      },
    });
  } catch (err) {
    console.error('[data/bbb4] build failed', err);
    return Response.json({ error: 'Dataset temporarily unavailable' }, { status: 503 });
  }
}
