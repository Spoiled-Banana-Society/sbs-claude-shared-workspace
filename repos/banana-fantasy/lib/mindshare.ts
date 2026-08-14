/**
 * Banana X Mindshare — weekly X-attention leaderboard.
 *
 * A live board tracking who owns SBS attention on X. Cron pulls @SBSFantasy
 * mentions from twitterapi.io every 5 min, scores them (engagement-weighted,
 * originals > replies, per-day diminishing returns, junk = 0), and writes
 * per-handle tiles for the current week. Weeks run Thursday 9pm ET → Thursday
 * 9pm ET; at rollover the top 25 are snapshotted onto the week doc and the
 * board resets to zero (Richard 8/13: rewards night + instant reset, no lock
 * day). Payouts are MANUAL-REVIEW for the first weeks — nothing here credits
 * prizes automatically.
 *
 * Decisions (do not quietly reverse):
 * - 2026-08-13 Richard: everyone starts at 0; rank-based fixed prize count,
 *   NEVER pay-per-post (the model X banned Kaito for).
 * - Scoring counts ALL interaction (posts, quotes, retweets, replies), not
 *   just original posts.
 * - Junk filter doubles as eligibility: author accounts younger than 90 days
 *   or with <25 followers score zero.
 * - Referral-conversion bonus (link → signup → funded draft) is applied at
 *   the weekly manual review for now, not by this cron. refBonus field exists
 *   on tiles so review can set it.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const WEEKS_COLLECTION = 'mindshare_weeks';
export const STATE_DOC = 'mindshare_state/live';

const API_BASE = 'https://api.twitterapi.io';
const SEARCH_QUERY = '@SBSFantasy -from:SBSFantasy';

/** House accounts never compete on the board (Richard 8/13: "take away
 *  boris vagner and rich vagner lmao"). Lowercased handles. */
export const EXCLUDED_HANDLES = new Set(['sbsfantasy', 'richvagner', 'borisvagner']);
const MAX_SEARCH_PAGES = 3;
const REFRESH_BATCH = 60; // recent tweets whose metrics we re-pull per scan
const MS_DAY = 86_400_000;

// Scoring weights — tune on real data during the week-1/2 soft launch.
const W = {
  baseOriginal: 10,
  baseReply: 4,
  baseRetweet: 2, // bare RT of an SBS post: flat credit, engagement stays with the original
  retweet: 6,
  quote: 8,
  reply: 4,
  like: 2,
  viewsPer1k: 0.5,
  viewsCap: 50_000,
  replyMult: 0.45,
  dayDecay: 0.5, // nth-best tweet of an ET day is worth 1/(1 + 0.5*(n-1))
  minFollowers: 25,
  minAccountAgeDays: 90,
};

// ── ET week math ────────────────────────────────────────────────────────────
const ET = 'America/New_York';
const PAY_HOUR_ET = 21; // Thursday 9pm ET

function etParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    y: Number(get('year')), m: Number(get('month')), d: Number(get('day')),
    hh: Number(get('hour')) % 24, mm: Number(get('minute')), weekday: get('weekday'),
  };
}

/** UTC instant of an ET wall-clock time (two-pass offset correction, DST-safe). */
function etWallToUtc(y: number, m: number, d: number, hh: number): Date {
  let utc = Date.UTC(y, m - 1, d, hh + 4); // EDT guess
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(utc));
    const got = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const want = Date.UTC(y, m - 1, d, hh, 0);
    utc += want - got;
  }
  return new Date(utc);
}

/** Next Thursday 9pm ET strictly after `after`. */
export function nextPayInstant(after: Date): { endsAt: Date; weekId: string } {
  for (let i = 0; i < 9; i++) {
    const probe = new Date(after.getTime() + i * MS_DAY);
    const p = etParts(probe);
    if (p.weekday !== 'Thu') continue;
    const candidate = etWallToUtc(p.y, p.m, p.d, PAY_HOUR_ET);
    if (candidate.getTime() > after.getTime()) {
      const id = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
      return { endsAt: candidate, weekId: id };
    }
  }
  throw new Error('nextPayInstant: no Thursday found in 9 days (impossible)');
}

function etDayKey(ms: number): string {
  const p = etParts(new Date(ms));
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

// ── state ───────────────────────────────────────────────────────────────────
export interface MindshareState {
  weekId: string;
  startsAtMs: number;
  endsAtMs: number;
  lastScanMs?: number;
  newestTweetId?: string;
}

export async function getOrInitState(): Promise<MindshareState> {
  const db = getAdminFirestore();
  const ref = db.doc(STATE_DOC);
  const snap = await ref.get();
  if (snap.exists) return snap.data() as MindshareState;
  // Bootstrap: first week must be a real week, not a few hours — anchor to the
  // next Thursday 9pm ET that is at least 24h out (launch-day-is-Thursday case).
  const now = Date.now();
  const { endsAt, weekId } = nextPayInstant(new Date(now + MS_DAY));
  const state: MindshareState = { weekId, startsAtMs: now, endsAtMs: endsAt.getTime() };
  await ref.set(state);
  await db.collection(WEEKS_COLLECTION).doc(weekId).set(
    { status: 'live', startsAtMs: state.startsAtMs, endsAtMs: state.endsAtMs, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return state;
}

// ── twitterapi.io ───────────────────────────────────────────────────────────
interface RawTweet {
  id: string;
  text: string;
  createdAtMs: number;
  isReply: boolean;
  isRetweet: boolean;
  retweets: number; quotes: number; replies: number; likes: number; views: number;
  authorHandle: string;
  authorFollowers: number;
  authorCreatedAtMs: number;
}

function apiKey(): string {
  return (process.env.TWITTERAPI_IO_KEY ?? '').trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTweet(t: any): RawTweet | null {
  const id = String(t?.id ?? '');
  const handle = String(t?.author?.userName ?? '').trim();
  if (!id || !handle) return null;
  const createdAtMs = Date.parse(String(t?.createdAt ?? '')) || 0;
  const authorCreatedAtMs = Date.parse(String(t?.author?.createdAt ?? '')) || 0;
  return {
    id,
    text: String(t?.text ?? '').slice(0, 500),
    createdAtMs,
    isReply: Boolean(t?.isReply) || Boolean(t?.inReplyToId),
    isRetweet: Boolean(t?.retweeted_tweet),
    retweets: Number(t?.retweetCount) || 0,
    quotes: Number(t?.quoteCount) || 0,
    replies: Number(t?.replyCount) || 0,
    likes: Number(t?.likeCount) || 0,
    views: Number(t?.viewCount) || 0,
    authorHandle: handle,
    authorFollowers: Number(t?.author?.followers) || 0,
    authorCreatedAtMs,
  };
}

async function apiGet(path: string): Promise<Record<string, unknown>> {
  // ⚠️ cache:'no-store' is LOAD-BEARING — Next's route-handler fetch cache
  // would otherwise freeze these reads at deploy-day results forever.
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-api-key': apiKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`twitterapi ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Pull new mentions since the last scan (bounded pages, newest-first pagination). */
async function fetchNewMentions(sinceMs: number): Promise<RawTweet[]> {
  const out: RawTweet[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const qs = new URLSearchParams({ query: SEARCH_QUERY, queryType: 'Latest' });
    if (cursor) qs.set('cursor', cursor);
    const data = await apiGet(`/twitter/tweet/advanced_search?${qs.toString()}`);
    const tweets = (Array.isArray(data.tweets) ? data.tweets : [])
      .map(parseTweet)
      .filter((t): t is RawTweet => t !== null);
    let sawOld = false;
    for (const t of tweets) {
      if (t.createdAtMs > 0 && t.createdAtMs < sinceMs) { sawOld = true; continue; }
      out.push(t);
    }
    if (sawOld || !data.has_next_page || !data.next_cursor) break;
    cursor = String(data.next_cursor);
  }
  return out;
}

/** Refresh engagement metrics for recent stored tweets (engagement keeps growing). */
async function refreshRecentMetrics(weekId: string, nowMs: number): Promise<number> {
  const db = getAdminFirestore();
  const cutoff = nowMs - 2 * MS_DAY;
  const snap = await db.collection(WEEKS_COLLECTION).doc(weekId).collection('tweets')
    .where('createdAtMs', '>=', cutoff).limit(REFRESH_BATCH).get();
  if (snap.empty) return 0;
  const ids = snap.docs.map((d) => d.id);
  const data = await apiGet(`/twitter/tweets?tweet_ids=${ids.join(',')}`);
  const fresh = (Array.isArray(data.tweets) ? data.tweets : [])
    .map(parseTweet)
    .filter((t): t is RawTweet => t !== null);
  const batch = db.batch();
  for (const t of fresh) {
    batch.set(
      db.collection(WEEKS_COLLECTION).doc(weekId).collection('tweets').doc(t.id),
      { retweets: t.retweets, quotes: t.quotes, replies: t.replies, likes: t.likes, views: t.views },
      { merge: true },
    );
  }
  await batch.commit();
  return fresh.length;
}

// ── scoring ─────────────────────────────────────────────────────────────────
function tweetPoints(t: RawTweet, nowMs: number): number {
  if (t.authorFollowers < W.minFollowers) return 0;
  if (t.authorCreatedAtMs > 0 && nowMs - t.authorCreatedAtMs < W.minAccountAgeDays * MS_DAY) return 0;
  if (t.isRetweet) return W.baseRetweet;
  const base = t.isReply ? W.baseReply : W.baseOriginal;
  const engagement =
    t.retweets * W.retweet + t.quotes * W.quote + t.replies * W.reply +
    t.likes * W.like + (Math.min(t.views, W.viewsCap) / 1000) * W.viewsPer1k;
  return (base + engagement) * (t.isReply ? W.replyMult : 1);
}

/** Recompute every tile for the week from its stored tweets (idempotent). */
async function rescoreWeek(weekId: string, nowMs: number): Promise<{ tiles: number; tweets: number }> {
  const db = getAdminFirestore();
  const snap = await db.collection(WEEKS_COLLECTION).doc(weekId).collection('tweets').get();
  const byAuthor = new Map<string, { handle: string; perDay: Map<string, number[]>; tweets: number }>();
  for (const doc of snap.docs) {
    const t = doc.data() as RawTweet;
    const key = t.authorHandle.toLowerCase();
    if (EXCLUDED_HANDLES.has(key)) continue;
    const pts = tweetPoints(t, nowMs);
    let a = byAuthor.get(key);
    if (!a) { a = { handle: t.authorHandle, perDay: new Map(), tweets: 0 }; byAuthor.set(key, a); }
    a.tweets += 1;
    const day = etDayKey(t.createdAtMs || nowMs);
    const arr = a.perDay.get(day) ?? [];
    arr.push(pts);
    a.perDay.set(day, arr);
  }
  const batch = db.batch();
  let written = 0;
  for (const [key, a] of byAuthor) {
    let attention = 0;
    for (const arr of a.perDay.values()) {
      arr.sort((x, y) => y - x);
      arr.forEach((pts, i) => { attention += pts / (1 + W.dayDecay * i); });
    }
    const ref = db.collection(WEEKS_COLLECTION).doc(weekId).collection('tiles').doc(key);
    batch.set(ref, {
      handle: a.handle,
      attention: Math.round(attention),
      tweets: a.tweets,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    written += 1;
    if (written % 400 === 0) { await batch.commit(); }
  }
  await batch.commit();
  return { tiles: byAuthor.size, tweets: snap.size };
}

// ── rollover ────────────────────────────────────────────────────────────────
async function rolloverIfDue(state: MindshareState, nowMs: number): Promise<MindshareState> {
  if (nowMs < state.endsAtMs) return state;
  const db = getAdminFirestore();
  const tilesSnap = await db.collection(WEEKS_COLLECTION).doc(state.weekId).collection('tiles').get();
  const ranked = tilesSnap.docs
    .map((d) => {
      const t = d.data();
      return { handle: String(t.handle ?? d.id), score: (Number(t.attention) || 0) + (Number(t.refBonus) || 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((t, i) => ({ rank: i + 1, ...t }));
  await db.collection(WEEKS_COLLECTION).doc(state.weekId).set({
    status: 'final',
    finalizedAt: FieldValue.serverTimestamp(),
    final: ranked, // ⚠️ payout is MANUAL from this snapshot for the soft-launch weeks — nothing auto-credits.
  }, { merge: true });
  const { endsAt, weekId } = nextPayInstant(new Date(state.endsAtMs + 60_000));
  const next: MindshareState = {
    weekId,
    startsAtMs: state.endsAtMs,
    endsAtMs: endsAt.getTime(),
    lastScanMs: nowMs,
  };
  await db.doc(STATE_DOC).set(next);
  await db.collection(WEEKS_COLLECTION).doc(weekId).set(
    { status: 'live', startsAtMs: next.startsAtMs, endsAtMs: next.endsAtMs, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return next;
}

// ── one-time Privy → v2_twitter_links backfill ──────────────────────────────
// Users who connected X on-site via Privy but never hit the verify-twitter
// route have NO site-side link row (Silkyjohnson case, Richard 8/13: nobody
// should ever have to reconnect). Runs ONCE inside the cron, where
// PRIVY_APP_SECRET exists; marker-guarded, existing rows never touched.
async function backfillPrivyLinksOnce(): Promise<Record<string, unknown> | null> {
  const db = getAdminFirestore();
  const marker = db.doc('mindshare_state/privy-link-backfill');
  if ((await marker.get()).exists) return null;
  const appId = (process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '').trim();
  const secret = (process.env.PRIVY_APP_SECRET ?? '').trim();
  if (!appId || !secret) return { backfill: 'skipped: privy creds missing' };

  const [usersSnap, linksSnap] = await Promise.all([
    db.collection('v2_users').select().get(),
    db.collection('v2_twitter_links').select().get(),
  ]);
  const siteWallets = new Set(usersSnap.docs.map((d) => d.id.toLowerCase()));
  const existing = new Set(linksSnap.docs.map((d) => d.id));

  const auth = 'Basic ' + Buffer.from(`${appId}:${secret}`).toString('base64');
  let cursor: string | null = null;
  let scanned = 0; let created = 0;
  for (let page = 0; page < 60; page++) {
    const url = new URL('https://auth.privy.io/api/v1/users');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: auth, 'privy-app-id': appId }, cache: 'no-store' });
    if (!res.ok) return { backfill: `privy ${res.status}` };
    const data = (await res.json()) as { data?: Array<Record<string, unknown>>; next_cursor?: string };
    for (const u of data.data ?? []) {
      scanned++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = (u.linked_accounts ?? []) as any[];
      const tw = accounts.find((a) => a?.type === 'twitter_oauth' && a?.subject && a?.username);
      if (!tw || existing.has(String(tw.subject))) continue;
      const wallet = accounts
        .filter((a) => a?.type === 'wallet' && typeof a?.address === 'string')
        .map((a) => String(a.address).toLowerCase())
        .find((w) => siteWallets.has(w));
      if (!wallet) continue;
      try {
        await db.collection('v2_twitter_links').doc(String(tw.subject)).create({
          twitterId: String(tw.subject),
          twitterHandle: String(tw.username),
          walletAddress: wallet,
          privyUserId: String(u.id ?? ''),
          backfilledAt: new Date().toISOString(),
          backfillSource: 'privy-backfill-2026-08-13',
        });
        created++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) { if (e?.code !== 6) throw e; }
    }
    cursor = data.next_cursor ?? null;
    if (!cursor) break;
  }
  await marker.set({ ranAt: FieldValue.serverTimestamp(), scanned, created });
  return { backfillScanned: scanned, backfillCreated: created };
}

// ── the scan entrypoint (called by the cron) ────────────────────────────────
export async function runMindshareScan(): Promise<Record<string, unknown>> {
  const nowMs = Date.now();
  let state = await getOrInitState();
  state = await rolloverIfDue(state, nowMs);

  let backfill: Record<string, unknown> | null = null;
  try { backfill = await backfillPrivyLinksOnce(); } catch (e) {
    backfill = { backfill: `error: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}` };
  }

  if (!apiKey()) {
    return { ok: false, reason: 'TWITTERAPI_IO_KEY missing', weekId: state.weekId };
  }

  let pulled = 0; let refreshed = 0; let apiError: string | null = null;
  try {
    const sinceMs = Math.max(state.startsAtMs, (state.lastScanMs ?? 0) - 15 * 60_000);
    const fresh = await fetchNewMentions(sinceMs);
    const db = getAdminFirestore();
    const batch = db.batch();
    for (const t of fresh) {
      if (t.createdAtMs < state.startsAtMs) continue; // only this week's noise
      batch.set(db.collection(WEEKS_COLLECTION).doc(state.weekId).collection('tweets').doc(t.id), t, { merge: true });
      pulled += 1;
    }
    await batch.commit();
    refreshed = await refreshRecentMetrics(state.weekId, nowMs);
  } catch (e) {
    // 402 = credits drained — score from what we have, surface in heartbeat.
    apiError = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
  }

  const scored = await rescoreWeek(state.weekId, nowMs);
  await getAdminFirestore().doc(STATE_DOC).set({ lastScanMs: nowMs }, { merge: true });
  return { ok: !apiError, weekId: state.weekId, pulled, refreshed, ...scored, ...(backfill ?? {}), ...(apiError ? { apiError } : {}) };
}
