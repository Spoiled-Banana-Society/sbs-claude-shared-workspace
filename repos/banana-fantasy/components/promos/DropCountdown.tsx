'use client';

import React, { useEffect, useState } from 'react';
// ⚠️ dropRates, NEVER dropMath — the latter pulls in `node:crypto`, which
// webpack cannot bundle for the browser and which 500s the whole route.
import { formatOpenCountdown, msUntilOpen } from '@/lib/dropRates';

/**
 * Countdown to tonight's 8pm unlock, for the promo card.
 *
 * The schedule is deterministic, so this needs no server round-trip — it just
 * ticks locally. Without it the card said "Open them at 8PM" with no sense of
 * how close that was, which is the whole tension of a promo you earn into all
 * day (Richard 2026-08-02).
 */
export function DropCountdown({ className = '' }: { className?: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    // Render nothing on the server pass — a countdown computed at build time
    // hydrates wrong and flashes a stale number.
    // msUntilOpen, NOT msUntilDrop — the latter rolls at 8pm and would show
    // 23:59:59 at the moment the packs actually unlock. This reads 0 for the
    // whole 8pm–midnight window, so the card says OPEN NOW when it's open.
    const tick = () => setLabel(msUntilOpen() > 0 ? formatOpenCountdown() : null);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (label === null) {
    return (
      <span className={`font-bold tabular-nums text-[#22c55e] ${className}`}>
        OPEN NOW
      </span>
    );
  }
  return (
    <span className={`font-bold tabular-nums ${className}`}>
      <span className="text-[#6366f1]">{label}</span>
      <span className="text-[#4a4a58]"> to 8PM</span>
    </span>
  );
}
