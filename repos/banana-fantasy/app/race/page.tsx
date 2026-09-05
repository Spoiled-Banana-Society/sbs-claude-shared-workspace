'use client';

// /race — Banana Race leaderboard (lib/bananaRace.ts). Ships dark: while the
// switch is off the board API answers { enabled:false } and this page shows a
// one-line "not live" note (no 404, so the link can go out before the flip).
//
// One fetch on mount + one a minute + one on wallet change. The interval is
// independent of the response, so nothing here can loop (Rule #0).

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { BananaRaceBoard } from '@/components/race/BananaRaceBoard';
import type { RaceBoard } from '@/lib/bananaRace';

const POLL_MS = 60_000;

export default function BananaRacePage() {
  const { walletAddress, isLoggedIn, setShowLoginModal } = useAuth();
  const wallet = (walletAddress ?? '').toLowerCase();
  const [board, setBoard] = useState<RaceBoard | { enabled: false } | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
      const res = await fetch(`/api/race/board${qs}`, { cache: 'no-store' });
      if (!res.ok) return;
      setBoard(await res.json());
    } catch { /* keep the last board */ }
  }, [wallet]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (board === null) {
    return <div className="mx-auto max-w-[900px] px-4 py-16 text-center text-white/50">Loading the board…</div>;
  }
  if (!board.enabled) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-16 text-center text-white">
        <h1 className="text-[40px] font-black uppercase">Banana <span className="text-banana">Race</span></h1>
        <p className="mt-2 text-white/65">Not running right now. Keep an eye on the promos page.</p>
        <Link href="/promos" className="mt-5 inline-block rounded bg-banana px-5 py-2.5 font-black uppercase text-black">Promos</Link>
      </div>
    );
  }
  return <BananaRaceBoard board={board} loggedIn={isLoggedIn} onLogin={() => setShowLoginModal(true)} />;
}
