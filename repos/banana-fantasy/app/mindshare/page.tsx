'use client';

/**
 * Banana X Mindshare — the live attention board (/mindshare).
 *
 * Live treemap of who owns SBS attention on X this week + top-25 leaderboard
 * + pinned YOU row + Thursday-9pm-ET rewards countdown + the prize ladder
 * front and center (Richard 8/13: prizes are the focus, not buried).
 *
 * Decisions (do not quietly reverse — Richard 8/13):
 * - Everyone starts at 0. At all-zeros the board still MOVES: real linked
 *   handles render as equal tiles that gently reshuffle, so launch-day
 *   visitors see how the board behaves before scores exist.
 * - Week = Thursday 9pm ET → Thursday 9pm ET. Rewards night + instant reset,
 *   no lock day. Top 25 all win (ladder below), rank-based fixed prizes,
 *   never pay-per-post.
 * - Copy frames ALL interaction (posts, quotes, retweets, replies) and makes
 *   clear that pulling new people in scores biggest.
 * - No glow effects (Boris). Flat strokes, glass cards, banana accents.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

interface BoardTile { handle: string; display: string; score: number; pct: number; rank: number }
interface FeedTweet {
  id: string; handle: string; text: string; createdAtMs: number;
  likes: number; retweets: number; replies: number; views: number;
  isReply: boolean; isQuote: boolean; ours: boolean; bot: boolean;
}

type FeedFilter = 'all' | 'posts' | 'quotes' | 'replies' | 'sbs' | 'bot';
const FEED_FILTERS: Array<{ key: FeedFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'sbs', label: 'SBS' },
  { key: 'posts', label: 'Posts' },
  { key: 'quotes', label: 'QRTs' },
  { key: 'replies', label: 'Replies' },
  { key: 'bot', label: 'Draft Bot' },
];

function feedKind(t: FeedTweet): 'post' | 'quote' | 'reply' {
  if (t.isQuote) return 'quote';
  if (t.isReply) return 'reply';
  return 'post';
}

// Filter semantics (Boris 8/14): SBS = posts (and QRTs) we made, never our
// comments — those live under Replies with everyone else's. Draft Bot = only
// @sbsdraftbot's own tweets. Posts = original posts by people (bot excluded —
// it has its own section).
function matchesFilter(t: FeedTweet, f: FeedFilter): boolean {
  if (f === 'all') return true;
  if (f === 'sbs') return t.ours && !t.isReply;
  if (f === 'bot') return t.bot;
  const kind = feedKind(t);
  if (f === 'posts') return kind === 'post' && !t.bot;
  return (f === 'quotes' && kind === 'quote') || (f === 'replies' && kind === 'reply');
}
interface BoardYou { handle: string | null; display: string | null; linked: boolean; rank: number | null; score: number; pct: number }
interface BoardState {
  week: { id: string; startsAtMs: number; endsAtMs: number };
  total: number;
  tiles: BoardTile[];
  you: BoardYou | null;
  zeroTiles: string[];
}

// Tier accent strips — the prize ladder, the map tiles and the leaderboard
// rank numbers all speak the same color per tier (Boris 8/14: subtle, no
// loud fills). JackHOF = its two components red→gold; spins stay banana/neutral.
const STRIP_JACKHOF = 'bg-orange-500'; // red + gold mixed = orange (Boris 8/15)
// Every tier owns a DISTINCT color (Boris 8/14: nothing shares, spins tiers
// differ from each other too): JackHOF red→gold, Jackpot red, HOF gold,
// 3 spins purple, 1 spin teal.
const PRIZES: Array<{ places: string; prize: string; first?: boolean; strip: string }> = [
  { places: '1st', prize: 'JackHOF Seat', first: true, strip: STRIP_JACKHOF },
  { places: '2nd and 3rd', prize: 'Jackpot Seat', strip: 'bg-jackpot' },
  { places: '4th to 10th', prize: 'HOF Seat', strip: 'bg-hof' },
  { places: '11th to 25th', prize: '1 Free Spin', strip: 'bg-teal-400' },
];

function prizeForRank(rank: number): string | null {
  if (rank === 1) return 'JackHOF Seat';
  if (rank <= 3) return 'Jackpot Seat';
  if (rank <= 10) return 'HOF Seat';
  if (rank <= 25) return '1 Free Spin';
  return null;
}

/** Accent strip class for a rank's tile — mirrors the prize ladder. */
function stripForRank(rank: number | null): string | null {
  if (rank === null) return null;
  if (rank === 1) return STRIP_JACKHOF;
  if (rank <= 3) return 'bg-jackpot';
  if (rank <= 10) return 'bg-hof';
  if (rank <= 25) return 'bg-teal-400';
  return null;
}

/** Leaderboard rank-number color per tier — mirrors the strips exactly. */
function rankTextForRank(rank: number): string {
  if (rank === 1) return 'text-orange-400';
  if (rank <= 3) return 'text-jackpot';
  if (rank <= 10) return 'text-hof';
  if (rank <= 25) return 'text-teal-400';
  return 'text-white/40';
}

/** Percent that counts up from 0 on first mount (~700ms ease-out), then
 *  tracks pct changes instantly on later poll refreshes. */
function CountUpPct({ pct }: { pct: number }) {
  const [shown, setShown] = useState(0);
  const animated = useRef(false);
  useEffect(() => {
    if (animated.current) { setShown(pct); return; }
    animated.current = true;
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(pct * eased * 10) / 10);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pct]);
  return <>{shown}%</>;
}

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function kFmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Premium segmented countdown — big tabular digits per unit, seconds tick
 *  with a soft flip every beat. Flat strokes + banana accents, no glow. */
function CountdownChip({ targetMs }: { targetMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = targetMs ? Math.max(0, Math.floor((targetMs - now) / 1000)) : 0;
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  const seg = (v: number, unit: string, tickKey?: number) => (
    <span className="flex flex-col items-center min-w-[32px]">
      <span
        key={tickKey}
        className="text-banana font-extrabold tabular-nums text-[22px] sm:text-[24px] leading-none"
        style={tickKey !== undefined ? { animation: 'secTick 380ms ease-out' } : undefined}
      >
        {String(v).padStart(2, '0')}
      </span>
      <span className="text-[8.5px] font-bold tracking-[0.15em] text-white/40 mt-1.5">{unit}</span>
    </span>
  );
  const colon = <span className="text-banana/35 font-bold text-[19px] -mt-3.5 select-none">:</span>;
  return (
    <span className="ml-auto flex items-center gap-3 sm:gap-4 border border-banana/40 bg-banana/[0.05] rounded-xl px-4 sm:px-5 py-2.5">
      {seg(d, 'DAYS')}
      {colon}
      {seg(h, 'HRS')}
      {colon}
      {seg(m, 'MIN')}
      {colon}
      {seg(sec, 'SEC', sec)}
    </span>
  );
}

// Squarified treemap (Bruls et al.) — keeps tiles near-square instead of the
// skinny slivers a naive binary split produces (Richard 8/13: "why does this
// look so ugly"). Items must be sorted by weight desc.
interface Rect { x: number; y: number; w: number; h: number }
function worstAspect(areas: number[], totalArea: number, side: number): number {
  const thickness = totalArea / side;
  let worst = 0;
  for (const a of areas) {
    const len = a / thickness;
    worst = Math.max(worst, thickness / len, len / thickness);
  }
  return worst;
}
function layoutTreemap(items: Array<{ key: string; weight: number }>, rect: Rect, out: Array<{ key: string } & Rect>) {
  if (!items.length || rect.w <= 0 || rect.h <= 0) return;
  const totalW = items.reduce((s, it) => s + it.weight, 0) || 1;
  const scale = (rect.w * rect.h) / totalW;
  const areas = items.map((it) => ({ key: it.key, area: Math.max(it.weight * scale, 1) }));
  let { x, y, w, h } = rect;
  let i = 0;
  while (i < areas.length && w > 0.5 && h > 0.5) {
    const side = Math.min(w, h);
    const row: typeof areas = [];
    let rowArea = 0;
    let worst = Infinity;
    while (i < areas.length) {
      const cand = areas[i];
      const nextWorst = worstAspect(row.concat(cand).map((r) => r.area), rowArea + cand.area, side);
      if (row.length === 0 || nextWorst <= worst) {
        row.push(cand); rowArea += cand.area; worst = nextWorst; i++;
      } else break;
    }
    const thickness = Math.min(rowArea / side, Math.max(w, h));
    if (w >= h) {
      let yy = y;
      for (const it of row) { const hh = (it.area / rowArea) * h; out.push({ key: it.key, x, y: yy, w: thickness, h: hh }); yy += hh; }
      x += thickness; w -= thickness;
    } else {
      let xx = x;
      for (const it of row) { const ww = (it.area / rowArea) * w; out.push({ key: it.key, x: xx, y, w: ww, h: thickness }); xx += ww; }
      y += thickness; h -= thickness;
    }
  }
}

export default function MindsharePage() {
  const { walletAddress, isLoggedIn } = useAuth();
  const wallet = (walletAddress ?? '').toLowerCase();

  const [board, setBoard] = useState<BoardState | null>(null);
  const [feed, setFeed] = useState<FeedTweet[]>([]);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [shuffleTick, setShuffleTick] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const buildRef = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
      const res = await fetch(`/api/mindshare/board${qs}`, { cache: 'no-store' });
      if (!res.ok) return;
      // Stale-tab guard: a long-lived tab keeps polling fresh DATA but renders
      // with the page code it loaded — reload once when a new deploy shows up.
      const build = res.headers.get('x-mindshare-build');
      if (build) {
        if (buildRef.current === null) buildRef.current = build;
        else if (buildRef.current !== build) { window.location.reload(); return; }
      }
      setBoard((await res.json()) as BoardState);
    } catch { /* transient */ }
  }, [wallet]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // The live tweet catalog — refreshes on the same 60s cadence as the board.
  useEffect(() => {
    const loadFeed = async () => {
      try {
        const res = await fetch('/api/mindshare/feed', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { tweets?: FeedTweet[] };
        if (Array.isArray(data.tweets)) setFeed(data.tweets);
      } catch { /* transient */ }
    };
    void loadFeed();
    const t = setInterval(() => { void loadFeed(); }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Zero-state motion: reorder the equal tiles every few seconds so the board
  // visibly "moves people around" while everyone is at 0.
  useEffect(() => {
    const t = setInterval(() => setShuffleTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const measure = () => {
      const el = mapRef.current;
      if (el) setMapSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const zeroState = !board || board.total <= 0;

  // Build tile list: scored tiles, or shuffled real handles at zero.
  const tileItems: Array<{ key: string; label: string; pct: number | null; weight: number; rank: number | null }> = [];
  if (board) {
    if (!zeroState) {
      // Visual damping (^0.6): the leader stays clearly biggest without one
      // hot account swallowing half the screen. Labels show the true pct.
      // Map shows TOP 10 ONLY — every tile must be big enough for a name AND
      // a percent (Richard 8/13: no "@…" slivers, no percentless boxes). The
      // full 25 live in the leaderboard list.
      const top = board.tiles.slice(0, 10);
      const maxWeight = Math.pow(Math.max(top[0]?.score ?? 1, 1), 0.6);
      top.forEach((t, idx) => {
        // Weight floor (30% of the leader): the last-ranked tile stays big
        // enough to carry its name AND percent — labels show the true pct,
        // only the AREA is floored (Boris 8/14: thaytrader's 2.6% sliver).
        let weight = Math.max(Math.pow(Math.max(t.score, 1), 0.6), maxWeight * 0.3);
        // Ambient breathing (Boris 8/14: alive but SUBTLE — toned down from
        // ±1.5% on his call): a deterministic ±0.6% weight drift per 5s tick
        // makes the boundaries glide via the tiles' 1s transition. Numbers
        // never move — only the layout breathes.
        weight *= 1 + 0.006 * Math.sin((idx * 2.1 + shuffleTick) * 1.7);
        tileItems.push({ key: t.handle.toLowerCase(), label: t.display, pct: t.pct, weight, rank: t.rank });
      });
    } else {
      const names = [...(board.zeroTiles.length ? board.zeroTiles : board.tiles.map((t) => t.display))].slice(0, 18);
      // Deterministic-ish rotation per tick — motion without randomness jitter.
      for (let i = 0; i < names.length; i++) {
        const j = (i + shuffleTick) % names.length;
        tileItems.push({ key: names[j].toLowerCase(), label: names[j], pct: null, weight: 1 + ((j + shuffleTick) % 3) * 0.12, rank: null });
      }
    }
  }
  const rects: Array<{ key: string } & Rect> = [];
  if (mapSize.w > 0 && mapSize.h > 0 && tileItems.length > 0) {
    layoutTreemap(tileItems.map((t) => ({ key: t.key, weight: t.weight })), { x: 0, y: 0, w: mapSize.w, h: mapSize.h }, rects);
  }
  const tileByKey = new Map(tileItems.map((t) => [t.key, t]));
  const youKey = board?.you?.handle?.toLowerCase() ?? null;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-8 pt-5 sm:pt-8 pb-28 lg:pb-12">
      <style>{`
        @keyframes tileIn { from { opacity: 0; transform: scale(0.99) translateY(3px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes secTick { from { opacity: 0.15; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {/* header */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-white text-2xl sm:text-3xl font-bold">Banana Hype</h1>
        <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-white/40">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />LIVE · WEEKLY
        </span>
        <CountdownChip targetMs={board?.week.endsAtMs ?? null} />
      </div>
      <div className="mt-3 max-w-2xl">
        <p className="text-white/85 text-[15px] font-semibold leading-relaxed tracking-[-0.01em]">
          The weekly leaderboard for engaging on X.
        </p>
        <p className="text-white/45 text-sm mt-1.5 leading-relaxed">
          Post good content about SBS, quote us, retweet, reply — it all grows your tile.
          The biggest boost: <span className="text-banana/90 font-semibold">people finding SBS through your posts and drafting</span>.
        </p>
        <p className="text-white/45 text-sm mt-1.5 leading-relaxed">
          Top 25 win every Thursday night — then the board resets and a fresh week begins.
        </p>
      </div>

      {/* prize ladder — the focus, never buried */}
      <div className="mt-5 flex items-center gap-2.5">
        <span className="text-[10px] font-extrabold tracking-[0.18em] text-banana">THIS WEEK&apos;S PRIZES</span>
        <span className="text-[10px] font-bold tracking-[0.14em] text-white/35">TOP 25 WIN · PAID THURSDAY NIGHT · BOARD RESETS</span>
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
        {PRIZES.map((p) => (
          <div
            key={p.places}
            className={`relative overflow-hidden rounded-xl border px-3 py-2.5 ${p.first
              ? 'bg-orange-600 border-orange-500 col-span-2 sm:col-span-1'
              : 'bg-white/[0.03] border-white/[0.07]'}`}
          >
            <div className={`absolute top-0 left-0 right-0 h-[3px] ${p.strip}`} />
            <div className={`text-[11px] font-bold tracking-widest ${p.first ? 'text-white/85' : 'text-white/75'}`}>{p.places.toUpperCase()}</div>
            <div className="text-[13px] font-bold mt-0.5 text-white">{p.prize}</div>
          </div>
        ))}
      </div>

      {/* board + leaderboard */}
      <div className="mt-4 flex flex-col lg:flex-row gap-3">
        <div ref={mapRef} className="relative flex-1 min-h-[380px] sm:min-h-[440px] rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
          {rects.map((r, tileIdx) => {
            const t = tileByKey.get(r.key);
            if (!t) return null;
            const isYou = youKey !== null && r.key === youKey;
            const isKing = !zeroState && t.rank === 1;
            const big = r.w >= 190 && r.h >= 140;
            const tiny = r.w < 74 || r.h < 48; // with the top-10 cap this should never trigger — safety only
            return (
              <div
                key={r.key}
                className={`absolute rounded-xl border overflow-hidden transition-all duration-1000 ease-in-out ${isKing
                  ? 'bg-orange-600 border-orange-500'
                  : (t.rank !== null && t.rank <= 3)
                    ? 'bg-jackpot/[0.07] border-jackpot/25'
                    : (t.rank !== null && t.rank <= 10)
                      ? 'bg-hof/[0.06] border-hof/25'
                      : 'bg-white/[0.04] border-white/[0.07]'} ${isYou ? 'outline outline-2 outline-banana' : ''} ${big ? 'p-4' : 'p-2'}`}
                style={{
                  left: r.x + 3, top: r.y + 3, width: Math.max(r.w - 6, 0), height: Math.max(r.h - 6, 0),
                  // Staggered entrance on first paint; afterwards the 700ms
                  // transition owns all movement (breathing + data shifts).
                  animation: 'tileIn 500ms ease-out both',
                  animationDelay: `${tileIdx * 55}ms`,
                }}
              >
                {!zeroState && stripForRank(t.rank) && (
                  <div className={`absolute top-0 left-0 right-0 h-[3px] ${stripForRank(t.rank)}`} />
                )}
                {/* Name is ALWAYS fully readable (Boris 8/14: no "thayt…"):
                    font auto-shrinks to fit the tile width, and if it hits the
                    floor it wraps to a second line instead of ellipsizing. */}
                {(() => {
                  const label = `${t.label}${isYou ? ' · YOU' : ''}`;
                  // Name size follows the PRIZE TIER like the percent does
                  // (Boris 8/15: better prize = bigger name) — clamped to fit.
                  const tierNameFs = t.rank === 1 ? 22 : t.rank !== null && t.rank <= 3 ? 18 : t.rank !== null && t.rank <= 10 ? 15 : 13;
                  const maxFs = tiny ? 11 : tierNameFs;
                  const fitFs = Math.floor((r.w - (big ? 34 : 18)) / (0.62 * Math.max(label.length, 1)));
                  const nameFs = Math.max(8, Math.min(maxFs, fitFs));
                  return (
                    <div
                      className={`font-bold leading-tight break-words ${isKing ? 'text-white' : 'text-white/80'}`}
                      style={{ fontSize: nameFs }}
                    >
                      {label}
                    </div>
                  );
                })()}
                {/* The percent ALWAYS renders — tiny tiles just get compact
                    type (Boris 8/14: every tile must show its number).
                    Size follows the PRIZE TIER (Boris 8/15: better prize =
                    visually bigger percent) — rank 1 largest, 2-3 next,
                    4-6 next, 7+ smallest — clamped to what fits the tile. */}
                {(() => {
                  const tierPx = t.rank === 1 ? 48 : t.rank !== null && t.rank <= 3 ? 38 : t.rank !== null && t.rank <= 10 ? 28 : 20;
                  const pctFs = tiny ? 12 : Math.max(14, Math.min(tierPx, Math.floor(r.h * 0.3), Math.floor((r.w - 14) * 0.3)));
                  return (
                    <div
                      className={`font-extrabold tabular-nums ${tiny ? 'mt-0.5' : 'mt-1'} ${isKing ? 'text-white' : 'text-white'}`}
                      style={{ fontSize: pctFs, lineHeight: 1.1 }}
                    >
                      {t.pct === null ? '0%' : <CountUpPct pct={t.pct} />}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          {zeroState && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-4 py-2.5 text-center text-[12px] text-white/70">
              Everyone starts at <b className="text-banana">0</b> — first interactions on X claim the board. Tiles are real linked players.
            </div>
          )}
          {!board && (
            <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">Loading the board…</div>
          )}
        </div>

        <div className="lg:w-[300px] flex-none rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-white/[0.07] text-[11px] font-bold tracking-widest text-white/40">
            THIS WEEK&apos;S 25 · ALL WIN THURSDAY
          </div>
          <div className="flex-1 overflow-y-auto max-h-[380px]">
            {(board?.tiles ?? []).map((t, rowIdx) => (
              <div
                key={t.handle}
                title={prizeForRank(t.rank) ?? undefined}
                className={`flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.05] text-[13px] ${youKey === t.handle.toLowerCase() ? 'bg-banana/10' : ''}`}
                style={{ animation: 'tileIn 400ms ease-out both', animationDelay: `${Math.min(rowIdx, 15) * 30}ms` }}
              >
                <span className={`w-6 font-bold tabular-nums ${rankTextForRank(t.rank)}`}>{t.rank}</span>
                <span className="flex-1 min-w-0 truncate text-white/85 font-medium">{t.display}</span>
                <span className="font-bold tabular-nums text-white"><CountUpPct pct={t.pct} /></span>
              </div>
            ))}
            {(!board || board.tiles.length === 0) && (
              <div className="px-4 py-8 text-center text-white/35 text-[13px]">
                No scores yet — the 25 prize spots are wide open.
              </div>
            )}
          </div>
          {/* pinned YOU */}
          <div className="border-t-2 border-banana bg-banana/[0.07] px-4 py-3">
            {!isLoggedIn ? (
              <div className="text-[12.5px] text-white/70">Log in and link your X to claim your tile.</div>
            ) : board?.you && !board.you.linked ? (
              <Link href="/profile" className="block text-[12.5px] font-bold text-banana">
                Link your X to claim your tile →
              </Link>
            ) : board?.you ? (
              <div className="flex items-center gap-2.5">
                <span className="flex-none bg-banana text-black text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full">YOU</span>
                <span className="flex-1 text-[12.5px] font-bold text-white truncate">
                  {board.you.rank ? `#${board.you.rank} · ${board.you.pct}%` : 'No score yet'}
                  <span className="block text-[11px] font-medium text-white/50">
                    {board.you.rank && prizeForRank(board.you.rank)
                      ? `holding ${prizeForRank(board.you.rank)} — defend it`
                      : 'post, quote, reply — claim a prize spot'}
                  </span>
                </span>
              </div>
            ) : (
              <div className="text-[12.5px] text-white/40">…</div>
            )}
          </div>
        </div>
      </div>

      {/* how it works */}
      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 sm:px-5 py-4">
        <div className="text-[11px] font-bold tracking-widest text-white/40 mb-2.5">HOW IT WORKS</div>
        <ul className="space-y-1.5 text-[13px] text-white/60 leading-relaxed">
          <li><b className="text-white/85">Link your X handle</b> to your SBS account to claim your tile.</li>
          <li><b className="text-white/85">Interact about SBS on X.</b> Posts, quotes, retweets and replies all count, and original posts carry the most weight.</li>
          <li><b className="text-white/85">Pulling people in pays the most.</b> Engagement from new faces beats the same circle, and someone joining through your link and entering a draft drops a big bonus on your tile.</li>
          <li><b className="text-white/85">Quality beats spam.</b> Three great posts beat forty junk ones, and junk engagement scores zero.</li>
        </ul>
        <p className="mt-3 text-[11px] text-white/35 leading-relaxed">
          X account must be at least 3 months old and your SBS account must have drafted before. One tile per
          account. Farming, bots and junk engagement score zero, and SBS may review winners before crediting.
        </p>
      </div>

      {/* the live tweet catalog — every post behind the board, click to engage on X */}
      {feed.length > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline gap-3 px-1">
            <h2 className="text-white text-lg font-bold">The Feed</h2>
            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-white/40">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />EVERY POST · LIVE
            </span>
          </div>
          <p className="text-white/45 text-[13px] mt-1 px-1">
            The posts building the board, as they happen. Tap one to jump in on X — every interaction grows a tile.
          </p>
          {/* filter pills — pick what to see; counts keep them honest */}
          <div className="mt-3 flex items-center gap-1.5 flex-wrap px-1">
            {FEED_FILTERS.map((f) => {
              const count = f.key === 'all' ? feed.length : feed.filter((t) => matchesFilter(t, f.key)).length;
              // Every pill stays visible (Boris 8/14: "there should be an SBS
              // one") — an empty category shows its empty-state, not a gap.
              const active = feedFilter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFeedFilter(f.key)}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors ${active
                    ? 'bg-banana border-banana text-black'
                    : 'bg-white/[0.03] border-white/[0.09] text-white/60 hover:text-white/85 hover:border-white/20'}`}
                >
                  {f.label}
                  <span className={`ml-1.5 tabular-nums font-semibold ${active ? 'text-black/50' : 'text-white/30'}`}>{count}</span>
                </button>
              );
            })}
          </div>
          {feed.filter((t) => matchesFilter(t, feedFilter)).length === 0 && (
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-8 text-center text-white/35 text-[13px]">
              Nothing here yet — this fills as the week rolls.
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {feed.filter((t) => matchesFilter(t, feedFilter)).map((t, i) => (
              <a
                key={t.id}
                href={`https://x.com/${t.handle}/status/${t.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`group rounded-xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 ${t.ours
                  ? 'bg-banana/[0.06] border-banana/25 hover:border-banana/50'
                  : 'bg-white/[0.03] border-white/[0.07] hover:border-white/20 hover:bg-white/[0.05]'}`}
                style={{ animation: `feedIn 480ms ease-out both`, animationDelay: `${Math.min(i, 12) * 45}ms` }}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[12.5px] font-bold truncate ${t.ours ? 'text-banana' : 'text-white/85'}`}>
                    @{t.handle}
                  </span>
                  {t.ours && (
                    <span className="flex-none bg-banana text-black text-[9px] font-extrabold tracking-widest px-1.5 py-0.5 rounded-full">SBS</span>
                  )}
                  {t.bot && (
                    <span className="flex-none border border-white/20 text-white/50 text-[9px] font-extrabold tracking-widest px-1.5 py-0.5 rounded-full">DRAFT BOT</span>
                  )}
                  {feedKind(t) !== 'post' && (
                    <span className="flex-none text-[10px] font-bold text-white/30 tracking-wider">
                      {feedKind(t) === 'quote' ? 'QRT' : 'REPLY'}
                    </span>
                  )}
                  <span className="ml-auto flex-none text-[11px] text-white/35 tabular-nums">{timeAgo(t.createdAtMs)}</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-snug text-white/70 line-clamp-4 whitespace-pre-line">
                  {t.text}
                </p>
                <div className="mt-2.5 flex items-center gap-3.5 text-[11px] text-white/35 tabular-nums">
                  <span>♥ {kFmt(t.likes)}</span>
                  <span>↻ {kFmt(t.retweets)}</span>
                  <span>💬 {kFmt(t.replies)}</span>
                  {t.views > 0 && <span className="ml-auto">{kFmt(t.views)} views</span>}
                  <svg viewBox="0 0 24 24" className={`w-3 h-3 ${t.views > 0 ? '' : 'ml-auto'} fill-current opacity-60 group-hover:opacity-100 transition-opacity`} aria-hidden>
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </div>
              </a>
            ))}
          </div>
          <style>{`@keyframes feedIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
      )}
    </div>
  );
}
