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
interface BoardYou { handle: string | null; display: string | null; linked: boolean; rank: number | null; score: number; pct: number }
interface BoardState {
  week: { id: string; startsAtMs: number; endsAtMs: number };
  total: number;
  tiles: BoardTile[];
  you: BoardYou | null;
  zeroTiles: string[];
}

const PRIZES: Array<{ places: string; prize: string; first?: boolean }> = [
  { places: '1st', prize: 'JackHOF seat', first: true },
  { places: '2nd and 3rd', prize: 'Jackpot seat' },
  { places: '4th to 6th', prize: 'HOF seat' },
  { places: '7th to 15th', prize: '3 wheel spins' },
  { places: '16th to 25th', prize: '1 wheel spin' },
];

function prizeForRank(rank: number): string | null {
  if (rank === 1) return 'JackHOF seat';
  if (rank <= 3) return 'Jackpot seat';
  if (rank <= 6) return 'HOF seat';
  if (rank <= 15) return '3 wheel spins';
  if (rank <= 25) return '1 wheel spin';
  return null;
}

function useCountdown(targetMs: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!targetMs) return '';
  const s = Math.max(0, Math.floor((targetMs - now) / 1000));
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return `${d > 0 ? `${d}d ` : ''}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

// Binary-split treemap: stable, animates well with absolutely-positioned tiles.
interface Rect { x: number; y: number; w: number; h: number }
function layoutTreemap(items: Array<{ key: string; weight: number }>, rect: Rect, out: Array<{ key: string } & Rect>) {
  if (!items.length) return;
  if (items.length === 1) { out.push({ key: items[0].key, ...rect }); return; }
  const total = items.reduce((s, it) => s + it.weight, 0) || 1;
  let acc = 0; let cut = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].weight; cut = i + 1;
    if (acc >= total / 2) break;
  }
  const fa = acc / total;
  const a = items.slice(0, cut); const b = items.slice(cut);
  if (rect.w >= rect.h) {
    layoutTreemap(a, { ...rect, w: rect.w * fa }, out);
    layoutTreemap(b, { x: rect.x + rect.w * fa, y: rect.y, w: rect.w * (1 - fa), h: rect.h }, out);
  } else {
    layoutTreemap(a, { ...rect, h: rect.h * fa }, out);
    layoutTreemap(b, { x: rect.x, y: rect.y + rect.h * fa, w: rect.w, h: rect.h * (1 - fa) }, out);
  }
}

export default function MindsharePage() {
  const { walletAddress, isLoggedIn } = useAuth();
  const wallet = (walletAddress ?? '').toLowerCase();

  const [board, setBoard] = useState<BoardState | null>(null);
  const [shuffleTick, setShuffleTick] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const load = useCallback(async () => {
    try {
      const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
      const res = await fetch(`/api/mindshare/board${qs}`, { cache: 'no-store' });
      if (res.ok) setBoard((await res.json()) as BoardState);
    } catch { /* transient */ }
  }, [wallet]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

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

  const countdown = useCountdown(board?.week.endsAtMs ?? null);
  const zeroState = !board || board.total <= 0;

  // Build tile list: scored tiles, or shuffled real handles at zero.
  const tileItems: Array<{ key: string; label: string; pct: number | null; weight: number; rank: number | null }> = [];
  if (board) {
    if (!zeroState) {
      for (const t of board.tiles) {
        tileItems.push({ key: t.handle.toLowerCase(), label: t.display, pct: t.pct, weight: Math.max(t.score, 1), rank: t.rank });
      }
    } else {
      const names = [...(board.zeroTiles.length ? board.zeroTiles : board.tiles.map((t) => t.display))];
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
      {/* header */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-white text-2xl sm:text-3xl font-bold">Banana X Mindshare</h1>
        <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-white/40">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />LIVE
        </span>
        <span className="ml-auto text-[12px] sm:text-sm font-bold text-banana tabular-nums border border-banana/40 rounded-lg px-3 py-1.5">
          🏆 Rewards in {countdown || '…'}
        </span>
      </div>
      <p className="text-white/45 text-sm mt-2 max-w-2xl">
        The live board of who owns SBS attention on X. Posts, quotes, retweets and replies about SBS all grow
        your tile, and pulling new people into the contest grows it fastest. Board pays Thursday night, resets
        on the spot, next race starts immediately.
      </p>

      {/* prize ladder — the focus, never buried */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2">
        {PRIZES.map((p) => (
          <div
            key={p.places}
            className={`rounded-xl border px-3 py-2.5 ${p.first
              ? 'bg-banana border-banana col-span-2 sm:col-span-1'
              : 'bg-white/[0.03] border-white/[0.07]'}`}
          >
            <div className={`text-[10px] font-bold tracking-widest ${p.first ? 'text-black/60' : 'text-white/40'}`}>{p.places.toUpperCase()}</div>
            <div className={`text-[13px] font-bold mt-0.5 ${p.first ? 'text-black' : 'text-white'}`}>{p.prize}</div>
          </div>
        ))}
      </div>

      {/* board + leaderboard */}
      <div className="mt-4 flex flex-col lg:flex-row gap-3">
        <div ref={mapRef} className="relative flex-1 min-h-[380px] sm:min-h-[440px] rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
          {rects.map((r) => {
            const t = tileByKey.get(r.key);
            if (!t) return null;
            const isYou = youKey !== null && r.key === youKey;
            const isKing = !zeroState && t.rank === 1;
            const tiny = r.w < 92 || r.h < 60;
            return (
              <div
                key={r.key}
                className={`absolute rounded-lg border p-2 overflow-hidden transition-all duration-700 ease-out ${isKing
                  ? 'bg-banana border-banana'
                  : 'bg-white/[0.04] border-white/[0.07]'} ${isYou ? 'outline outline-2 outline-banana' : ''}`}
                style={{ left: r.x + 2, top: r.y + 2, width: Math.max(r.w - 4, 0), height: Math.max(r.h - 4, 0) }}
              >
                <div className={`font-bold truncate ${tiny ? 'text-[10px]' : 'text-[12px]'} ${isKing ? 'text-black' : 'text-white/80'}`}>
                  {t.label}{isYou ? ' · YOU' : ''}
                </div>
                {!tiny && (
                  <div className={`font-extrabold tabular-nums mt-1 ${isKing ? 'text-black text-2xl' : 'text-white text-lg'}`}>
                    {t.pct === null ? '0%' : `${t.pct}%`}
                  </div>
                )}
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
            THE 25 · ALL WIN THURSDAY
          </div>
          <div className="flex-1 overflow-y-auto max-h-[380px]">
            {(board?.tiles ?? []).map((t) => (
              <div
                key={t.handle}
                title={prizeForRank(t.rank) ?? undefined}
                className={`flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.05] text-[13px] ${youKey === t.handle.toLowerCase() ? 'bg-banana/10' : ''}`}
              >
                <span className="w-6 text-banana font-bold tabular-nums">{t.rank}</span>
                <span className="flex-1 min-w-0 truncate text-white/85 font-medium">{t.display}</span>
                <span className="font-bold tabular-nums text-white">{t.pct}%</span>
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
    </div>
  );
}
