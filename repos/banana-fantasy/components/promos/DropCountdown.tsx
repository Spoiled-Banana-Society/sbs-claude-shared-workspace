'use client';

import React, { useEffect, useState } from 'react';
// ⚠️ dropRates, NEVER dropMath — the latter pulls in `node:crypto`, which
// webpack cannot bundle for the browser and which 500s the whole route.
import { formatDropCountdown, msUntilOpen } from '@/lib/dropRates';
import { useDropMe } from '@/hooks/useDropMe';

/**
 * Countdown to the next 8pm drop, for the promo card.
 *
 * ⚠️ The clock NEVER stops. It counts to the next EARNING deadline
 * (msUntilDrop), so at 8:00:00 it rolls to ~24h and keeps running through the
 * night. That roll is deliberate: after 8pm a draft that fills is banking packs
 * for TOMORROW, so the thing a player needs to see is how long they have to
 * earn into the next drop — not a dead "OPEN NOW" that tells them nothing about
 * what they're playing for (Boris 2026-08-02).
 *
 * OPEN NOW still shows, but ALONGSIDE the clock rather than replacing it, and
 * only while they actually hold unopened packs from tonight — those auto-open
 * at midnight, so the prompt is real information for exactly that window.
 *
 * The pack count is keyed to `upcomingSealed`, which follows the same night the
 * clock does — so "2 packs" always means "2 packs for the drop this timer is
 * counting to", never a stale count from a night that already opened.
 */
export function DropCountdown({
  className = '',
  wallet = null,
}: {
  className?: string;
  wallet?: string | null;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const [canOpen, setCanOpen] = useState(false);
  const me = useDropMe(wallet);

  useEffect(() => {
    // Render nothing on the server pass — a countdown computed at build time
    // hydrates wrong and flashes a stale number.
    const tick = () => {
      setLabel(formatDropCountdown());
      // 0 from 8pm to midnight = tonight's packs are openable right now.
      setCanOpen(msUntilOpen() <= 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (label === null) return null;

  const packs = me.loaded ? me.upcomingSealed : 0;
  const showOpen = canOpen && me.loaded && me.sealed > 0;

  // ⚠️ No colour of its own. Every other countdown in the row is a bare
  // `font-semibold tabular-nums` span inheriting text-[#4a4a4a] from the footer
  // container — hardcoding a colour here made THE DROP the one card that
  // didn't match (Boris 2026-08-02). OPEN NOW keeps its green because it is a
  // state, not a timer.
  return (
    <span className={`font-semibold tabular-nums ${className}`}>
      {showOpen && (
        <>
          <span className="text-[#22c55e]">OPEN NOW</span>
          <span> · </span>
        </>
      )}
      <span>{label}</span>
      {packs > 0 && <span> · {packs} pack{packs === 1 ? '' : 's'}</span>}
    </span>
  );
}
