/**
 * Tweet relay for the SBS Draft Bot (@sbsdraftbot).
 *
 * The bot fires an IFTTT Maker event ("tweet") whose applet posts to X. IFTTT
 * caps its X service at 100 posts per rolling 24h — shared across every applet
 * on the account — and its webhook STILL answers 200 "Congratulations!" after
 * the cap, so the drop is silent (Richard 2026-08-26: "we already stopped").
 *
 * This relay sits in front of IFTTT:
 *   1. Keeps its own rolling-24h ledger of what it forwarded to IFTTT
 *      (Firestore bot_feed_state/tweet_relay — same collection as the feed's
 *      repeat-🍌 ledger so nothing that iterates `drafts` ever sees it).
 *   2. Under IFTTT_DAILY_CAP (default 90, a little under IFTTT's 100 so a
 *      few manual/other-applet posts don't tip it) → forward to IFTTT.
 *   3. At/over the cap, or if IFTTT returns non-2xx, or while
 *      `iftttPausedUntilMs` is in the future → post straight to the X API
 *      (v2 POST /2/tweets, OAuth 1.0a user context as @sbsdraftbot,
 *      pay-per-use ≈ $0.015/post with no link in the text).
 *
 * If X creds aren't configured yet the X path returns `x_api_not_configured`
 * and the post is dropped (same as today), but the ledger still records the
 * attempt so GET /api/bot/tweet shows how many we're losing.
 */
import { createHmac, randomBytes } from 'crypto';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_IFTTT_DAILY_CAP = 90;
/** Ledger doc — sibling of bot_feed_state/state (the feed's 🍌 ledger). */
export const RELAY_DOC_PATH = ['bot_feed_state', 'tweet_relay'] as const;
const MAX_LEDGER_ENTRIES = 600;

export type RelayRoute = 'ifttt' | 'xapi';

export interface RelayLedger {
  /** ms timestamps of posts forwarded to IFTTT (pruned to the last 24h). */
  ifttt: number[];
  /** ms timestamps of posts sent to the X API (pruned to the last 24h). */
  xapi: number[];
  /** Manual override: skip IFTTT entirely until this ms timestamp. */
  iftttPausedUntilMs?: number;
  lastError?: string;
  lastErrorAtMs?: number;
  updatedAtMs?: number;
}

export interface RelayInput {
  /** Final tweet text (used on the X API path). */
  text: string;
  /**
   * Raw JSON body the bot sent. When present it's forwarded verbatim to
   * IFTTT's `/json/` endpoint so the applet's Filter code sees exactly what
   * it sees today. Otherwise the classic value1/2/3 endpoint is used.
   */
  payload?: Record<string, unknown>;
  value1?: string;
  value2?: string;
  value3?: string;
}

export interface RelayResult {
  ok: boolean;
  route: RelayRoute;
  /** Set when the primary route failed and we fell through to X. */
  fellBack?: boolean;
  iftttCount24h: number;
  xapiCount24h: number;
  error?: string;
  tweetId?: string;
}

/* ───────────────────────── pure helpers (unit-tested) ───────────────────────── */

export function pruneWindow(ts: number[] | undefined, now: number): number[] {
  const cutoff = now - DAY_MS;
  const kept = (Array.isArray(ts) ? ts : []).filter((t) => typeof t === 'number' && t > cutoff && t <= now + 60_000);
  return kept.length > MAX_LEDGER_ENTRIES ? kept.slice(kept.length - MAX_LEDGER_ENTRIES) : kept;
}

export function decideRoute(
  ledger: Pick<RelayLedger, 'ifttt' | 'iftttPausedUntilMs'>,
  now: number,
  cap: number,
  iftttConfigured: boolean,
  xConfigured = true,
): RelayRoute {
  if (!iftttConfigured) return 'xapi';
  // No X creds yet → nothing to fall back to, so keep trying IFTTT (our ledger
  // may be off from IFTTT's real count; a post it swallows is lost either way).
  if (!xConfigured) return 'ifttt';
  if ((ledger.iftttPausedUntilMs ?? 0) > now) return 'xapi';
  return pruneWindow(ledger.ifttt, now).length < cap ? 'ifttt' : 'xapi';
}

export function readCap(): number {
  const raw = Number(process.env.IFTTT_DAILY_CAP);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_IFTTT_DAILY_CAP;
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires (stricter than encodeURIComponent). */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/**
 * OAuth 1.0a HMAC-SHA1 Authorization header. Only oauth_* params are signed
 * (JSON bodies are not part of the signature base string).
 */
export function oauth1Header(
  method: string,
  url: string,
  creds: OAuth1Creds,
  opts: { nonce?: string; timestamp?: number } = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: '1.0',
  };
  const u = new URL(url);
  const params: Array<[string, string]> = Object.entries(oauth).map(([k, v]) => [rfc3986(k), rfc3986(v)]);
  u.searchParams.forEach((v, k) => params.push([rfc3986(k), rfc3986(v)]));
  params.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  const paramString = params.map(([k, v]) => `${k}=${v}`).join('&');
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const base = `${method.toUpperCase()}&${rfc3986(baseUrl)}&${rfc3986(paramString)}`;
  const key = `${rfc3986(creds.consumerSecret)}&${rfc3986(creds.tokenSecret)}`;
  const signature = createHmac('sha1', key).update(base).digest('base64');
  oauth.oauth_signature = signature;
  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${rfc3986(k)}="${rfc3986(oauth[k])}"`)
      .join(', ')
  );
}

/**
 * Build the tweet text from the bot's JSON payload the same way the IFTTT
 * applet's Filter code does (confirmed 2026-08-26):
 *   const payload = JSON.parse(MakerWebhooks.jsonEvent.JsonPayload);
 *   Twitter.postNewTweet.setTweet(payload.content);
 * So `content` is the tweet. The other keys are just tolerant fallbacks.
 */
export function buildTextFromPayload(payload: Record<string, unknown>): string | null {
  for (const k of ['content', 'tweet', 'message', 'status', 'body']) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/* ───────────────────────── config ───────────────────────── */

export function iftttConfig(): { key: string; event: string } | null {
  const key = process.env.IFTTT_WEBHOOK_KEY?.trim();
  if (!key) return null;
  return { key, event: process.env.IFTTT_TWEET_EVENT?.trim() || 'tweet' };
}

export function xCreds(): OAuth1Creds | null {
  const consumerKey = process.env.X_API_KEY?.trim();
  const consumerSecret = process.env.X_API_SECRET?.trim();
  const token = process.env.X_BOT_ACCESS_TOKEN?.trim();
  const tokenSecret = process.env.X_BOT_ACCESS_SECRET?.trim();
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) return null;
  return { consumerKey, consumerSecret, token, tokenSecret };
}

/* ───────────────────────── senders ───────────────────────── */

export async function sendViaIfttt(input: RelayInput): Promise<{ ok: boolean; error?: string }> {
  const cfg = iftttConfig();
  if (!cfg) return { ok: false, error: 'ifttt_not_configured' };
  const ev = encodeURIComponent(cfg.event);
  const key = encodeURIComponent(cfg.key);
  const useJson = !!input.payload;
  const url = useJson
    ? `https://maker.ifttt.com/trigger/${ev}/json/with/key/${key}`
    : `https://maker.ifttt.com/trigger/${ev}/with/key/${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        useJson
          ? input.payload
          : { value1: input.value1 ?? input.text, value2: input.value2 ?? '', value3: input.value3 ?? '' },
      ),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, error: `ifttt_http_${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `ifttt_fetch_failed: ${(err as Error).message}` };
  }
}

export async function sendViaXApi(text: string): Promise<{ ok: boolean; error?: string; tweetId?: string }> {
  const creds = xCreds();
  if (!creds) return { ok: false, error: 'x_api_not_configured' };
  const url = 'https://api.x.com/2/tweets';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: oauth1Header('POST', url, creds),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text }),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      detail?: string;
      title?: string;
      errors?: Array<{ message?: string }>;
    };
    if (res.ok && body?.data?.id) return { ok: true, tweetId: body.data.id };
    const detail = body?.detail || body?.title || body?.errors?.[0]?.message || '';
    // X rejects a byte-identical recent post with 403 "duplicate content" —
    // the feed's repeat-🍌 ledger is supposed to prevent that; surface it, don't retry.
    return { ok: false, error: `x_http_${res.status}${detail ? `: ${detail}` : ''}`.slice(0, 300) };
  } catch (err) {
    return { ok: false, error: `x_fetch_failed: ${(err as Error).message}` };
  }
}

/* ───────────────────────── ledger + orchestration ───────────────────────── */

function relayRef() {
  const [col, doc] = RELAY_DOC_PATH;
  return getAdminFirestore().collection(col).doc(doc);
}

export async function readLedger(now = Date.now()): Promise<RelayLedger> {
  if (!isFirestoreConfigured()) return { ifttt: [], xapi: [] };
  const snap = await relayRef().get();
  const raw = (snap.exists ? snap.data() : {}) as Partial<RelayLedger>;
  return {
    ...raw,
    ifttt: pruneWindow(raw.ifttt, now),
    xapi: pruneWindow(raw.xapi, now),
  };
}

/**
 * Atomically pick a route and reserve the slot in the ledger, so two
 * concurrent posts can't both squeeze in under the cap.
 */
async function reserveRoute(now: number, cap: number): Promise<{ route: RelayRoute; ledger: RelayLedger }> {
  const iftttOk = iftttConfig() !== null;
  if (!isFirestoreConfigured()) {
    // No ledger available — be conservative and use X if it's configured, else IFTTT.
    const route: RelayRoute = xCreds() && !iftttOk ? 'xapi' : 'ifttt';
    return { route, ledger: { ifttt: [], xapi: [] } };
  }
  const db = getAdminFirestore();
  return db.runTransaction(async (tx) => {
    const ref = relayRef();
    const snap = await tx.get(ref);
    const raw = (snap.exists ? snap.data() : {}) as Partial<RelayLedger>;
    const ledger: RelayLedger = {
      ...raw,
      ifttt: pruneWindow(raw.ifttt, now),
      xapi: pruneWindow(raw.xapi, now),
    };
    const route = decideRoute(ledger, now, cap, iftttOk, xCreds() !== null);
    ledger[route] = [...ledger[route], now];
    ledger.updatedAtMs = now;
    tx.set(ref, ledger, { merge: true });
    return { route, ledger };
  });
}

async function recordFallback(now: number, error: string): Promise<void> {
  if (!isFirestoreConfigured()) return;
  const db = getAdminFirestore();
  await db
    .runTransaction(async (tx) => {
      const ref = relayRef();
      const snap = await tx.get(ref);
      const raw = (snap.exists ? snap.data() : {}) as Partial<RelayLedger>;
      // Move the reserved IFTTT slot over to xapi — IFTTT didn't take it.
      const ifttt = pruneWindow(raw.ifttt, now);
      const idx = ifttt.lastIndexOf(now);
      if (idx >= 0) ifttt.splice(idx, 1);
      tx.set(
        ref,
        { ifttt, xapi: [...pruneWindow(raw.xapi, now), now], lastError: error, lastErrorAtMs: now, updatedAtMs: now },
        { merge: true },
      );
    })
    .catch((err) => logger.warn('tweet_relay.record_fallback_failed', { err: (err as Error).message }));
}

async function recordError(now: number, error: string): Promise<void> {
  if (!isFirestoreConfigured()) return;
  await relayRef()
    .set({ lastError: error, lastErrorAtMs: now, updatedAtMs: now }, { merge: true })
    .catch((err) => logger.warn('tweet_relay.record_error_failed', { err: (err as Error).message }));
}

export async function relayTweet(input: RelayInput, now = Date.now()): Promise<RelayResult> {
  const cap = readCap();
  const { route, ledger } = await reserveRoute(now, cap);
  const counts = { iftttCount24h: ledger.ifttt.length, xapiCount24h: ledger.xapi.length };

  if (route === 'ifttt') {
    const r = await sendViaIfttt(input);
    if (r.ok) {
      logger.info('tweet_relay.sent', { route, ...counts });
      return { ok: true, route, ...counts };
    }
    // IFTTT refused (rare — it usually swallows silently). Fall through to X.
    logger.warn('tweet_relay.ifttt_failed_falling_back', { error: r.error });
    await recordFallback(now, r.error ?? 'ifttt_failed');
    const x = input.text ? await sendViaXApi(input.text) : { ok: false as const, error: 'x_no_text' };
    const fallbackCounts = { iftttCount24h: Math.max(0, counts.iftttCount24h - 1), xapiCount24h: counts.xapiCount24h + 1 };
    if (!x.ok) {
      logger.error('tweet_relay.dropped', { route: 'xapi', fellBack: true, error: x.error, ...fallbackCounts });
      await recordError(now, x.error ?? 'x_failed');
      return { ok: false, route: 'xapi', fellBack: true, error: x.error, ...fallbackCounts };
    }
    logger.info('tweet_relay.sent', { route: 'xapi', fellBack: true, tweetId: x.tweetId, ...fallbackCounts });
    return { ok: true, route: 'xapi', fellBack: true, tweetId: x.tweetId, ...fallbackCounts };
  }

  if (!input.text) {
    logger.error('tweet_relay.dropped', { route, error: 'x_no_text', ...counts });
    await recordError(now, 'x_no_text');
    return { ok: false, route, error: 'x_no_text', ...counts };
  }
  const x = await sendViaXApi(input.text);
  if (!x.ok) {
    logger.error('tweet_relay.dropped', { route, error: x.error, ...counts });
    await recordError(now, x.error ?? 'x_failed');
    return { ok: false, route, error: x.error, ...counts };
  }
  logger.info('tweet_relay.sent', { route, tweetId: x.tweetId, ...counts });
  return { ok: true, route, tweetId: x.tweetId, ...counts };
}
