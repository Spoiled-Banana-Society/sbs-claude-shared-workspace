'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { DropPackReveal, type RevealPrize } from '@/components/promos/DropPackReveal';
import { nightlyPrizesFor, winningPacksForNight, spinsForNight, revealNightIdFor } from '@/lib/dropRates';
import { Modal } from '@/components/ui/Modal';
import { JackHofWordmark } from '@/components/ui/JackHofWordmark';

/**
 * THE DROP — the opening room.
 *
 * Packs earned from filled drafts stay sealed until 9pm PT. Here you open them
 * one at a time (the whole point — the slow reveal is the promo) or burn
 * through the stack with OPEN ALL when you have twenty of them.
 *
 * Everything was already decided when the night locked at 9pm, so opening is
 * pure reveal. Nothing here can be raced or retried into a better outcome, and
 * a double-tap is harmless — the server flips `opened` in a transaction.
 *
 * 2026-08-08 revamp (Richard picked from the concept sheet):
 *   • the sealed count is a physical PILE of packs, not a number in a box
 *   • the prize list is the actual tier cards from the reveal
 *   • (REMOVED same night, Boris: the 9pm–midnight live pulls feed — public
 *     winners spoil sealed packs; never reintroduce a winners broadcast)
 *   • the last 60 seconds go red, the pile trembles, LOCKED stamps in at zero
 *   • the previous-nights backlog is a vault of dusty sealed packs
 * (The "your % share of the seat" concept was explicitly rejected — the
 * "1 in N" odds line stays as-is. The morning-after recap shipped and was
 * pulled the same day, also Richard's call — don't reintroduce either.)
 */

type PullKind = 'jackpot' | 'jackhof' | 'hof' | 'spins';

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
  /** Present only between 9pm and midnight — the night you're earning into
   *  while the one above is still being opened. */
  next: { nightId: string; locksAt: number; sealed: number } | null;
  /** Sealed packs from before tonight — nothing auto-opens, so whatever you
   *  didn't rip is still here. Newest first. */
  previous: Array<{ nightId: string; sealed: number }>;
  /** Tonight's wins as they're ripped, newest first. Wins only, never empties. */
  pulls: Array<{ name: string; kind: PullKind; spins?: number; at: string }>;
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

/**
 * The sealed pack, straight from the DropPackReveal design — dark charcoal,
 * striped foil crimp, gold BANANA PACK band on the diagonal. `w` scales the
 * whole thing; 132 is the reference size the proportions were drawn at.
 */
function SealedPack({ w = 112, dusty = false }: { w?: number; dusty?: boolean }) {
  const s = w / 132;
  return (
    <div
      className={`drop-sealed ${dusty ? 'drop-sealed-dusty' : ''}`}
      style={{ width: w, height: Math.round(w * 1.43) }}
    >
      <div className="drop-sealed-crimp" style={{ height: Math.max(12, Math.round(18 * s)) }} />
      <div
        className="absolute left-0 right-0 flex flex-col items-center"
        style={{ top: Math.round(38 * s), gap: Math.round(5 * s) }}
      >
        <Image
          src="/sbs-logo-white-v2.png" alt="" width={36} height={36}
          style={{ width: Math.round(36 * s), height: 'auto' }}
        />
        <span
          className="font-black tracking-[0.2em] text-white/90"
          style={{ fontSize: Math.max(9, Math.round(13 * s)) }}
        >
          SBS
        </span>
      </div>
      <div className="drop-sealed-band" style={{ height: Math.round(28 * s), top: '60%' }}>
        <span style={{ fontSize: Math.max(7, Math.round(11 * s)) }}>Banana Pack</span>
      </div>
      {w >= 108 && (
        <span
          className="absolute left-0 right-0 text-center font-extrabold uppercase tracking-[0.16em] text-white/50"
          style={{ bottom: Math.round(12 * s), fontSize: 7 }}
        >
          1 prize inside
        </span>
      )}
    </div>
  );
}

/** Fan layouts for 1–5 packs. Sides render first so the center sits on top. */
const FANS: Record<number, Array<{ r: number; x: number; y: number }>> = {
  1: [{ r: 0, x: 0, y: 0 }],
  2: [{ r: -7, x: -34, y: 2 }, { r: 7, x: 34, y: 2 }],
  3: [{ r: -10, x: -48, y: 4 }, { r: 10, x: 48, y: 4 }, { r: 0, x: 0, y: 0 }],
  4: [{ r: -14, x: -68, y: 7 }, { r: 14, x: 68, y: 7 }, { r: -5, x: -26, y: 1 }, { r: 5, x: 26, y: 1 }],
  5: [{ r: -14, x: -70, y: 7 }, { r: 14, x: 70, y: 7 }, { r: -7, x: -36, y: 2 }, { r: 7, x: 36, y: 2 }, { r: 0, x: 0, y: 0 }],
};

/**
 * The pile — your stack IS the page. Bobs gently all day, trembles through the
 * final minute, and takes the LOCKED stamp at zero.
 */
function PackPile({ count, shaking, stamped }: { count: number; shaking: boolean; stamped: boolean }) {
  const fan = FANS[Math.min(Math.max(count, 1), 5)];
  const ghost = count === 0;
  return (
    <div className="relative mx-auto" style={{ height: 224, maxWidth: 340 }}>
      {fan.map((f, i) => {
        const center = f.r === 0 && f.x === 0;
        const tf = `rotate(${f.r}deg) translateX(${f.x}px) translateY(${f.y}px)`;
        return (
          <div
            key={i}
            className={`absolute bottom-3 left-1/2 -ml-[56px] ${
              shaking ? 'drop-pile-shake' : center ? 'drop-pile-bob' : ''}`}
            style={{
              ['--tf' as string]: tf,
              transform: tf,
              transformOrigin: '50% 90%',
              opacity: ghost ? 0.35 : 1,
              zIndex: center ? 3 : 1,
              animationDuration: shaking ? `${0.42 + i * 0.05}s` : undefined,
            }}
          >
            <SealedPack w={112} />
          </div>
        );
      })}
      {!ghost && (
        <span
          className="absolute z-[5] rounded-full bg-banana px-3.5 py-1 text-[15px] font-black text-black"
          style={{ top: 2, right: 'calc(50% - 120px)', transform: 'rotate(6deg)' }}
        >
          ×{count}
        </span>
      )}
      {stamped && (
        <span className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center">
          <span className="drop-stamp-in rounded-lg border-[3px] border-banana bg-[#020204]/85 px-6 py-2.5 text-lg font-black uppercase tracking-[0.14em] text-banana">
            Locked · prizes inside
          </span>
        </span>
      )}
    </div>
  );
}

/** Card colours per tier — mirrors TIER in DropPackReveal. */
const CARD_TIER: Record<PullKind, { edge: string; top: string }> = {
  jackhof: { edge: '#ef6c37', top: '#3c1f0e' },
  jackpot: { edge: '#ef4444', top: '#3c0e0e' },
  hof: { edge: '#D4AF37', top: '#3a2f10' },
  spins: { edge: '#22c55e', top: '#12351f' },
};

const CARD_META: Record<PullKind, string> = {
  jackhof: 'Seat in the JackHOF draft',
  jackpot: 'Next Jackpot draft',
  hof: 'Next HOF draft',
  spins: 'Banana Wheel',
};

/** One of tonight's prizes, drawn as the actual card from the reveal. */
function PrizeCard({ kind, label, count }: { kind: PullKind; label: React.ReactNode; count: number }) {
  const t = CARD_TIER[kind];
  return (
    <div
      className="relative flex h-[158px] w-[112px] flex-none flex-col overflow-hidden rounded-xl text-center"
      style={{
        border: `2px solid ${t.edge}`,
        background: `linear-gradient(200deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 34%), linear-gradient(160deg, ${t.top} 0%, #14141c 62%, #0c0c12 100%)`,
      }}
    >
      <span className="absolute right-2 top-2 rounded-full border border-white/15 bg-black/45 px-2 py-0.5 text-[9px] font-extrabold text-white/75">
        ×{count}
      </span>
      <div className="mt-4 flex h-11 items-center justify-center">
        <Image src="/sbs-logo-white-v2.png" alt="" width={30} height={30} className="h-auto w-[30px] opacity-95" />
      </div>
      <div className="px-2 pt-1 text-[12px] font-extrabold uppercase leading-tight tracking-[0.04em] text-white">
        {label}
      </div>
      <div className="px-1.5 pt-1 text-[8px] uppercase tracking-[0.08em] text-white/45">
        {CARD_META[kind]}
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-white/10 px-2 py-1.5 text-[6px] uppercase tracking-[0.1em] text-white/35">
        <span>Banana Pack</span><span>The Drop</span>
      </div>
    </div>
  );
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

  // Before 9pm this counts to tonight's unlock. AFTER the drop it counts to the
  // NEXT one — the page went blank on time once everything was opened, which is
  // the moment you most want people to know when to come back (Richard
  // 2026-08-02: "wheres the cowntdown").
  const countdown = useCountdown(
    state ? (state.status === 'earning' ? state.locksAt : state.next?.locksAt ?? null) : null,
  );

  const status = state?.status;
  const locksAt = state?.locksAt;

  // Re-load right after the countdown crosses zero: the GET self-heals the
  // lock server-side, so this is what flips the page from LOCKED-stamp to the
  // OPEN buttons without anyone refreshing. The 1.8s grace is the stamp's
  // moment on screen.
  useEffect(() => {
    if (status !== 'earning' || !locksAt) return;
    const id = window.setTimeout(() => { void load(); }, Math.max(0, locksAt - Date.now()) + 1800);
    return () => clearTimeout(id);
  }, [status, locksAt, load]);

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

  // The final minute is an event: countdown goes red, the pile trembles, and
  // at zero the LOCKED stamp slams in until the reload flips the state.
  const lockMs = state && state.status === 'earning' ? state.locksAt - Date.now() : null;
  const finalMinute = lockMs !== null && lockMs > 0 && lockMs <= 60_000;
  const justLocked = lockMs !== null && lockMs <= 0;

  const revealId = revealNightIdFor(Date.now());
  const prizeRows = nightlyPrizesFor(revealId);
  const seatRows = prizeRows.filter((r) => r.kind !== 'spins');
  const nightSpins = spinsForNight(revealId);

  const showPile = sealed > 0 || state?.status === 'earning';

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
              🔒 Locked until 9:00 PM PT
            </p>
            <p className={`mt-6 font-mono text-5xl font-black tabular-nums transition-colors duration-300 ${
              finalMinute || justLocked ? 'text-jackpot' : 'text-[#6366f1]'}`}>
              {countdown}
            </p>
            <p className="mt-3 text-sm text-white/40">
              {justLocked
                ? 'The drop is live…'
                : <>Paid draft = <b className="text-white/70">2 packs</b> · Free draft = <b className="text-white/70">1 pack</b></>}
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-white/50">
              {sealed > 0
                ? 'Your packs are ready.'
                : state?.next
                  ? 'All opened — keep filling drafts and your next stack rips at 9:00 PM PT.'
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

        {/* ── Your stack is the hero ─────────────────────────────────
            The pile IS the sealed count — it grows every time a draft fills,
            bobs all day, and shakes through the final minute. */}
        {showPile && (
          <div className="mt-8">
            <PackPile count={sealed} shaking={finalMinute} stamped={justLocked} />
            <p className="mt-2 text-[13px] text-white/50">
              {sealed > 0 ? (
                <>
                  <b className="text-white">{sealed} sealed pack{sealed === 1 ? '' : 's'}</b>
                  {' '}&middot; {state?.status === 'earning' ? 'unlocks tonight at 9:00 PM PT' : 'ready to rip'}
                </>
              ) : (
                <>No packs yet &middot; every draft you fill adds to the pile</>
              )}
            </p>
            {state?.status === 'earning' && (
              <span className="mt-4 inline-flex items-center gap-2 rounded-xl border border-banana/25 bg-banana/[0.06] px-4 py-2 text-[12px] text-white/60">
                Fill another draft → <b className="text-banana">+2 packs</b> land on the pile
              </span>
            )}
          </div>
        )}

        {state && state.packCount > 0 && (
          <p className="mt-4 text-[13px] text-white/40">
            {state.packCount} packs in tonight&rsquo;s drop ·{' '}
            <span className="text-white/70">
              1 in {Math.round(1 / (state.seatOdds || 1))}
            </span>{' '}
            holds the JackHOF seat
          </p>
        )}

        {/* After 9pm the earning night has rolled forward — a draft that fills
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

      {/* Live pulls feed REMOVED (Boris 2026-08-08): broadcasting winners is a
          spoiler — once the seats show up in the feed, everyone still holding
          sealed packs knows theirs are empty and stops opening. Reveals stay
          private to the opener. */}

      {/* ── The vault ────────────────────────────────────────────────
          Nothing auto-opens (Richard 2026-08-03) — packs never expire, and
          that's a flex: the backlog is a vault of dusty sealed packs, not an
          invoice table. */}
      {state && state.previous.length > 0 && (
        <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
            The vault
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-5">
            {state.previous.map((p) => (
              <div key={p.nightId} className="relative text-center">
                <div className="relative">
                  <SealedPack w={96} dusty />
                  <span
                    className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.14] bg-black/60 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em] text-white/70"
                    style={{ top: 8 }}
                  >
                    {formatNight(p.nightId)}
                  </span>
                  <span className="absolute inset-x-0 text-[19px] font-black text-white" style={{ bottom: 42 }}>
                    ×{p.sealed}
                  </span>
                </div>
                <button
                  onClick={() => open(undefined, p.nightId)}
                  disabled={opening}
                  className="mt-2.5 rounded-lg bg-banana px-5 py-1.5 text-[12px] font-black text-black transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  RIP
                </button>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-white/40">
            Sealed packs never expire &middot; rip them any night
          </p>
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

      {/* ── Tonight's prizes, as the actual cards ────────────────────
          Same data as the old gray list, drawn as the tier cards from the
          reveal — this is the loot hiding inside tonight's packs. */}
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

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {seatRows.map((r) => (
            <PrizeCard
              key={r.kind + r.label}
              kind={r.kind}
              count={r.count}
              label={r.kind === 'jackhof' ? <><JackHofWordmark size={12} /> SEAT</> : r.label}
            />
          ))}
          {nightSpins > 0 && (
            <PrizeCard kind="spins" count={nightSpins} label="FREE SPINS" />
          )}
        </div>

        <p className="mt-4 text-center text-[12px] text-white/40">
          These cards are inside tonight&rsquo;s packs&hellip;{' '}
          <b className="text-white/70">somewhere</b>. All guaranteed &middot;{' '}
          {winningPacksForNight(revealId)} packs win &middot; every other pack is empty
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
            <span className="font-semibold text-white/85">9:00 PM PT</span>. Rip them one at a time
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
            9:00 PM, the bigger your share of it.
          </p>
          <p>
            Anything you don&rsquo;t open just waits for you — sealed packs never expire and never
            open themselves. Come back and rip them any night.
          </p>
        </div>
      </Modal>

      {/* Provably fair — the commitment is stamped when the night OPENS, before
          a single pack exists, and every prize is assigned at 9pm before
          anything can be opened. */}
      {state?.saltHash && (
        <div className="mt-10 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
            🔒 Provably fair
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/35">
            Every prize was assigned at 9:00 PM from randomness committed{' '}
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

      <style jsx global>{`
        .drop-sealed{
          position:relative; border-radius:10px; overflow:hidden; flex:none;
          background:linear-gradient(160deg,#22222e 0%,#12121a 55%,#0a0a0f 100%);
          outline:1px solid #33333f; outline-offset:-1px;
        }
        .drop-sealed-crimp{
          position:absolute; top:0; left:0; right:0; border-radius:10px 10px 0 0;
          background:repeating-linear-gradient(90deg,#3a3a46 0 3px,#1a1a24 3px 6px);
        }
        .drop-sealed-band{
          position:absolute; left:-12px; right:-12px;
          display:flex; align-items:center; justify-content:center;
          background:linear-gradient(90deg,#f59e0b,#fbbf24 40%,#fcd34d);
          transform:rotate(-6deg);
        }
        .drop-sealed-band span{
          color:#0a0a0f; font-weight:900; letter-spacing:.08em; text-transform:uppercase;
        }
        .drop-sealed-dusty{filter:brightness(.62) saturate(.75)}
        @keyframes drop-pile-bob-kf{
          0%,100%{transform:var(--tf) translateY(0)}
          50%{transform:var(--tf) translateY(-7px) rotate(-1.2deg)}
        }
        .drop-pile-bob{animation:drop-pile-bob-kf 3.2s ease-in-out infinite}
        @keyframes drop-pile-shake-kf{
          0%,100%{transform:var(--tf)}
          50%{transform:var(--tf) rotate(1.6deg) translateY(-4px)}
        }
        .drop-pile-shake{animation:drop-pile-shake-kf .45s ease-in-out infinite}
        @keyframes drop-stamp-kf{
          from{transform:rotate(-7deg) scale(2.4); opacity:0}
          to{transform:rotate(-7deg) scale(1); opacity:1}
        }
        .drop-stamp-in{animation:drop-stamp-kf .35s cubic-bezier(.2,2.2,.4,1) both}
        @keyframes drop-dot-kf{0%,100%{opacity:1}50%{opacity:.3}}
        .drop-dot{animation:drop-dot-kf 1.2s ease-in-out infinite}
        @keyframes drop-feed-kf{
          from{opacity:0; transform:translateY(-14px)}
          to{opacity:1; transform:none}
        }
        .drop-feed-item{animation:drop-feed-kf .45s cubic-bezier(.2,.7,.25,1) both}
        @media (prefers-reduced-motion: reduce){
          .drop-pile-bob,.drop-pile-shake,.drop-stamp-in,.drop-dot,.drop-feed-item{
            animation:none !important;
          }
        }
      `}</style>
    </main>
  );
}
