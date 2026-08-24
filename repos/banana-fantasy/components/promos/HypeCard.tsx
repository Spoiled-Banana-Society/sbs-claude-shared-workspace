'use client';

// Banana Hype as a promo card (Boris 2026-08-24, layout C "prize-first" from
// the mock sign-off): the weekly mindshare race surfaces in the promo grids
// (home + /promos) instead of hiding on its own nav page. Blue is Hype's
// color the way green is the zone's. The card is the trailer — "See the
// board →" opens /mindshare, the full existing page (treemap, complete
// top 25 with prize tiers, live feed). Nothing here replaces that page.
//
// Live data: /api/mindshare/board?wallet= (tiles + the viewer's own row),
// pulled on mount, focus and a slow interval — the board itself only moves
// on the 5-minute scan cron, so no stream needed. Prize ladder mirrors
// lib/mindshare's weekly prizes: 1st JackHOF · 2–3 Jackpot · 4–6 HOF ·
// 7–15 three spins · 16–25 one spin. Week resets Thursday 9pm ET (verified
// against the week doc's endsAtMs).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

interface Tile { handle: string; display: string; pct: number; rank: number }
interface You { handle: string | null; linked: boolean; rank: number | null; pct: number }
interface Board { tiles: Tile[]; you: You | null }

/** Rank chip color by prize tier — same accents as the /mindshare board. */
const rankChip = (rank: number) =>
  rank === 1 ? 'bg-gradient-to-br from-[#ef4444] to-[#D4AF37] text-white'
    : rank <= 3 ? 'bg-[#ef4444] text-white'
      : rank <= 6 ? 'bg-[#D4AF37] text-[#1a1206]'
        : rank <= 15 ? 'bg-[#a855f7] text-white'
          : 'bg-teal-400 text-[#042f2a]';

const prizeZone = (rank: number) =>
  rank === 1 ? 'JACKHOF SEAT' : rank <= 3 ? 'JACKPOT SEAT' : rank <= 6 ? 'HOF SEAT' : rank <= 15 ? '3 SPINS' : rank <= 25 ? '1 SPIN' : null;

export function HypeCard({ className = '' }: { className?: string }) {
  const router = useRouter();
  const { user, isTwitterVerified, linkTwitter } = useAuth();
  const wallet = user?.walletAddress ?? null;
  const [board, setBoard] = useState<Board | null>(null);
  const dead = useRef(false);

  const pull = useCallback(async () => {
    try {
      const res = await fetch(`/api/mindshare/board${wallet ? `?wallet=${wallet}` : ''}`, { cache: 'no-store' });
      const d = (await res.json()) as Board;
      if (!dead.current && Array.isArray(d.tiles)) setBoard(d);
    } catch { /* card is decoration over /mindshare — keep last good state */ }
  }, [wallet]);

  useEffect(() => {
    dead.current = false;
    void pull();
    const onFocus = () => { void pull(); };
    window.addEventListener('focus', onFocus);
    const t = setInterval(() => { void pull(); }, 5 * 60_000);
    return () => { dead.current = true; window.removeEventListener('focus', onFocus); clearInterval(t); };
  }, [pull]);

  // Logged-out surfaces show ONLY the conversion cards (Boris standing rule)
  // — Hype needs an account + linked X anyway, so it waits for login.
  const top = board?.tiles.slice(0, 6) ?? [];
  const you = board?.you ?? null;
  const yourZone = you?.rank ? prizeZone(you.rank) : null;
  const goBoard = () => router.push('/mindshare');

  if (!user) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goBoard}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goBoard(); } }}
      className={`promo-rise relative grid grid-cols-[96px_1fr] sm:grid-cols-[110px_1fr] overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#131318] cursor-pointer select-none text-left
        transition-[box-shadow,transform] duration-150 hover:-translate-y-[3px] hover:shadow-[0_16px_36px_rgba(0,0,0,.45)] active:scale-[.985] ${className}`}
    >
      {/* rail — the prize IS the headline. Left column at every size, same
          as the other long cards' swatch column (Boris 2026-08-24). */}
      <div className="flex flex-col items-center justify-center gap-2 sm:gap-1.5 px-2 py-4 text-center bg-[radial-gradient(130%_150%_at_20%_-10%,#0e7490_0%,#0b4a66_45%,#072338_100%)]">
        <span className="h-px w-5 bg-white/25" aria-hidden />
        <span className="text-[8px] sm:text-[8.5px] font-extrabold tracking-[1.2px] sm:tracking-[1.4px] text-white/75">1ST PLACE WINS A</span>
        <span className="text-[17px] font-extrabold leading-[1.15] text-white">JACKHOF<br />SEAT</span>
        <span className="text-[8px] sm:text-[8.5px] font-extrabold tracking-[1.2px] sm:tracking-[1.4px] text-[#67e8f9]">EVERY WEEK</span>
        <span className="h-px w-5 bg-white/25" aria-hidden />
      </div>

      <div className="flex flex-col gap-1.5 min-w-0 px-3.5 sm:px-4 pt-3 pb-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[9.5px] sm:text-[11.5px] font-extrabold tracking-[1.2px] sm:tracking-[2px] text-[#22d3ee] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">JACKHOF SEAT + MORE<span className="hidden sm:inline"> · WEEKLY</span></span>
          <span className="text-[8px] sm:text-[8.5px] font-extrabold tracking-[1px] sm:tracking-[1.1px] uppercase text-white/55 whitespace-nowrap shrink-0">Resets <b className="text-[#67e8f9]">Thu 9PM ET</b></span>
        </div>
        <h4 className="text-[17px] font-extrabold text-white tracking-[-.2px] leading-tight">Banana Hype</h4>
        <p className="text-[11.5px] leading-[1.45] text-[#d5dbe4]">
          Post, QRT and reply about SBS on X — the more you engage, the bigger your <b className="text-banana font-extrabold">mindshare</b>, your share of this week&apos;s conversation. Top 25 win prizes in our weekly leaderboard.
        </p>

        {/* top 6: 1–3 down the left column, 4–6 down the right */}
        {top.length > 0 && (
          <div className="grid grid-cols-2 grid-rows-3 grid-flow-col gap-x-4 gap-y-[4px]">
            {top.map((t) => (
              <div key={t.rank} className="flex items-center gap-[7px] min-w-0 text-[11px] font-bold">
                <span className={`w-[20px] h-[20px] rounded-[6px] inline-flex items-center justify-center text-[10px] font-black shrink-0 ${rankChip(t.rank)}`}>{t.rank}</span>
                <span className="text-white whitespace-nowrap overflow-hidden text-ellipsis">@{t.handle}</span>
                <span className="ml-auto text-[#67e8f9] font-extrabold tabular-nums shrink-0">{t.pct}%</span>
              </div>
            ))}
          </div>
        )}

        {/* the whole ladder — everyone sees what every rank pays */}
        <div className="flex flex-wrap gap-1">
          <span className="text-[8px] font-black tracking-[.6px] rounded-full px-2 py-[3px] whitespace-nowrap border border-[#D4AF37] text-[#ffd977] bg-gradient-to-br from-[#ef4444]/25 to-[#D4AF37]/25">1ST · JACKHOF SEAT</span>
          <span className="text-[8px] font-black tracking-[.6px] rounded-full px-2 py-[3px] whitespace-nowrap border border-[#ef4444]/60 text-[#fca5a5] bg-black/25">2–3 · JACKPOT SEAT</span>
          <span className="text-[8px] font-black tracking-[.6px] rounded-full px-2 py-[3px] whitespace-nowrap border border-[#D4AF37]/55 text-[#e7c766] bg-black/25">4–6 · HOF SEAT</span>
          <span className="text-[8px] font-black tracking-[.6px] rounded-full px-2 py-[3px] whitespace-nowrap border border-[#a855f7]/55 text-[#d3b0f7] bg-black/25">7–15 · 3 SPINS</span>
          <span className="text-[8px] font-black tracking-[.6px] rounded-full px-2 py-[3px] whitespace-nowrap border border-teal-400/55 text-[#7ce8dc] bg-black/25">16–25 · 1 SPIN</span>
        </div>

        {/* no X linked → the way in; linked → your live standing */}
        {!isTwitterVerified ? (
          <div
            className="flex items-center justify-between gap-2 rounded-xl border border-banana/45 bg-banana/[.07] px-3 py-2"
            onClick={(e) => { e.stopPropagation(); linkTwitter(); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); linkTwitter(); } }}
          >
            <span className="text-[10.5px] font-extrabold text-[#ffe08a]">Connect your X to start earning mindshare.</span>
            <span className="text-[10px] font-black tracking-[.5px] text-black bg-banana rounded-full px-2.5 py-1 whitespace-nowrap">CONNECT X</span>
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 rounded-xl border border-white/25 bg-white/[.05] px-3 py-2">
          <span className="min-w-0 text-[10px] font-extrabold tracking-[.5px] uppercase text-white leading-snug">
            {you?.linked && you.rank
              ? <>You · <b className="text-banana">#{you.rank}</b> · {you.pct}%{yourZone ? <> — <b className="text-banana">{yourZone}</b> zone</> : null}</>
              : you?.linked
                ? <>You · not on the board yet — post to enter</>
                : <>Full top 25 + live feed on the board</>}
          </span>
          <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[10.5px] font-extrabold text-black whitespace-nowrap">See the board →</span>
        </div>
      </div>
    </div>
  );
}
