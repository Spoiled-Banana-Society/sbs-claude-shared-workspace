/**
 * GET /api/config/slow-clock → the slow-draft clock switch
 * (system_config/slowDraftClock, see lib/slowClock.ts). Public, no PII.
 * CDN-cached 60s so a page load costs nothing at the origin most of the time.
 */
import { NextResponse } from 'next/server';
import { getSlowClockConfig } from '@/lib/slowClockServer';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = await getSlowClockConfig();
  return NextResponse.json(cfg, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
