/**
 * Banana X Mindshare scan cron — every 5 min (vercel.json).
 *
 * Pulls new @SBSFantasy mentions, refreshes recent engagement metrics,
 * rescores the week's tiles, and handles the Thursday-9pm-ET rollover
 * (snapshot top 25 → board resets to zero). Tolerates twitterapi.io being
 * down/out of credits: scores from stored tweets and reports the error in
 * the heartbeat summary instead of failing the run.
 */
import { runMindshareScan } from '@/lib/mindshare';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 500);
  try {
    const summary = await runMindshareScan();
    await recordCronHeartbeat('mindshare-scan', summary);
    return json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'scan failed';
    await recordCronHeartbeat('mindshare-scan', { ok: false, error: message.slice(0, 200) });
    return jsonError(message, 500);
  }
}
