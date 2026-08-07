'use client';

import { useEffect, useState } from 'react';

/**
 * This wallet's sealed pack count for tonight, for surfaces that need the
 * number but not the whole opening room — the promo card and the modal.
 *
 * ⚠️ Reads the public endpoint only. Never import lib/dropMath from a client
 * surface: it pulls in `node:crypto`, which webpack cannot bundle for the
 * browser and which 500s the whole route.
 */
export interface DropMe {
  sealed: number;
  opened: number;
  packCount: number;
  status: 'earning' | 'locked' | 'settled';
  loaded: boolean;
  /**
   * Packs this wallet holds for the night the CLOCK is counting down to.
   *
   * Before 8pm that's tonight's stack. After 8pm the earning night has already
   * rolled forward, so a draft that fills at 8:30pm banks for TOMORROW — and
   * `sealed` (keyed to the reveal night) would keep showing tonight's number
   * while the card counts down to a different night. This is the one that
   * always matches the countdown.
   */
  upcomingSealed: number;
  /**
   * Every unopened pack this wallet holds, across ALL nights — tonight's,
   * the post-8pm earning night, and held-back stacks from earlier nights
   * (nothing auto-opens, so those linger). The header badge number: "you
   * have packs waiting", regardless of which night they belong to.
   */
  totalSealed: number;
}

const EMPTY: DropMe = {
  sealed: 0, opened: 0, packCount: 0, status: 'earning', loaded: false, upcomingSealed: 0, totalSealed: 0,
};

export function useDropMe(wallet: string | null | undefined): DropMe {
  const [me, setMe] = useState<DropMe>(EMPTY);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
        const res = await fetch(`/api/promos/drop${qs}`, { cache: 'no-store' });
        if (!res.ok) return;
        const d = await res.json() as {
          status: DropMe['status']; packCount: number;
          you: { sealed: number; opened: number } | null;
          next: { nightId: string; locksAt: number; sealed: number } | null;
          previous?: Array<{ nightId: string; sealed: number }>;
        };
        if (!alive) return;
        setMe({
          sealed: d.you?.sealed ?? 0,
          opened: d.you?.opened ?? 0,
          packCount: d.packCount ?? 0,
          status: d.status,
          loaded: true,
          // `next` is present ONLY between 8pm and midnight, and is exactly the
          // night the countdown targets in that window. Outside it, the reveal
          // night and the earning night are the same, so `sealed` is correct.
          upcomingSealed: d.next ? d.next.sealed : (d.you?.sealed ?? 0),
          totalSealed: (d.you?.sealed ?? 0) + (d.next?.sealed ?? 0)
            + (d.previous ?? []).reduce((n, p) => n + p.sealed, 0),
        });
      } catch { /* transient */ }
    };
    load();
    // Slow poll — a pack only arrives when a draft fills.
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [wallet]); // stable scalar only
  return me;
}
