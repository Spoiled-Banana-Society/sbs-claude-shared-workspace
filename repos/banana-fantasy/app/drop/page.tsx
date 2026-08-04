'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { DropPackReveal, type RevealPrize } from '@/components/promos/DropPackReveal';
import { nightlyPrizesFor, winningPacksForNight, spinsForNight, revealNightIdFor } from '@/lib/dropRates';
import { Modal } from '@/components/ui/Modal';
import { JackHofWordmark } from '@/components/ui/JackHofWordmark';

/**
 * THE DROP — the opening room.
 *
 * Packs earned from filled drafts stay sealed until 8pm PT. Here you open them
 * one at a time (the whole point — the slow reveal is the promo) or burn
 * through the stack with OPEN ALL when you have twenty of them.
 *
 * Everything was already decided when the night locked at 8pm, so opening is
 * pure reveal. Nothing here can be raced or retried into a better outcome, and
 * a double-tap is harmless — the server flips `opened` in a transaction.
 */

interface DropState {
  nightId: string;
  locksAt: number;
  autoOpensAt: number;
  status: 'earning' | 'locked' | 'settled';
  packCount: number;
  seatOdds: number;
  totalSpins: number;
  poolSize: number;
  saltHash?: string;
  seedDigest?: string;
  you: { sealed: number; opened: number; packIds: string[] } | null;
  /** Present only between 8pm and midnight — the night you're earning into
   *  while the one above is still being opened. */
  next: { nightId: string; locksAt: number; sealed: number } | null;
  /** Sealed packs from before tonight — nothing auto-opens, so whatever you
   *  didn't rip is still here. Newest first. */
  previous: Array<{ nightId: string; sealed: number }>;
}

interface OpenResult {
  packId: string;
  prize: RevealPrize;
}

/** "Aug 2" from a nightId ("2026-08-02"). Nights are PT calendar dates. */
function formatNight(nightId: string): string {
  const [y, m, d] = nightId.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function useCountdown(target: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (target === null) return '--:--:--';
  const ms = Math.max(0, target - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function DropPage() {
  const router = useRouter();
  const { user, isLoggedIn } = useAuth();
  const wallet = user?.walletAddress ?? null;

  const [state, setState] = useState<DropState | null>(null);
  const [opening, setOpening] = useState(false);
  const [queue, setQueue] = useState<OpenResult[]>([]);
  const [reveal, setReveal] = useState<OpenResult | null>(null);
  const [haul, setHaul] = useState<{ spins: number; seat: boolean; jackpotSeat: boolean }>({ spins: 0, seat: false, jackpotSeat: false });
  /** Open-all skips the hold-to-open — holding twenty times is a chore. */
  const [batch, setBatch] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
      const res = await fetch(`/api/promos/drop${qs}`, { cache: 'no-store' });
      if (res.ok) setState(await res.json() as DropState);
    } catch { /* transient */ }
  }, [wallet]);

  useEffect(() => { void load(); }, [load]);

  // Before 8pm this counts to tonight's unlock. AFTER the drop it counts to the
  // NEXT one — the page went blank on time once everything was opened, which is
  // the moment you most want people to know when to come back (Richard
  // 2026-08-02: "wheres the cowntdown").
  const countdown = useCountdown(
    state ? (state.status === 'earning' ? state.locksAt : state.next?.locksAt ?? null) : null,
  );

  /** Open one pack, or everything. `packId` omitted = open all; `nightId`
   *  targets a previous night's backlog instead of tonight. */
  const open = useCallback(async (packId?: string, nightId?: string) => {
    if (!wallet || busyRef.current) return;
    busyRef.current = true;
    setOpening(true);
    try {
      const res = await fetch('/api/promos/drop/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: wallet,
          ...(packId ? { packId } : {}),
          ...(nightId ? { nightId } : {}),
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as {
        opened: OpenResult[]; spins: number; seat: boolean; jackpotSeat?: boolean;
      };
      setHaul((h) => ({
        spins: h.spins + data.spins,
        seat: h.seat || data.seat,
        jackpotSeat: h.jackpotSeat || !!data.jackpotSeat,
      }));
      setBatch(data.opened.length > 1);
      if (data.opened.length === 1) {
        setReveal(data.opened[0]);
      } else if (data.opened.length > 1) {
        // Open-all: reveal them back to back rather than dumping a list —
        // the sequence is the payoff, and a seat buried in a table of twenty
        // rows would be completely lost.
        setReveal(data.opened[0]);
        setQueue(data.opened.slice(1));
      }
      await load();
    } finally {
      busyRef.current = false;
      setOpening(false);
    }
  }, [wallet, load]);

  const onRevealDone = useCallback(() => {
    setQueue((q) => {
      if (q.length === 0) { setReveal(null); return q; }
      setReveal(q[0]);
      return q.slice(1);
    });
  }, []);

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-white/60">Log in to open your packs.</p>
      </main>
    );
  }

  const sealed = state?.you?.sealed ?? 0;
  const canOpen = state?.status !== 'earning' && sealed > 0;

  return (
    <main className="min-h-screen px-6 py-10 max-w-2xl mx-auto">
      <button
        onClick={() => router.push('/promos')}
        className="text-white/40 hover:text-white/70 text-sm mb-8 transition-colors"
      >
        ← Promos
      </button>

      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight text-white">🌙 THE DROP</h1>

        {state?.status === 'earning' ? (
          <>
            {/* The page is reachable all day on purpose — people want to see
                the stack they're building. It just can't be opened yet. */}
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.03] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
              🔒 Locked until 8:00 PM PT
            </p>
            <p className="mt-6 font-mono text-5xl font-black tabular-nums text-[#6366f1]">
              {countdown}
            </p>
            <p className="mt-3 text-sm text-white/40">
              Keep filling drafts — every one you fill adds to tonight&rsquo;s stack.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-white/50">
              {sealed > 0
                ? 'Your packs are ready.'
                : state?.next
                  ? 'All opened — keep filling drafts and your next stack rips at 8:00 PM PT.'
                  : 'All opened. Back tomorrow.'}
            </p>
            {/* Same countdown treatment as the pre-drop state, now pointed at
                the NEXT drop, so the page never goes blank on time. */}
            {countdown && (
              <>
                <p className="mt-6 font-mono text-5xl font-black tabular-nums text-[#6366f1]">
                  {countdown}
                </p>
                <p className="mt-3 text-sm text-white/40">
                  until the next drop — every draft you fill adds to that stack.
                </p>
              </>
            )}
          </>
        )}

        <div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-4">
          <span className="text-4xl font-black tabular-nums text-white">{sealed}</span>
          <span className="text-left text-sm leading-tight text-white/50">
            sealed<br />pack{sealed === 1 ? '' : 's'}
          </span>
        </div>

        {state && state.packCount > 0 && (
          <p className="mt-4 text-[13px] text-white/40">
            {state.packCount} packs in tonight&rsquo;s drop ·{' '}
            <span className="text-white/70">
              1 in {Math.round(1 / (state.seatOdds || 1))}
            </span>{' '}
            holds the JackHOF seat
          </p>
        )}

        {/* After 8pm the earning night has rolled forward — a draft that fills
            now banks packs for TOMORROW. Show them, or they're invisible until
            the next day (Richard 2026-08-02). */}
        {state?.next && (
          <div className="mt-6 inline-flex items-center gap-3 rounded-xl border border-banana/25 bg-banana/[0.06] px-5 py-3">
            <span className="text-2xl font-black tabular-nums text-banana">{state.next.sealed}</span>
            <span className="text-left text-[12px] leading-tight text-white/55">
              {state.next.sealed === 1 ? 'pack' : 'packs'} banked for<br />
              <span className="font-semibold text-white/75">tomorrow&rsquo;s drop</span>
            </span>
          </div>
        )}
      </div>

      {canOpen && (
        <div className="mt-10 flex flex-col gap-3">
          <button
            onClick={() => open(state?.you?.packIds[0])}
            disabled={opening}
            className="w-full rounded-2xl bg-banana py-5 text-lg font-black text-black transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            OPEN ONE
          </button>
          {sealed > 1 && (
            <button
              onClick={() => open()}
              disabled={opening}
              className="w-full rounded-2xl border border-white/[0.12] py-4 font-bold text-white/80 transition-colors hover:bg-white/[0.04] disabled:opacity-50"
            >
              Open all {sealed}
            </button>
          )}
        </div>
      )}

      {/* ── Previous nights ──────────────────────────────────────────
          Nothing auto-opens anymore (Richard 2026-08-03) — whatever a player
          didn't rip is still sealed under its own night, openable any time,
          even while tonight is still counting down. */}
      {state && state.previous.length > 0 && (
        <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
            Still sealed from previous nights
          </p>
          <ul className="mt-4 space-y-2">
            {state.previous.map((p) => (
              <li key={p.nightId} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-4 py-2.5">
                <span className="text-sm text-white/70">
                  <span className="font-bold text-white/85">{formatNight(p.nightId)}</span>
                  {' '}&middot; {p.sealed} pack{p.sealed === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => open(undefined, p.nightId)}
                  disabled={opening}
                  className="rounded-lg bg-banana px-4 py-1.5 text-[13px] font-black text-black transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  OPEN
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(haul.spins > 0 || haul.seat || haul.jackpotSeat) && (
        <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-center">
          {/* "Your", not "Tonight's" — backlog opens land here too. */}
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
            Your haul
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {haul.seat && <span><JackHofWordmark size={24} /> SEAT · </span>}
            {haul.jackpotSeat && <span className="text-jackpot">JACKPOT SEAT · </span>}
            {haul.spins} spin{haul.spins === 1 ? '' : 's'}
          </p>
        </div>
      )}

      {/* ── Tonight's prizes ─────────────────────────────────────────
          The page showed a countdown and a pack count and never once said
          what you were playing for (Richard 2026-08-02). */}
      <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
            Tonight&rsquo;s prizes — all guaranteed
          </p>
          <button
            onClick={() => setShowHow((v) => !v)}
            aria-label="How it works"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 text-[11px] font-bold text-white/50 transition-colors hover:border-white/50 hover:text-white"
          >
            i
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {nightlyPrizesFor(revealNightIdFor(Date.now())).map((p) => (
            <li key={p.label} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-4 py-2.5">
              <span className={`text-sm font-bold ${
                p.kind === 'jackpot' ? 'text-jackpot'
                  : p.kind === 'hof' ? 'text-hof' : 'text-white/85'}`}>
                {p.kind === 'jackhof'
                  ? <><JackHofWordmark size={14} /> SEAT</>
                  : p.label}
              </span>
              <span className="text-[13px] text-white/40">
                {p.count} pack{p.count === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-center text-[12px] text-white/40">
          {winningPacksForNight(revealNightIdFor(Date.now()))} packs win &middot; {spinsForNight(revealNightIdFor(Date.now()))} spins total &middot; every other pack is empty
        </p>

      </div>

      {/* ⚠️ This was an inline expander under the prize list, which on a phone
          opens BELOW the fold — you tap ⓘ and the page looks unchanged
          (Richard 2026-08-02: "im clicking i and nothing popping up"). A modal
          is visible no matter where the page is scrolled. */}
      <Modal isOpen={showHow} onClose={() => setShowHow(false)} title="How THE DROP works" size="md">
        <div className="space-y-3 text-[13px] leading-relaxed text-white/60">
          <p>
            Every draft you <span className="font-semibold text-white/85">fill</span> earns sealed
            packs — <span className="font-semibold text-white/85">2</span> for a paid draft,{' '}
            <span className="font-semibold text-white/85">1</span> for a free one. Buying a pass
            earns nothing; the packs are for playing.
          </p>
          <p>
            They stay sealed all day and unlock at{' '}
            <span className="font-semibold text-white/85">8:00 PM PT</span>. Rip them one at a time
            or open the whole stack at once.
          </p>
          <p>
            Gold in the tear means you hit something — but not what. The card stops face-down and
            waits for <span className="font-semibold text-white/85">you</span> to flip it.
          </p>
          {/* Built from tonight's ACTUAL pool so a one-night boost (extra
              Jackpot seat, more spins) reads correctly here too. */}
          <p>
            Tonight{' '}
            {nightlyPrizesFor(revealNightIdFor(Date.now()))
              .filter((p) => p.kind !== 'spins')
              .map((p, i) => (
                <React.Fragment key={p.kind}>
                  {i > 0 && ', '}
                  {p.kind === 'jackhof'
                    ? <span className="font-semibold">{p.count} <JackHofWordmark size={13} /> seat{p.count === 1 ? '' : 's'}</span>
                    : <span className={`font-semibold ${p.kind === 'jackpot' ? 'text-jackpot' : 'text-hof'}`}>{p.count} {p.kind === 'jackpot' ? 'Jackpot' : 'HOF'} seat{p.count === 1 ? '' : 's'}</span>}
                </React.Fragment>
              ))}{' '}
            and <span className="font-semibold text-white/85">
              {spinsForNight(revealNightIdFor(Date.now()))} free spins
            </span> go out — guaranteed, no matter how many packs are in play. The JackHOF seat
            lands in exactly one pack out of every pack earned that day, so the more you hold at
            8:00 PM, the bigger your share of it.
          </p>
          <p>
            Anything you don&rsquo;t open just waits for you — sealed packs never expire and never
            open themselves. Come back and rip them any night.
          </p>
        </div>
      </Modal>

      {/* Provably fair — the commitment is stamped when the night OPENS, before
          a single pack exists, and every prize is assigned at 8pm before
          anything can be opened. */}
      {state?.saltHash && (
        <div className="mt-10 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
            🔒 Provably fair
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/35">
            Every prize was assigned at 8:00 PM from randomness committed{' '}
            <span className="text-white/55">before the night began</span>. Opening only
            reveals what was already decided.
          </p>
          <p className="mt-1 break-all font-mono text-[9px] text-white/25">
            {state.saltHash.slice(0, 26)}…{state.saltHash.slice(-6)}
          </p>
        </div>
      )}

      {reveal && (
        <DropPackReveal
          prize={reveal.prize}
          remaining={queue.length}
          autoOpen={batch}
          onDone={onRevealDone}
        />
      )}
    </main>
  );
}
