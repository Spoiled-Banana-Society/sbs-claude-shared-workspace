'use client';

// BANANA RACE tile — the home promo grid and /promos (lib/bananaRace.ts).
// Ships dark: renders NOTHING until /api/race/board says enabled. One fetch
// per wallet change, no polling (the /race page is the live surface).
// Points + tickets only, no odds.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import type { RaceBoard } from '@/lib/bananaRace';

const PT: Intl.DateTimeFormatOptions = { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' };
const fmtPT = (iso: string) => new Date(iso).toLocaleString('en-US', PT).replace(',', '') + ' PT';

export function BananaRaceCard({ preview }: { preview?: RaceBoard }) {
  const { user } = useAuth();
  const wallet = user?.walletAddress?.toLowerCase() ?? '';
  const [board, setBoard] = useState<RaceBoard | null>(preview ?? null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    const q = wallet ? `?wallet=${wallet}` : '';
    fetch(`/api/race/board${q}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RaceBoard | { enabled: false } | null) => { if (alive && d && d.enabled) setBoard(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [wallet, preview]);

  if (!board || !board.enabled) return null;
  const closed = board.frozen || Date.parse(board.endAtIso) <= Date.now();
  const leader = board.board[0];

  return (
    <Link
      href="/race"
      className="block rounded-2xl border border-banana/50 bg-gradient-to-r from-banana/[.14] to-transparent px-4 py-3.5 text-white transition-colors hover:border-banana"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[.14em] text-banana">
            {closed ? 'Results are in' : `Points close ${fmtPT(board.endAtIso)}`}
          </div>
          <div className="text-[20px] font-black uppercase leading-tight">Banana Race</div>
          <p className="mt-0.5 text-[13px] text-white/75">
            Every paid draft is 1 point. Top {board.topN} lock a JackHOF seat.{' '}
            {board.seats.total} special seats go out in the draw. Winners draft {fmtPT(board.draftAtIso)}.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {board.you ? (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[.12em] text-white/50">You</div>
              <div className="text-[22px] font-black leading-none tabular-nums">#{board.you.rank} · {board.you.points} pts</div>
            </div>
          ) : leader ? (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[.12em] text-white/50">Leader</div>
              <div className="text-[22px] font-black leading-none tabular-nums">{leader.name} · {leader.points} pts</div>
            </div>
          ) : null}
          <span className="rounded-full bg-banana px-4 py-2 text-[13px] font-black uppercase tracking-wide text-black">See the board</span>
        </div>
      </div>
    </Link>
  );
}
