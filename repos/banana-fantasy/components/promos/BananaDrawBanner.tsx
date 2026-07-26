'use client';

import { useEffect, useRef, useState } from 'react';
import { useDraftRoomUsers } from '@/hooks/useDraftRoomUsers';
import { bananaDefaultName } from '@/utils/helpers';
import { JackHofWordmark } from '@/components/ui/JackHofWordmark';

/**
 * The Banana Draw leaderboard, pinned to the top of /promos so everyone sees
 * it — not just people who open the promo (Boris 2026-07-26).
 *
 * Ranked by Bananas but SURFACED as share: "the leader holds 14%" reads as an
 * invitation, "you're 47th" reads as a reason to quit. Same reasoning as the
 * modal's board.
 */

interface PublicState {
  cycleId: string;
  closesAt: number;
  totalBananas: number;
  entrantCount: number;
  leaderboard: Array<{ userId: string; bananas: number; sharePct: number }>;
  recentWinners: Array<{ cycleId: string; name: string; bananas: number }>;
  seatsClaimed: number;
  seatsTotal: number;
}

/** Same H:MM:SS shape the other promo countdowns use — no custom label. */
function countdown(closesAt: number, nowMs: number): string {
  const diff = closesAt - nowMs;
  if (diff <= 0) return '0:00:00';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function BananaDrawBanner({ myWallet }: { myWallet?: string | null }) {
  const [state, setState] = useState<PublicState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Ref pattern, not a dep — a fetch effect that lists a churning callback is
  // the render-loop self-DDoS from Rule #0.
  const loadedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/promos/banana-draw');
        if (!res.ok) return;
        const data = (await res.json()) as PublicState;
        if (alive) setState(data);
      } catch { /* banner is decoration — never surface a fetch error here */ }
    };
    if (!loadedRef.current) { loadedRef.current = true; void load(); }
    // Slow poll: the board only moves when a draft fills. 60s is plenty and
    // keeps this well clear of the 1500/min/IP rate limit.
    const poll = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, []);

  const wallets = [
    ...(state?.leaderboard ?? []).map((r) => r.userId),
    ...(state?.recentWinners ?? []).map((w) => w.name),
  ];
  const users = useDraftRoomUsers(wallets);
  const nameFor = (w: string) => users[w?.toLowerCase?.() ?? '']?.displayName || bananaDefaultName(w || '');

  if (!state || state.totalBananas <= 0) return null;
  const me = myWallet?.toLowerCase();
  const lastWinner = state.recentWinners[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-bg-tertiary/60 backdrop-blur p-4 mb-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">🍌</span>
          <span className="text-text-primary font-semibold truncate">
            Tonight&apos;s <JackHofWordmark size={13} /> seat
          </span>
        </div>
        <span className="text-text-muted text-sm tabular-nums shrink-0">
          {countdown(state.closesAt, now)}
        </span>
      </div>

      <div className="space-y-1 mb-3">
        {state.leaderboard.slice(0, 5).map((r, i) => {
          const isYou = !!me && r.userId.toLowerCase() === me;
          return (
            <div
              key={r.userId}
              className={`flex items-center justify-between text-sm py-0.5 ${isYou ? 'text-banana font-semibold' : 'text-text-secondary'}`}
            >
              <span className="truncate mr-3">
                <span className="text-text-muted mr-2 tabular-nums">{i + 1}</span>
                {isYou ? 'You' : nameFor(r.userId)}
              </span>
              <span className="flex items-center gap-3 shrink-0 tabular-nums">
                <span>🍌 {r.bananas}</span>
                <span className="text-text-muted w-12 text-right">{r.sharePct.toFixed(1)}%</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted border-t border-white/5 pt-2 gap-3">
        <span className="truncate">
          {state.seatsClaimed} of {state.seatsTotal} seats claimed
          {lastWinner ? <> · last winner {nameFor(lastWinner.name)} on 🍌 {lastWinner.bananas}</> : null}
        </span>
        <span className="shrink-0">{state.totalBananas} 🍌 in the draw</span>
      </div>
    </div>
  );
}
