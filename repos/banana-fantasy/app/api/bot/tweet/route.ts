export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { buildTextFromPayload, iftttConfig, readCap, readLedger, relayTweet, xCreds } from '@/lib/tweetRelay';

/**
 * POST /api/bot/tweet — drop-in replacement for the IFTTT Maker webhook the
 * Draft Bot fires (`maker.ifttt.com/trigger/tweet/with/key/…`).
 *
 * Point the bot at `https://sbsfantasy.com/api/bot/tweet?key=<BOT_TWEET_SECRET>`
 * with the same JSON body it sends IFTTT today (`{value1, value2, value3}`),
 * or `{text}`. IFTTT keeps posting until its 100/24h cap is near, then posts
 * go straight to the X API as @sbsdraftbot. See lib/tweetRelay.ts.
 *
 * GET /api/bot/tweet?key=… — status: rolling-24h counts per route + config.
 */
function authed(req: Request): boolean {
  const secret = process.env.BOT_TWEET_SECRET?.trim();
  if (!secret) return false; // fail-closed
  const url = new URL(req.url);
  const candidates = [
    url.searchParams.get('key'),
    req.headers.get('x-bot-key'),
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''),
  ];
  return candidates.some((c) => c && c === secret);
}

async function readInput(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await req.formData().catch(() => null);
    return fd ? Object.fromEntries(Array.from(fd.entries()).map(([k, v]) => [k, String(v)])) : {};
  }
  const raw = await req.text().catch(() => '');
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return raw ? { text: raw } : {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Tweet text for the X API path. Classic IFTTT shape → text/value1; JSON
 * payload shape → mirrors the applet's Filter code (see lib/tweetRelay.ts).
 */
function extractText(body: Record<string, unknown>): string {
  return (str(body.text) ?? str(body.value1) ?? buildTextFromPayload(body) ?? '').trim();
}

export async function POST(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  const body = await readInput(req);
  const value1 = str(body.value1);
  const value2 = str(body.value2);
  const value3 = str(body.value3);
  const classic = value1 !== undefined || str(body.text) !== undefined;
  const text = extractText(body);
  if (!text && classic) return jsonError('Missing text (send {text} or {value1})', 400);
  if (!text && Object.keys(body).length === 0) return jsonError('Empty body', 400);
  if (text.length > 280) return jsonError('Text over 280 chars', 400, { length: text.length });

  try {
    const result = await relayTweet({
      text,
      value1,
      value2,
      value3,
      // Arbitrary JSON from the bot → forward verbatim to IFTTT's /json/ endpoint.
      payload: classic ? undefined : body,
    });
    return json(result, result.ok ? 200 : 502);
  } catch (err) {
    logger.error('tweet_relay.route_failed', { err: (err as Error).message });
    return jsonError('Relay failed', 500);
  }
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  const now = Date.now();
  const ledger = await readLedger(now).catch(() => ({ ifttt: [] as number[], xapi: [] as number[] }));
  return json({
    ok: true,
    cap: readCap(),
    iftttConfigured: iftttConfig() !== null,
    xApiConfigured: xCreds() !== null,
    iftttCount24h: ledger.ifttt.length,
    xapiCount24h: ledger.xapi.length,
    iftttPausedUntilMs: (ledger as { iftttPausedUntilMs?: number }).iftttPausedUntilMs ?? null,
    lastError: (ledger as { lastError?: string }).lastError ?? null,
    lastErrorAtMs: (ledger as { lastErrorAtMs?: number }).lastErrorAtMs ?? null,
    now,
  });
}
