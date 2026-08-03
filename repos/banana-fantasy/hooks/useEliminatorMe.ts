'use client';

import { useEffect, useState } from 'react';
import { eliminatorRetired } from '@/lib/promoWindow';

/**
 * This wallet's live standing in THE ELIMINATOR, for surfaces that need the
 * number but not the whole board — currently the promo card on the home
 * carousel ("🍌 21 · TOP 5").
 *
 * Reads the same public endpoint the /promos leaderboard uses. The endpoint is
 * auth-free and `?wallet=` only adds that wallet's own public standing, so
 * there's nothing here a draft lobby doesn't already show.
 *
 * ⚠️ RULE #0 (CLAUDE.md — the May 27 2026 self-DDoS): the fetch effect depends
 * on the wallet STRING and nothing else. Never add a function or a
 * Privy-derived value to these deps — their identity churns every render,
 * which refires the effect every render and 403s the whole site behind Vercel
 * DDoS mitigation.
 */

/** Slow on purpose: the board only changes on the hour, so this exists to
 *  catch a burn, not to animate. Matches EliminatorBanner's cadence. */
const POLL_MS = 30_000;

export interface EliminatorMe {
  /** Null until the first response lands, or when the promo isn't running. */
  bananas: number | null;
  rank: number | null;
  onList: boolean;
  /** Holding one of the survivor seats right now. */
  inTop5: boolean;
  /** Bananas needed to take the last seat. 0 when already holding one. */
  bananasToSeat: number;
  live: boolean;
}

const EMPTY: EliminatorMe = {
  bananas: null, rank: null, onList: false, inTop5: false, bananasToSeat: 0, live: false,
};

export function useEliminatorMe(wallet: string | null | undefined): EliminatorMe {
  const [me, setMe] = useState<EliminatorMe>(EMPTY);

  useEffect(() => {
    // RETIRED (2026-08-01): stop the poll dead. This runs for every logged-in
    // user on the home page on an interval, so leaving it up after the promo
    // ends is a permanent Firestore read bill for a number nothing renders.
    if (!wallet || eliminatorRetired()) { setMe(EMPTY); return; }
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/promos/eliminator?wallet=${encodeURIComponent(wallet)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const d = await res.json() as {
          status?: string;
          survivorSlots?: number;
          you?: { bananas: number; rank: number; onList: boolean; bananasToSeat: number } | null;
        };
        if (!alive) return;
        const slots = d.survivorSlots ?? 5;
        const you = d.you ?? null;
        setMe({
          bananas: you ? you.bananas : null,
          rank: you ? you.rank : null,
          onList: !!you?.onList,
          // Top 5 means holding a seat — on the list AND inside the slot count.
          inTop5: !!you?.onList && you.rank <= slots,
          bananasToSeat: you?.bananasToSeat ?? 0,
          live: d.status === 'live',
        });
      } catch { /* transient — the next tick retries */ }
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [wallet]); // stable scalar only — see the RULE #0 note above

  return me;
}
