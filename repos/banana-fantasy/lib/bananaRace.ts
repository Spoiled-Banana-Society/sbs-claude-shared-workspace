/**
 * BANANA RACE — kickoff-week buy-to-earn leaderboard (Richard 2026-09-04).
 *
 * The problem it solves: a dozen JackHOF / Jackpot / HOF special leagues are
 * sitting part-full the week of kickoff. The race turns every paid draft into
 * a point, freezes the board Tuesday 5 PM PT, guarantees the top N a JackHOF
 * seat, and hands EVERY remaining open special seat out in a points-weighted
 * draw so all of those leagues draft Tuesday 6 PM PT (fast clock), the night
 * before Wednesday kickoff.
 *
 * Rules (all Richard's, 9/4):
 *   • 1 paid draft = 1 point. Bundles count per draft. Banana Zone free passes
 *     from a B1G1 / B2G1 are grants, not purchases — only the paid half counts,
 *     which the `pass_purchased` activity event already encodes. Free drafts,
 *     wheel wins, promo code drafts and marketplace buys are 0.
 *   • Window: Saturday Sep 5 12:00 AM PT → Tuesday Sep 8 5:00 PM PT. Retroactive
 *     to the window start no matter when the post goes out.
 *   • Top N (10) on points lock a JackHOF seat. Ties break by who REACHED that
 *     total first (earlier last-counted purchase wins).
 *   • The draw: every point is one ticket. Runs at the freeze. Every open
 *     JackHOF / Jackpot / HOF seat is filled, JackHOF first. One seat per person
 *     per league; a person can win seats in several leagues. Top N are also in
 *     the draw. No cap — Richard: "there will def be enough people".
 *   • Same-tier leagues merge first (smaller into bigger, never if they share a
 *     person). A top-N winner already seated in every JackHOF league opens a
 *     brand new JackHOF league, and the draw fills its other 9 seats too.
 *   • Linked wallets (lib/linkedWallets.ts) are one person. House bots never
 *     buy, so they never score; they are excluded from the tally anyway.
 *   • Board shows points and tickets only — no percent odds (Richard turned
 *     those down on the Drop page).
 *
 * ⚠️ SHIPS DARK. Nothing here renders, bells or seats until
 * system_config/bananaRace.enabled === true (or env BANANA_RACE=1). Flip with
 * scripts/_banana-race-toggle.mjs. /preview/banana-race renders every visual
 * with mock data regardless of the switch.
 *
 * Tuesday runbook (scripts/, dry-run by default):
 *   5:00 PM PT  _banana-race-freeze.mjs --commit   snapshot board → banana_race/final,
 *               plan merges + draw, reserve the target rounds, winner bells
 *   6:00 PM PT  _banana-race-seat.mjs --commit     execute the plan through
 *               POST /api/race/seat: merges, DraftType→fast, seat winners
 *               (last seat of each league goes in LAST so all drafts start together)
 */

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import {
  RACE_CONFIG_DOC,
  RACE_COLLECTION,
  RACE_FINAL_DOC,
  RACE_DEFAULT_START_ISO,
  RACE_DEFAULT_END_ISO,
  RACE_DEFAULT_DRAFT_ISO,
  RACE_DEFAULT_TOP_N,
  TIER_ORDER,
  type BananaRaceConfig,
  type RaceRow,
  type RaceTally,
  type SeatSummary,
  type OpenLeague,
  type BoardRow,
  type RaceResults,
  type RaceBoard,
} from '@/lib/bananaRaceShared';

// Re-export the client-safe half so existing `@/lib/bananaRace` importers
// (server routes, type-only component imports) keep resolving unchanged.
// The pure types/constants/mock live in bananaRaceShared.ts so a `'use client'`
// page can import `mockRaceBoard` without pulling firebaseAdmin into the bundle.
export * from '@/lib/bananaRaceShared';

const CONFIG_TTL_MS = 60_000;
let cfgCache: { at: number; cfg: BananaRaceConfig } | null = null;

/** Env override for emergencies: BANANA_RACE=1 forces ON, =0 forces OFF. */
function envOverride(): boolean | null {
  const v = process.env.BANANA_RACE;
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

export async function readBananaRaceConfig(opts: { fresh?: boolean } = {}): Promise<BananaRaceConfig> {
  const now = Date.now();
  if (!opts.fresh && cfgCache && now - cfgCache.at < CONFIG_TTL_MS) return cfgCache.cfg;
  const cfg: BananaRaceConfig = {
    enabled: false,
    startAtIso: RACE_DEFAULT_START_ISO,
    endAtIso: RACE_DEFAULT_END_ISO,
    draftAtIso: RACE_DEFAULT_DRAFT_ISO,
    topN: RACE_DEFAULT_TOP_N,
    frozen: false,
    launchAtIso: null,
  };
  if (isFirestoreConfigured()) {
    try {
      const snap = await getAdminFirestore().collection(RACE_CONFIG_DOC.col).doc(RACE_CONFIG_DOC.doc).get();
      const d = (snap.exists ? snap.data() : null) as Partial<BananaRaceConfig> | null;
      if (d) {
        if (typeof d.enabled === 'boolean') cfg.enabled = d.enabled;
        if (isIso(d.startAtIso)) cfg.startAtIso = d.startAtIso;
        if (isIso(d.endAtIso)) cfg.endAtIso = d.endAtIso;
        if (isIso(d.draftAtIso)) cfg.draftAtIso = d.draftAtIso;
        if (typeof d.topN === 'number' && d.topN > 0) cfg.topN = Math.floor(d.topN);
        if (typeof d.frozen === 'boolean') cfg.frozen = d.frozen;
        if (isIso(d.launchAtIso)) cfg.launchAtIso = d.launchAtIso;
      }
    } catch (e) {
      logger.warn('banana_race.config_read_failed', { err: (e as Error).message });
    }
  }
  const env = envOverride();
  if (env !== null) cfg.enabled = env;
  cfgCache = { at: now, cfg };
  return cfg;
}

// ── Tally ───────────────────────────────────────────────────────────────────

function shortWallet(w: string): string {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

/**
 * Points = quantity of `pass_purchased` activity events (card + USDC paid
 * mints) inside [start, end), by person. Bots excluded, linked wallets merged.
 * Names: the event's denormalized username, else v2_users, else short wallet.
 *
 * Single-field range on createdAtIso (auto-indexed); the type filter runs in
 * memory — a few thousand docs over the window, cheap with `select()`.
 */
export async function tallyBananaRace(cfg: Pick<BananaRaceConfig, 'startAtIso' | 'endAtIso'>): Promise<RaceTally> {
  const db = getAdminFirestore();
  const [eventsSnap, botsSnap] = await Promise.all([
    db.collection('v2_activity_events')
      .where('createdAtIso', '>=', cfg.startAtIso)
      .where('createdAtIso', '<', cfg.endAtIso)
      .select('type', 'userId', 'quantity', 'createdAtIso', 'username')
      .get(),
    db.collection('botWallets').select().get(),
  ]);
  const bots = new Set(botsSnap.docs.map((d) => d.id.toLowerCase()));
  const { getLinkedWallets } = await import('@/lib/linkedWallets');

  type Acc = { wallets: Set<string>; points: number; reachedAtIso: string; names: Map<string, string> };
  const byKey = new Map<string, Acc>();
  const keyOf = new Map<string, string>();
  const canonical = async (wallet: string): Promise<string> => {
    const cached = keyOf.get(wallet);
    if (cached) return cached;
    const group = [wallet, ...(await getLinkedWallets(wallet))].sort();
    const key = group[0];
    for (const w of group) keyOf.set(w, key);
    return key;
  };

  const events = eventsSnap.docs
    .map((d) => d.data() as { type?: string; userId?: string; quantity?: number; createdAtIso?: string; username?: string | null })
    .filter((e) => e.type === 'pass_purchased' && typeof e.userId === 'string' && (Number(e.quantity) || 0) > 0)
    .sort((a, b) => String(a.createdAtIso).localeCompare(String(b.createdAtIso)));

  for (const e of events) {
    const w = String(e.userId).toLowerCase();
    if (bots.has(w)) continue;
    const key = await canonical(w);
    let acc = byKey.get(key);
    if (!acc) { acc = { wallets: new Set(), points: 0, reachedAtIso: '', names: new Map() }; byKey.set(key, acc); }
    acc.wallets.add(w);
    acc.points += Math.floor(Number(e.quantity));
    acc.reachedAtIso = String(e.createdAtIso ?? acc.reachedAtIso);
    if (e.username && !e.username.startsWith('User-')) acc.names.set(w, e.username);
  }

  // Fill missing names from v2_users (username / displayName — NOT userName/name).
  const missing = [...byKey.values()].filter((a) => a.names.size === 0).flatMap((a) => [...a.wallets]);
  if (missing.length) {
    const refs = missing.map((w) => db.collection('v2_users').doc(w));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      const d = s.data() ?? {};
      const name = [d.username, d.displayName].find((v) => typeof v === 'string' && v && !String(v).startsWith('User-'));
      if (name) byKey.get(keyOf.get(s.id) ?? s.id)?.names.set(s.id, String(name));
    }
  }

  const rows: RaceRow[] = [...byKey.entries()].map(([key, a]) => ({
    key,
    wallets: [...a.wallets].sort(),
    name: a.names.get(key) ?? [...a.names.values()][0] ?? shortWallet(key),
    points: a.points,
    reachedAtIso: a.reachedAtIso,
  }));
  rows.sort((x, y) => y.points - x.points || x.reachedAtIso.localeCompare(y.reachedAtIso) || x.key.localeCompare(y.key));

  return {
    rows,
    totals: { players: rows.length, points: rows.reduce((s, r) => s + r.points, 0) },
    computedAtIso: new Date().toISOString(),
  };
}

// ── Open seats ──────────────────────────────────────────────────────────────

/** Every special round still filling, with its open seat count. */
export async function readOpenSeats(): Promise<SeatSummary> {
  const { getQueueStatus } = await import('@/lib/db');
  const queues = await getQueueStatus();
  const leagues: OpenLeague[] = [];
  for (const tier of TIER_ORDER) {
    for (const r of queues[tier]?.rounds ?? []) {
      if (r.status !== 'filling') continue;
      const members = (r.members ?? []).map((m) => String(m.wallet).toLowerCase());
      const open = Math.max(0, 10 - members.length);
      if (open === 0) continue;
      leagues.push({ tier, roundId: r.roundId, draftId: r.draftId ?? null, source: r.source ?? 'wheel', members, open });
    }
  }
  const byTier = { jackhof: { open: 0, leagues: 0 }, jackpot: { open: 0, leagues: 0 }, hof: { open: 0, leagues: 0 } };
  for (const l of leagues) { byTier[l.tier].open += l.open; byTier[l.tier].leagues += 1; }
  return { byTier, total: leagues.reduce((s, l) => s + l.open, 0), leagues };
}

// ── Board (what the page renders) ───────────────────────────────────────────

const BOARD_TTL_MS = 45_000;
const BOARD_LIMIT = 100;
let boardCache: { at: number; tally: RaceTally; seats: SeatSummary; results: RaceResults | null } | null = null;

/**
 * The live board. Tally + seats cached 45s per instance so the page's 60s
 * poll never fans out into Firestore reads per viewer. Once frozen, the tally
 * and results come from banana_race/final (written by the freeze script) so
 * what people see after 5 PM is exactly what was drawn.
 */
export async function buildRaceBoard(viewerWallet: string | null, opts: { fresh?: boolean } = {}): Promise<RaceBoard> {
  const cfg = await readBananaRaceConfig(opts);
  const nowIso = new Date().toISOString();
  const base = {
    enabled: cfg.enabled, startAtIso: cfg.startAtIso, endAtIso: cfg.endAtIso, draftAtIso: cfg.draftAtIso,
    topN: cfg.topN, frozen: cfg.frozen, nowIso,
  };
  if (!cfg.enabled) {
    return { ...base, seats: { byTier: { jackhof: { open: 0, leagues: 0 }, jackpot: { open: 0, leagues: 0 }, hof: { open: 0, leagues: 0 } }, total: 0 }, board: [], you: null, totals: { players: 0, points: 0 }, results: null };
  }

  const now = Date.now();
  if (opts.fresh || !boardCache || now - boardCache.at > BOARD_TTL_MS) {
    let tally: RaceTally | null = null;
    let results: RaceResults | null = null;
    if (cfg.frozen) {
      const snap = await getAdminFirestore().collection(RACE_COLLECTION).doc(RACE_FINAL_DOC).get();
      const d = snap.data() as { tally?: RaceTally; results?: RaceResults } | undefined;
      if (d?.tally) tally = d.tally;
      if (d?.results) results = d.results;
    }
    if (!tally) tally = await tallyBananaRace(cfg);
    const seats = await readOpenSeats();
    boardCache = { at: now, tally, seats, results };
  }
  const { tally, seats, results } = boardCache;

  const viewer = viewerWallet ? viewerWallet.toLowerCase() : null;
  const youIdx = viewer ? tally.rows.findIndex((r) => r.wallets.includes(viewer)) : -1;
  const board: BoardRow[] = tally.rows.slice(0, BOARD_LIMIT).map((r, i) => ({
    rank: i + 1, name: r.name, points: r.points, you: i === youIdx, locked: i < cfg.topN,
  }));
  const cutoff = tally.rows[cfg.topN - 1]?.points ?? 0;
  const you = youIdx >= 0
    ? { rank: youIdx + 1, points: tally.rows[youIdx].points, toCutoff: youIdx < cfg.topN ? 0 : Math.max(1, cutoff + 1 - tally.rows[youIdx].points), inTopN: youIdx < cfg.topN }
    : null;

  return {
    ...base,
    seats: { byTier: seats.byTier, total: seats.total },
    board,
    you,
    totals: tally.totals,
    results,
  };
}
