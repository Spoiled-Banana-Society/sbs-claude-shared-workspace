'use client';

import { useEffect, useState } from 'react';
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
 *
 * Three things the first cut was missing (Richard 2026-07-26):
 *   • no way to see past the top 5 → "See all N" expands the whole board
 *   • your own Bananas were only on the promo card further down the page →
 *     a pinned You row, fed by the AUTHENTICATED /api/promos number so it's
 *     right even when you're nowhere near the top
 *   • nothing here explained what a Banana is → the header is a button that
 *     opens the promo modal (the mechanic + rate card already live there)
 */

/** Rows shown before expanding. */
const COLLAPSED_ROWS = 5;
/** Matches MAX_LIMIT in the route — one request gets the whole board. */
const EXPANDED_LIMIT = 250;

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

export function BananaDrawBanner({
  myWallet,
  myBananas = 0,
  myPending = 0,
  onExplain,
}: {
  myWallet?: string | null;
  /** This cycle's Bananas for the signed-in user, from the authed promo payload. */
  myBananas?: number;
  /** Drafts entered but not yet filled — Bananas land at FILL. */
  myPending?: number;
  /** Opens the Banana Draw promo modal, which holds the full explainer. */
  onExplain?: () => void;
}) {
  const [state, setState] = useState<PublicState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  // Fetch effect deps are SCALARS only (the row limit). Listing a churning
  // callback here is the render-loop self-DDoS from Rule #0.
  const limit = expanded ? EXPANDED_LIMIT : 0;
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const qs = limit > 0 ? `?limit=${limit}` : '';
        const res = await fetch(`/api/promos/banana-draw${qs}`);
        if (!res.ok) return;
        const data = (await res.json()) as PublicState;
        if (alive) setState(data);
      } catch { /* banner is decoration — never surface a fetch error here */ }
    };
    void load();
    // Slow poll: the board only moves when a draft fills. 60s is plenty and
    // keeps this well clear of the 1500/min/IP rate limit.
    const poll = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(poll); };
  }, [limit]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const wallets = [
    ...(state?.leaderboard ?? []).map((r) => r.userId),
    ...(state?.recentWinners ?? []).map((w) => w.name),
  ];
  const users = useDraftRoomUsers(wallets);
  const nameFor = (w: string) => users[w?.toLowerCase?.() ?? '']?.displayName || bananaDefaultName(w || '');

  // Render even at zero. Hiding on an empty pool made the leaderboard vanish
  // for the whole launch window — 657 users got a bell and would have clicked
  // through to nothing. An empty state that says "be the first" is the point
  // of a launch, not a failure case.
  if (!state) return null;
  const me = myWallet?.toLowerCase();
  const lastWinner = state.recentWinners[0];
  const empty = state.totalBananas <= 0;

  const rows = expanded ? state.leaderboard : state.leaderboard.slice(0, COLLAPSED_ROWS);
  // Rank comes from the fetched board, so it's exact whenever you're inside the
  // slice we hold. Outside it we still show your Bananas — a number without a
  // position beats no row at all.
  const myIdx = me ? state.leaderboard.findIndex((r) => r.userId.toLowerCase() === me) : -1;
  const myRank = myIdx >= 0 ? myIdx + 1 : null;
  const meInRows = myIdx >= 0 && myIdx < rows.length;
  const canExpand = state.entrantCount > rows.length || expanded;

  return (
    <div className="rounded-2xl border border-white/10 bg-bg-tertiary/60 backdrop-blur p-4 mb-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <button
          type="button"
          onClick={onExplain}
          className="group flex items-center gap-2 min-w-0 text-left"
        >
          <span className="text-lg">🍌</span>
          {/* NOT "Tonight's" — the draw lands at NOON PT, so from launch time
              until midnight the seat is up to 24h out and "tonight" is simply
              false (Richard 2026-07-26). "Next" is true at every hour. */}
          <span className="text-text-primary font-semibold truncate">
            Next <JackHofWordmark size={13} /> seat
          </span>
          <span
            aria-hidden
            className="shrink-0 w-[15px] h-[15px] rounded-full border border-white/20 text-[10px] leading-[13px] text-center text-text-muted transition-colors group-hover:border-white/45 group-hover:text-text-primary"
          >
            ?
          </span>
        </button>
        {/* A bare 17:19:26 doesn't say what it's counting to — the draw hour
            makes it legible. Hidden on the narrowest screens so the header
            never wraps. */}
        <span className="text-text-muted text-sm tabular-nums shrink-0">
          {countdown(state.closesAt, now)}
          <span className="hidden sm:inline text-xs text-text-muted/70"> · noon PT</span>
        </span>
      </div>

      {empty ? (
        <button type="button" onClick={onExplain} className="w-full py-4 text-center">
          <p className="text-text-primary text-sm font-semibold">No Bananas in this draw yet.</p>
          <p className="text-text-muted text-xs mt-1">
            Fill a draft and you&apos;re first on the board — free draft 🍌 1, paid 🍌 2.
          </p>
        </button>
      ) : (
      <div className={`space-y-1 mb-3 ${expanded ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>
        {rows.map((r, i) => {
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
              <span className="shrink-0 tabular-nums">🍌 {r.bananas}</span>
            </div>
          );
        })}
      </div>
      )}

      {/* Your own line — always visible when you're signed in and not already
          in the rows above, so you never have to scroll the page to find out
          what you're holding. */}
      {me && !meInRows && (
        myBananas > 0 ? (
          <div className="flex items-center justify-between text-sm py-1 mb-2 border-t border-white/5 pt-2 text-banana font-semibold">
            <span className="truncate mr-3">
              <span className="text-text-muted mr-2 tabular-nums">{myRank ?? '—'}</span>
              You
            </span>
            <span className="shrink-0 tabular-nums">
              🍌 {myBananas}
              {myPending > 0 && <span className="text-text-muted font-normal"> · {myPending} filling</span>}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onExplain}
            className="w-full text-left text-xs text-text-muted hover:text-text-secondary transition-colors py-1 mb-2 border-t border-white/5 pt-2"
          >
            You have 🍌 0 — fill a draft to get in{myPending > 0 ? ` (${myPending} filling)` : ''}.
          </button>
        )
      )}

      {canExpand && !empty && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-center text-xs text-text-muted hover:text-text-primary transition-colors py-1.5 mb-1"
        >
          {expanded ? 'Show less' : `See all ${state.entrantCount}`}
        </button>
      )}

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
