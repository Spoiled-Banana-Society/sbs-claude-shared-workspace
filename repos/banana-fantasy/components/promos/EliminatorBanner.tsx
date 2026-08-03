'use client';

import { useEffect, useRef, useState } from 'react';
// ⚠️ Import from eliminatorRates, NEVER eliminatorMath — the latter pulls in
// `node:crypto`, which webpack cannot bundle for the browser. Doing so 500s
// this whole route (caught 2026-07-31 before deploy).
import {
  BANANAS_FREE_DRAFT, BANANAS_PAID_DRAFT, BANANAS_SURVIVE_HOUR, SURVIVORS_PER_BURN,
} from '@/lib/eliminatorRates';
import {
  playBurnSound, playSurvivorChime, primeEliminatorAudio,
  isEliminatorMuted, setEliminatorMuted,
} from '@/lib/eliminatorSound';
// Safe in the browser bundle for the same reason eliminatorRates is: promoWindow
// is bare constants with no imports of its own.
import { eliminatorRetired } from '@/lib/promoWindow';

/**
 * THE ELIMINATOR leaderboard, pinned to the top of /promos so everyone sees it
 * without opening the promo (Richard 2026-07-31). Succeeds BananaDrawBanner.
 *
 * The CUT LINE is the design. Showing the two rows BELOW the survivors is what
 * makes a holder sweat and a challenger push — a clean top-5 has no tension and
 * reads like a finished result rather than a live fight.
 *
 * ⚠️ RULE #0 (see CLAUDE.md — May 27 2026 self-DDoS): this component polls, so
 * the fetch effect lists ONLY stable scalars in its deps. `myWallet` is a
 * string and `onExplain` is stashed in a ref rather than depended on — a
 * Privy-derived callback in the dep array churns identity per render, refires
 * the effect every render, and 403s the whole site behind Vercel DDoS
 * mitigation. Never add a function to these deps.
 */

/**
 * Poll cadence. Slow the rest of the hour, FAST around the burn.
 *
 * A flat 30s meant the clock could hit 0:00 with nothing happening for another
 * half minute — and the burn animation only plays on the poll that catches the
 * change, so a slow poll routinely missed the moment entirely. The board is
 * silent for 59 minutes and then has to be exact for one, so it tightens up as
 * the burn approaches instead of hammering the API all hour
 * (Richard 2026-07-31).
 */
const POLL_IDLE_MS = 30_000;
const POLL_HOT_MS = 2_500;
/** How long before/after a burn to poll hot. */
const HOT_WINDOW_MS = 75_000;

interface Row {
  userId: string;
  name: string;
  bananas: number;
  streak: number;
  onList: boolean;
  rank: number;
  /** Live chance of surviving the next burn, %. */
  odds: number;
}

interface State {
  dayId: string;
  opensAt: number;
  closesAt: number;
  nextBurnAt: number | null;
  status: 'pending' | 'live' | 'closed';
  survivors: Row[];
  contenders: Row[];
  you: (Row & { bananasToSeat: number }) | null;
  all: Row[];
  burnIndex: number;
  revealAt?: number | null;
  saltHash?: string;
  periodNumber?: number;
  seedDigest?: string;
  onListCount: number;
  survivorSlots: number;
  jackhofWinnerId?: string | null;
  winners?: string[];
  lastNight?: {
    dayId: string;
    winnerId: string | null;
    winnerName: string | null;
    finalists: Array<{ userId: string; name: string; bananas: number }>;
  } | null;
}

function useCountdown(target: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (target === null) return '--:--';
  const ms = Math.max(0, target - Date.now());
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function EliminatorBanner({
  myWallet,
  onExplain,
}: {
  myWallet: string | null;
  onExplain?: () => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [expanded, setExpanded] = useState(false);
  /**
   * Burn animation. The API's burnIndex increments the moment a burn executes,
   * so the poll that first sees a higher value plays the sequence:
   *   'igniting'  — the PREVIOUS board is still on screen and the players who
   *                 just got burned ignite and collapse
   *   'revealing' — the new survivors rise in a stagger with their +10
   * `burning` holds the pre-burn rows, because the fresh payload no longer
   * contains the people who were just eliminated — without keeping them there
   * is literally nothing to animate.
   */
  const [phase, setPhase] = useState<'idle' | 'pending' | 'igniting' | 'revealing'>('idle');
  /** Winner reveal is its own beat, five minutes after the final burn. */
  const [winnerShown, setWinnerShown] = useState<string | null>(null);
  const seenWinnerRef = useRef<string | null>(null);
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(true);
  useEffect(() => {
    const m = isEliminatorMuted();
    setMuted(m); mutedRef.current = m;
  }, []);
  const [burning, setBurning] = useState<Row[]>([]);
  const seenBurnRef = useRef<number | null>(null);
  /** Previous payload — burn detection diffs against it outside the updater. */
  const prevRef = useRef<State | null>(null);
  /** Next burn instant, read by the poll scheduler to decide its cadence. */
  const nextBurnRef = useRef<number | null>(null);
  const revealAtRef = useRef<number | null>(null);
  // Ref pattern — see the RULE #0 note above. Keeps the callback out of deps.
  const explainRef = useRef(onExplain);
  explainRef.current = onExplain;

  useEffect(() => {
    let alive = true;
    const timers: number[] = [];

    const load = async () => {
      try {
        const qs = myWallet ? `?wallet=${encodeURIComponent(myWallet)}` : '';
        const res = await fetch(`/api/promos/eliminator${qs}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as State;
        if (!alive) return;

        // ⚠️ Burn detection runs HERE, not inside a setState updater. Updaters
        // must be pure — React invokes them twice in StrictMode, which would
        // schedule the animation timers twice and leave the board flickering
        // between phases. `prevRef` gives us the previous payload without
        // needing the updater's argument.
        const prev = prevRef.current;
        const seen = seenBurnRef.current;
        if (seen === null) {
          // First payload of the session only seeds the marker — never animate
          // a burn the user wasn't here to watch.
          seenBurnRef.current = data.burnIndex;
        } else if (data.burnIndex > seen) {
          seenBurnRef.current = data.burnIndex;
          const gone = (prev?.all ?? []).filter(
            (r) => !data.all.some((n) => n.userId === r.userId),
          );
          if (gone.length === 0) {
            // Burn ran but nothing to animate (e.g. list at or under 5) —
            // drop straight back to idle rather than stranding the header.
            setPhase('idle');
          }
          if (gone.length > 0) {
            setBurning(gone.slice(0, 12));
            setPhase('igniting');
            setExpanded(false);
            if (!mutedRef.current) playBurnSound();
            timers.push(window.setTimeout(() => {
              if (!alive) return;
              setPhase('revealing');
              if (!mutedRef.current) {
                // One chime per survivor, staggered to match the rows rising.
                data.survivors.forEach((_, i) => {
                  timers.push(window.setTimeout(() => {
                    if (alive) playSurvivorChime(i);
                  }, i * 110));
                });
              }
            }, 1100));
            timers.push(window.setTimeout(() => {
              if (!alive) return;
              setPhase('idle');
              setBurning([]);
            }, 3200));
          }
        }

        // BEAT TWO. The seat is drawn ~5 min after the final burn, so watch for
        // jackhofWinnerId appearing and play the reveal — same rule as the burn:
        // only if we were here for it, never as a replay on load.
        if (data.jackhofWinnerId && seenWinnerRef.current === null && prevRef.current !== null
            && !prevRef.current.jackhofWinnerId) {
          seenWinnerRef.current = data.jackhofWinnerId;
          setWinnerShown(data.jackhofWinnerId);
          if (!mutedRef.current) {
            playBurnSound();
            [0, 1, 2, 3, 4].forEach((i) => timers.push(window.setTimeout(
              () => { if (alive) playSurvivorChime(i); }, 400 + i * 130,
            )));
          }
        } else if (data.jackhofWinnerId && seenWinnerRef.current === null) {
          seenWinnerRef.current = data.jackhofWinnerId; // seed, don't animate
        }

        prevRef.current = data;
        nextBurnRef.current = data.nextBurnAt;
        revealAtRef.current = data.revealAt ?? null;
        setState(data);
      } catch { /* transient — the next tick retries */ }
    };

    // Self-rescheduling instead of a fixed interval, so the cadence can change
    // as the burn approaches without tearing down the effect (which would
    // re-run the fetch and reset the burn marker).
    let handle: number;
    const tick = async () => {
      await load();
      if (!alive) return;
      const next = nextBurnRef.current;
      const reveal = revealAtRef.current;
      const dBurn = next === null ? Infinity : Math.abs(next - Date.now());
      // Awaiting the reveal counts as hot too, so the winner lands live.
      const dReveal = reveal === null || seenWinnerRef.current !== null
        ? Infinity
        : Math.abs(reveal - Date.now());
      const delta = Math.min(dBurn, dReveal);
      handle = window.setTimeout(tick, delta <= HOT_WINDOW_MS ? POLL_HOT_MS : POLL_IDLE_MS);
    };
    tick();

    return () => {
      alive = false;
      window.clearTimeout(handle);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [myWallet]); // stable scalar only

  const countdown = useCountdown(state?.nextBurnAt ?? null);

  /**
   * The clock hits 0:00 up to a minute before the server actually burns —
   * Vercel cron granularity is one minute, so a tick scheduled for 7:00 can
   * fire at 7:00:46 (measured: 58.6s and 46.4s on the first two hourly burns).
   * Without this the board sat at zero looking broken while everyone waited.
   * Now it flips to BURNING the instant the countdown expires and holds there
   * until the result lands, so the moment is never dead air.
   */
  // Same trick for BEAT TWO: fire the tick the instant the reveal is due, so
  // the winner lands on the dot instead of whenever the next cron runs.
  useEffect(() => {
    const at = state?.revealAt ?? null;
    if (at === null || state?.jackhofWinnerId) return;
    const fireReveal = () => {
      void fetch('/api/promos/eliminator/tick', { method: 'POST' }).catch(() => {});
    };
    const ms = at - Date.now();
    if (ms <= 0) { fireReveal(); return; }
    const t = window.setTimeout(fireReveal, ms);
    return () => window.clearTimeout(t);
  }, [state?.revealAt, state?.jackhofWinnerId]);

  useEffect(() => {
    const next = state?.nextBurnAt ?? null;
    if (next === null || phase !== 'idle') return;
    // Firing the burn ourselves is what makes it land ON the hour. The endpoint
    // only runs burns whose time has already passed and claims each one in a
    // transaction, so every open board racing to call it produces exactly one
    // burn — and the cron still covers the case where nobody is watching.
    const fire = () => {
      setPhase('pending');
      void fetch('/api/promos/eliminator/tick', { method: 'POST' }).catch(() => {
        /* the cron backstop will catch it */
      });
    };
    const ms = next - Date.now();
    if (ms <= 0) { fire(); return; }
    const t = window.setTimeout(fire, ms);
    return () => window.clearTimeout(t);
  }, [state?.nextBurnAt, phase]);

  // ── RETIRED (2026-08-01) ──────────────────────────────────────────────────
  // The promo ended with its final burn. Every early return below is a
  // has-the-day-started question, and none of them fire for a FINISHED day that
  // still has 41 players on it — so without this the last night's closed board
  // would sit pinned at the top of /promos forever. Placed after every hook so
  // the retirement can't change hook order.
  if (eliminatorRetired()) return null;

  // ── OVERNIGHT (9pm close → 9am open) ──────────────────────────────────────
  // Between the close and the next open we show last night's result plus the
  // fact that the NEW list is already running. Deliberately NOT the live board:
  // today's list is backfilled ahead of the open, and rendering it here is
  // exactly the early leak the `pending` guard below exists to stop. Result +
  // call to action only.
  if (state?.lastNight && state.status === 'pending') {
    const ln = state.lastNight;
    return (
      <div className="rounded-2xl border border-white/10 bg-[#12100e] overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10">
          <span className="text-sm font-black tracking-tight text-white">THE ELIMINATOR</span>
          <span className="ml-auto text-xs font-bold tracking-[0.18em] uppercase text-banana">
            List is open
          </span>
        </div>
        <div className="px-5 py-4">
          {ln.winnerName && (
            <div className="mb-4 rounded-xl border border-jackpot/50 bg-jackpot/[0.08] px-4 py-4 text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-jackpot">
                Last night&rsquo;s JackHOF seat
              </p>
              <p className="mt-1 text-xl font-black tracking-tight text-white">{ln.winnerName}</p>
              <p className="mt-1 text-[11px] text-white/45">
                The other 4 took 2 spins each.
              </p>
            </div>
          )}
          <div className="text-[11px] font-bold tracking-[0.18em] uppercase mb-2 text-white/35">
            Last night&rsquo;s final 5
          </div>
          <div className="space-y-1.5 mb-4">
            {ln.finalists.map((f) => (
              <div
                key={f.userId}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  f.userId === ln.winnerId
                    ? 'bg-jackpot/10 border border-jackpot/40'
                    : 'bg-white/[0.03]'
                }`}
              >
                <span className="font-semibold text-white truncate">{f.name}</span>
                {f.userId === ln.winnerId && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-jackpot">
                    Seat
                  </span>
                )}
                <span className="ml-auto tabular-nums text-white/50">{f.bananas} 🍌</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-banana/30 bg-banana/[0.06] px-4 py-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-banana">
              Tonight&rsquo;s list is already running
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              Draft now — it counts toward the 9am list.
            </p>
            <p className="mt-0.5 text-[11px] text-white/45">
              No need to wait for 9am. Every Banana you earn between now and then is
              already banked, and burns start at 10am.
            </p>
          </div>

          {/* The NEW list, live. Everyone starts at 0 — whoever drafts overnight
              is simply already on it when the first burn comes round at 10am. */}
          <div className="mt-4 text-[11px] font-bold tracking-[0.18em] uppercase mb-2 text-white/35">
            Tonight&rsquo;s list
            {state.all.length > 0 && (
              <span className="ml-2 text-white/25">{state.all.length} on it</span>
            )}
          </div>
          {state.all.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-4 text-center">
              <p className="text-sm font-semibold text-white/70">Nobody on it yet.</p>
              <p className="mt-0.5 text-[11px] text-white/40">
                Enter a draft and you&rsquo;re first on the board.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {state.all.slice(0, 5).map((r, i) => (
                <div
                  key={r.userId}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
                >
                  <span className="w-4 tabular-nums text-white/30">{i + 1}</span>
                  <span className="font-semibold text-white truncate">{r.name}</span>
                  <span className="ml-auto tabular-nums text-white/50">{r.bananas} 🍌</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Self-hide until somebody is actually on the list, so it never renders an
  // empty board — including before launch, while the cron is held.
  if (!state || (state.onListCount === 0 && state.status !== 'closed')) return null;
  // ⚠️ And stay hidden until the day actually OPENS. The list is populated
  // ahead of the open (today's earlier draft entries are backfilled onto it),
  // so the onListCount guard above is NOT enough on its own — without this the
  // full board renders the moment the backfill lands, which is exactly how it
  // leaked ~35 minutes early on launch day (2026-07-31).
  if (state.status === 'pending') return null;

  const urgent = state.nextBurnAt !== null && state.nextBurnAt - Date.now() < 60_000;
  const closed = state.status === 'closed';
  // BEFORE THE FIRST BURN there is no cut and there are no survivors yet.
  // Splitting the board at slot 5 here is wrong twice over: it reads as though
  // a burn has already happened (Boris 2026-08-01, board showed 5 above a CUT
  // LINE at 9am with burnIndex -1), and it tells the top 5 they're safe when
  // survival is a WEIGHTED DRAW, not top-5-by-Bananas — the odds column is the
  // honest version of that. One flat ranked list until burn 0 lands.
  const preBurn = !closed && state.burnIndex < 0;

  return (
    <div
      id="eliminator-board"
      className={`scroll-mt-24 rounded-2xl border border-white/[0.06] bg-white/[0.02] mb-6 overflow-hidden ${
        phase !== 'idle' ? 'elim-heat' : ''
      }`}
    >
      {/* Header — the whole thing is a button into the modal, where the
          mechanic and the rate card already live. */}
      <div className="w-full flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <button
          type="button"
          onClick={() => { primeEliminatorAudio(); explainRef.current?.(); }}
          className="flex items-center gap-2 font-black tracking-tight text-white text-left hover:opacity-80 transition-opacity"
        >
          <span aria-hidden>🔥</span> THE ELIMINATOR
        </button>
        <button
          type="button"
          aria-label={muted ? 'Unmute burn sound' : 'Mute burn sound'}
          onClick={() => {
            const next = !muted;
            setMuted(next); mutedRef.current = next; setEliminatorMuted(next);
            // Unmuting IS the user gesture that unlocks audio — without priming
            // here the first burn after unmuting would still be silent.
            if (!next) primeEliminatorAudio();
          }}
          className="ml-auto mr-3 text-white/30 hover:text-white/70 transition-colors text-sm"
        >
          {muted ? '🔇' : '🔊'}
        </button>
        {closed && !state.jackhofWinnerId ? (
          <span className="text-xs font-bold tracking-[0.18em] uppercase text-[#ef6c37] animate-pulse">
            Drawing the seat…
          </span>
        ) : closed ? (
          <span className="text-xs font-bold tracking-[0.18em] uppercase text-white/40">
            Back at 9am
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase text-white/40">
            {phase === 'pending' || phase === 'igniting' ? (
              <span className="text-[#ef6c37] animate-pulse">Burning now…</span>
            ) : (
              <>
                Burn in
                <span
                  className={`font-mono text-base tracking-normal tabular-nums ${
                    urgent ? 'text-red-500' : 'text-banana'
                  }`}
                >
                  {countdown}
                </span>
              </>
            )}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        {/* BEAT TWO. The five lock at 9:00 and sit there knowing one of them
            has it; the seat lands five minutes later. */}
        {closed && !state.jackhofWinnerId && (
          <div className="mb-4 rounded-xl border border-[#ef6c37]/40 bg-[#17110e] px-4 py-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ef6c37]">
              Burning is done
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              One of these 5 takes the JackHOF seat.
            </p>
            <p className="mt-0.5 text-[11px] text-white/45">
              Your Bananas are your odds. Drawing now…
            </p>
          </div>
        )}
        {closed && state.jackhofWinnerId && (
          <div className={`mb-4 rounded-xl border border-jackpot/50 bg-jackpot/[0.08] px-4 py-4 text-center ${
            winnerShown ? 'elim-rise' : ''
          }`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-jackpot">
              JackHOF seat
            </p>
            <p className="mt-1 text-xl font-black tracking-tight text-white">
              {state.survivors.find((r) => r.userId === state.jackhofWinnerId)?.name ?? 'Winner'}
            </p>
            <p className="mt-1 text-[11px] text-white/45">
              The other 4 take 2 spins each.
            </p>
          </div>
        )}
        {/* The list is ALREADY open — Bananas earned after the 9pm close bank
            straight onto tomorrow's list (dayIdFor rolls at 9pm). Without
            saying so the closed board reads as "come back at 9am", and the
            whole overnight window of drafting gets left on the table. */}
        {closed && (
          <div className="mb-4 rounded-xl border border-banana/30 bg-banana/[0.06] px-4 py-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-banana">
              Tomorrow&rsquo;s list is already open
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              Draft now — it counts toward the 9am list.
            </p>
            <p className="mt-0.5 text-[11px] text-white/45">
              No need to wait. Every Banana you earn tonight is already banked for tomorrow.
            </p>
          </div>
        )}
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase mb-3 transition-colors">
          {phase === 'pending' || phase === 'igniting' ? (
            <span className="text-[#ef6c37]">🔥 Burning…</span>
          ) : (
            <span className="text-white/35">
              {closed ? 'Tonight’s final 5' : state.burnIndex >= 0 ? 'Survivors' : 'On the list'}
            </span>
          )}
        </div>

        {/* Collapsed: the 5 survivors, the cut line, and the two rows under it —
            the cut line is the tension, so it is never hidden.
            Expanded: every player on the list, with the cut line drawn in the
            same place so the board reads identically either way. */}
        {phase === 'igniting' ? (
          /* The players who just got burned, going up in a stagger. Nothing
             else renders — the whole board is the eliminations for one beat. */
          <ul className="space-y-1.5">
            {burning.map((r, i) => (
              <li
                key={r.userId}
                className="elim-ignite"
                style={{ animationDelay: `${i * 55}ms` }}
              >
                <LeaderRow row={r} isYou={!!myWallet && r.userId === myWallet.toLowerCase()} />
              </li>
            ))}
          </ul>
        ) : expanded ? (
          <ul className="space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
            {state.all.map((r, i) => (
              <li key={r.userId}>
                {i === state.survivorSlots && !closed && !preBurn && (
                  <div className="flex items-center gap-3 my-3">
                    <div className="h-px flex-1 bg-white/[0.08]" />
                    <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/25">
                      challengers
                    </span>
                    <div className="h-px flex-1 bg-white/[0.08]" />
                  </div>
                )}
                <LeaderRow
                  row={r}
                  dim={!preBurn && i >= state.survivorSlots}
                  isYou={!!myWallet && r.userId === myWallet.toLowerCase()}
                  isWinner={closed && r.userId === state.jackhofWinnerId}
                />
              </li>
            ))}
          </ul>
        ) : preBurn ? (
          /* No cut, no survivors, no dimming — just the list as it stands.
             Same row count the split view showed (5 + 2) so the card doesn't
             jump in height when the first burn draws the cut line. */
          <ul className="space-y-1.5">
            {state.all.slice(0, state.survivorSlots + 2).map((r) => (
              <li key={r.userId}>
                <LeaderRow row={r} isYou={!!myWallet && r.userId === myWallet.toLowerCase()} />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <ul className="space-y-1.5">
              {state.survivors.map((r, i) => (
                <li
                  key={r.userId}
                  className={phase === 'revealing' ? 'elim-rise relative' : 'relative'}
                  style={phase === 'revealing' ? { animationDelay: `${i * 110}ms` } : undefined}
                >
                  <LeaderRow
                    row={r}
                    isYou={!!myWallet && r.userId === myWallet.toLowerCase()}
                    isWinner={closed && r.userId === state.jackhofWinnerId}
                  />
                  {phase === 'revealing' && (
                    <span
                      className="elim-plus pointer-events-none absolute right-4 -top-1 text-xs font-black text-banana"
                      style={{ animationDelay: `${i * 110 + 260}ms` }}
                    >
                      +{BANANAS_SURVIVE_HOUR}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {!closed && state.contenders.length > 0 && (
              <>
                <div className="flex items-center gap-3 my-3">
                  <div className="h-px flex-1 bg-white/[0.08]" />
                  <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/25">
                    cut line
                  </span>
                  <div className="h-px flex-1 bg-white/[0.08]" />
                </div>
                <ul className="space-y-1.5">
                  {state.contenders.map((r) => (
                    <LeaderRow
                      key={r.userId}
                      row={r}
                      dim
                      isYou={!!myWallet && r.userId === myWallet.toLowerCase()}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {/* Only offer the toggle when there is actually more to see — and never
            mid-burn, when the board is mid-animation. */}
        {phase === 'idle' && state.all.length > state.survivors.length + state.contenders.length && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 w-full rounded-lg border border-white/[0.08] py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors"
          >
            {expanded ? 'Show less' : `Show all ${state.onListCount}`}
          </button>
        )}

        {/* Your own row — pinned regardless of where you sit, with the exact
            gap to a seat. That number is the call to action, not the rank. */}
        {!state.you && (
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <p className="text-sm text-white/60">
              <span className="font-semibold text-white">You&rsquo;re not in yet.</span>{' '}
              Enter any draft to get on the list — it counts the moment the draft fills.
            </p>
          </div>
        )}
        {state.you && !state.you.onList && (
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/70">
                <span className="font-semibold text-white">You</span>
                <span className="text-white/40"> · not on the list</span>
              </span>
              <span className="text-sm font-bold text-banana tabular-nums">🍌 {state.you.bananas}</span>
            </div>
            {/* Being burned is not the end of your day and the board has to say
                so — otherwise it reads as "you're out". Entering puts the spot
                back straight away; you keep every Banana either way. */}
            <p className="mt-1 text-[11px] text-white/40">
              Enter a draft to get back on — you keep every Banana.
            </p>
          </div>
        )}
        {state.you?.onList && (
          <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
            <span className="text-sm text-white/70">
              <span className="font-semibold text-white">You</span>
              <span className="text-white/40"> · #{state.you.rank}</span>
            </span>
            {/* The live number. Every Banana that lands moves it, which is what
                makes drafting mid-hour feel like it did something. */}
            <span className="text-sm text-white/50">
              odds this burn{' '}
              <span className="font-bold text-banana tabular-nums">
                {state.you.odds.toFixed(0)}%
              </span>
            </span>
          </div>
        )}

        {/* Provably fair. The commitment is recorded when the day OPENS —
            before anyone has earned a Banana — so nobody, us included, can
            steer a burn after seeing who's on the list. Shown rather than
            claimed (Richard 2026-07-31). */}
        {state.saltHash && (
          <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
              <span aria-hidden>🔒</span> Provably fair · VRF
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-white/35">
              Every burn is drawn from randomness committed{' '}
              <span className="text-white/55">before the day opened</span>
              {typeof state.periodNumber === 'number' && ` (wheel period ${state.periodNumber})`}
              . Nobody can steer a burn after seeing the list.
            </p>
            <p className="mt-1 font-mono text-[9px] leading-relaxed break-all text-white/25">
              commit {state.saltHash.slice(0, 22)}…{state.saltHash.slice(-6)}
              {state.seedDigest && (
                <>
                  <br />
                  today&rsquo;s seed {state.seedDigest.slice(0, 22)}…{state.seedDigest.slice(-6)}
                </>
              )}
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-[11px] text-white/35">
          <span>
            {state.onListCount} on the list · {state.survivorSlots} survive
          </span>
          <span className="hidden sm:inline">
            paid +{BANANAS_PAID_DRAFT} · free +{BANANAS_FREE_DRAFT} · survive +{BANANAS_SURVIVE_HOUR}
          </span>
        </div>
      </div>
    </div>
  );
}

function LeaderRow({
  row, isYou, dim, isWinner,
}: {
  row: Row; isYou?: boolean; dim?: boolean; isWinner?: boolean;
}) {
  return (
    <li
      className={`flex items-center justify-between rounded-lg px-3 py-2 ${
        isWinner
          ? 'bg-jackpot/10 border border-jackpot/40'
          : isYou
            ? 'bg-banana/[0.07] border border-banana/25'
            : 'bg-white/[0.02] border border-transparent'
      } ${dim ? 'opacity-55' : ''}`}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className="w-4 text-xs font-bold text-white/30 tabular-nums">{row.rank}</span>
        <span className="truncate text-sm font-semibold text-white/90">{row.name}</span>
        {isWinner && (
          <span className="text-[10px] font-black tracking-wider uppercase text-jackpot shrink-0">
            JackHOF
          </span>
        )}
      </span>
      <span className="flex items-center gap-3 shrink-0">
        {row.streak > 0 && (
          <span className="text-[11px] text-white/35 tabular-nums">
            {row.streak} hr{row.streak === 1 ? '' : 's'}
          </span>
        )}
        {row.odds > 0 && (
          <span className="text-[11px] tabular-nums text-white/45" title="Chance of surviving the next burn">
            {row.odds.toFixed(0)}%
          </span>
        )}
        <span className="text-sm font-bold text-banana tabular-nums">🍌 {row.bananas}</span>
      </span>
    </li>
  );
}

export { SURVIVORS_PER_BURN };
