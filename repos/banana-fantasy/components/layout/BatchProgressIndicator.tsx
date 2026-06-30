'use client';

import { useEffect, useRef, useState } from 'react';
import { useBatchProgress } from '@/hooks/useBatchProgress';
import type { BatchProgress } from '@/lib/api/leagues';
import { Tooltip } from '../ui/Tooltip';
import { useAuth } from '@/hooks/useAuth';

const HOT_WINDOW = 20;       // heat starts when ≤ 20 drafts left this batch
const JP_RED = '#ef4444';
const HOF_GOLD = '#D4AF37';

interface RevealGated {
  filledLeaguesCount: number;   // LIVE — ticks the instant a draft fills (X/100)
  jackpotRemaining: number;     // REVEALED as of now — flips at the slot landing
  hofRemaining: number;         // REVEALED as of now
  revealedFilled: number;       // filled minus not-yet-revealed (drives the %)
}

/**
 * Reveal-time gating. X/100 tracks the live fill, but the JP/HOF count + the %
 * are held until each draft's slot machine actually lands its type
 * (DraftStartTime-39s = fill+21s), using the absolute reveal times the server
 * sends in `pendingReveals`. Because those times live in shared state and are
 * recomputed on every (re)connect, this is REFRESH-PROOF — a reload re-derives
 * the identical reveal moment, so a Jackpot/HOF can never show as hit early. It
 * also stays correct under back-to-back fills (each has its own reveal time).
 *
 * `serverNowMs` corrects for client clock skew. We re-render exactly at each
 * pending reveal so the count/% flip in lockstep with the slot. Display-only.
 */
function useRevealGated(data: BatchProgress | null): RevealGated | null {
  const [, tick] = useState(0);
  const offsetRef = useRef(0); // clientNow - serverNow, to defeat clock skew

  useEffect(() => {
    if (!data) return;
    if (typeof data.serverNowMs === 'number') offsetRef.current = Date.now() - data.serverNowMs;
    const pending = data.pendingReveals ?? [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const p of pending) {
      // +40ms so we re-render a hair AFTER the slot lands, never before.
      const delay = (p.atMs + offsetRef.current) - Date.now() + 40;
      if (delay > 0 && delay < 130_000) {
        const reveal = p;
        timers.push(setTimeout(() => {
          // Proof-of-timing log: records that the header actually flipped this
          // reveal, and how close the flip landed to the intended fill+21s
          // moment (driftMs should be ~+40ms). Lets us verify, from logs, that
          // the count/% moved at the slot reveal — not at fill. Display-only.
          void import('@/lib/clientLog').then((m) => m.clientLog('jphof-reveal', 'BatchProgress.flip', {
            revealAtMs: reveal.atMs,
            firedAtMs: Date.now(),
            driftMs: Date.now() - (reveal.atMs + offsetRef.current),
            kind: reveal.jp ? 'jackpot' : reveal.hof ? 'hof' : 'pro',
          })).catch(() => {});
          tick((t) => t + 1);
        }, delay));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [data]);

  if (!data) return null;
  const serverNow = Date.now() - offsetRef.current;
  const notYet = (data.pendingReveals ?? []).filter((p) => p.atMs > serverNow);
  const jpBack = notYet.reduce((s, p) => s + (p.jp || 0), 0);
  const hofBack = notYet.reduce((s, p) => s + (p.hof || 0), 0);
  return {
    filledLeaguesCount: data.filledLeaguesCount,
    jackpotRemaining: data.jackpotRemaining + jpBack,
    hofRemaining: data.hofRemaining + hofBack,
    revealedFilled: data.filledLeaguesCount - notYet.length,
  };
}

// Our own bolt glyph (no fire emoji). Solid for one color, red→gold gradient
// when both Jackpot and HOF are still live.
function BoltIcon({ a, b }: { a: string; b: string }) {
  const mix = a !== b;
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      {mix && (
        <defs>
          <linearGradient id="bpHeatBolt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={a} /><stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>
      )}
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" fill={mix ? 'url(#bpHeatBolt)' : a} />
    </svg>
  );
}

export function BatchProgressIndicator() {
  const { isLoggedIn } = useAuth();
  const { data } = useBatchProgress();
  // Reveal-gated view: X/100 live at fill; JP/HOF count + odds held until each
  // draft's slot machine lands (refresh-proof, server-anchored reveal times).
  const gated = useRevealGated(data);

  if (!isLoggedIn || !data || !gated) return null;

  // ── LIVE (updates the instant a draft fills): the league number X/100 + the
  // batch-fullness heat. Driven straight off the SSE push.
  const filledLeaguesCount = gated.filledLeaguesCount;
  const currentDraft = filledLeaguesCount;
  const batchEnd = filledLeaguesCount === 0 ? 100 : Math.ceil(filledLeaguesCount / 100) * 100;
  const draftsLeft = batchEnd - currentDraft;

  // ── REVEALED (lands with the slot machine): JP/HOF counts + odds + hit ✓.
  // Both the numerator (remaining) AND the denominator (slots left) come from
  // the reveal-gated values, so the % only moves at the reveal — never on a bare
  // fill — and a refresh can't reveal a special early.
  const jackpotRemaining = gated.jackpotRemaining;
  const hofRemaining = gated.hofRemaining;
  const rFilled = gated.revealedFilled;
  const rBatchEnd = rFilled === 0 ? 100 : Math.ceil(rFilled / 100) * 100;
  const rDraftsLeft = rBatchEnd - rFilled;
  const jackpotHit = jackpotRemaining <= 0;
  const allHofHit = hofRemaining <= 0;

  // Live chance-to-hit = remaining specials ÷ slots left in the 100-batch — the
  // SAME formula the X/Discord bot + Go API (ReturnBatchProgress) use, so the
  // dashboard always matches them. Computed off the REVEALED snapshot, so the %
  // moves ONLY when a draft's TYPE is revealed by the slot (the count deduct),
  // in lockstep with it — never on a bare fill. null once that special is hit
  // (so it shows nothing instead of "0%").
  const fmtPct = (p: number) => (p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`);
  const jackpotPct = !jackpotHit && rDraftsLeft > 0 ? (jackpotRemaining / rDraftsLeft) * 100 : null;
  const hofPct = !allHofHit && rDraftsLeft > 0 ? (hofRemaining / rDraftsLeft) * 100 : null;

  // ── "Heating up" — in the last 20 drafts of a batch, while a Jackpot and/or
  // HOF is STILL unclaimed, the counter glows so users know the odds are
  // climbing and it's time to draft. Color follows WHAT'S LEFT: red (JP only),
  // gold (HOF only), red→gold blend (both). Driven live by the batch poll.
  const jLive = !jackpotHit, hLive = !allHofHit;
  const accent = (jLive && hLive) ? { kind: 'mix' as const, a: JP_RED, b: HOF_GOLD }
    : jLive ? { kind: 'one' as const, a: JP_RED, b: JP_RED }
    : hLive ? { kind: 'one' as const, a: HOF_GOLD, b: HOF_GOLD }
    : null;
  const heat = (accent && draftsLeft <= HOT_WINDOW)
    ? Math.min(1, Math.max(0, (HOT_WINDOW - draftsLeft) / HOT_WINDOW)) : 0;
  const hot = heat > 0 && !!accent;
  const a2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  const haloBg = !accent ? undefined : accent.kind === 'mix'
    ? `radial-gradient(circle at 28% 50%, ${accent.a}${a2(0.10 + heat * 0.26)}, transparent 60%), radial-gradient(circle at 72% 50%, ${accent.b}${a2(0.10 + heat * 0.26)}, transparent 60%)`
    : `radial-gradient(circle at 50% 50%, ${accent.a}${a2(0.12 + heat * 0.28)}, transparent 65%)`;
  const haloShadow = !accent ? undefined : accent.kind === 'mix'
    ? `-6px 0 ${10 + heat * 22}px ${heat * 3}px ${accent.a}66, 6px 0 ${10 + heat * 22}px ${heat * 3}px ${accent.b}66`
    : `0 0 ${10 + heat * 26}px ${heat * 5}px ${accent.a}55`;

  return (
    <Tooltip
      content={
        <div className="w-[240px] py-0.5">
          {/* Where this batch is */}
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-text-primary">Draft {currentDraft} of {batchEnd}</span>
            <span className="text-[11px] tabular-nums text-text-muted">{draftsLeft} left</span>
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white/45"
              style={{ width: `${Math.min(100, Math.max(0, ((currentDraft - (batchEnd - 100)) / 100) * 100))}%` }}
            />
          </div>

          {/* Specials still to drop this batch (the live hook) + live chance-to-hit */}
          <div className="mb-3 flex items-start justify-center gap-6">
            <span className="flex flex-col items-center gap-0.5">
              <span className="flex items-center gap-1.5">
                <span className={`text-base font-bold tabular-nums ${jackpotHit ? 'text-green-400' : 'text-red-400'}`}>{jackpotHit ? '✓' : jackpotRemaining}</span>
                <span className="text-[11px] font-medium text-text-secondary">{jackpotHit ? 'Jackpot hit' : 'Jackpot left'}</span>
              </span>
              {jackpotPct !== null && <span className="text-[13px] font-semibold tabular-nums text-red-400">{fmtPct(jackpotPct)}</span>}
            </span>
            <span className="flex flex-col items-center gap-0.5">
              <span className="flex items-center gap-1.5">
                <span className={`text-base font-bold tabular-nums ${allHofHit ? 'text-green-400' : 'text-banana'}`}>{allHofHit ? '✓' : hofRemaining}</span>
                <span className="text-[11px] font-medium text-text-secondary">{allHofHit ? 'HOF hit' : 'HOF left'}</span>
              </span>
              {hofPct !== null && <span className="text-[13px] font-semibold tabular-nums text-banana">{fmtPct(hofPct)}</span>}
            </span>
          </div>

          {/* What they are — one line each */}
          <div className="space-y-1 border-t border-white/[0.08] pt-2.5 text-center">
            <p className="text-[11.5px]"><span className="font-semibold text-red-400">Jackpot</span><span className="text-text-secondary"> · win your league, skip to finals</span></p>
            <p className="text-[11.5px]"><span className="font-semibold text-banana">HOF</span><span className="text-text-secondary"> · compete for bonus prizes</span></p>
          </div>
          <p className="mt-2 text-center text-[10.5px] text-text-muted">1 Jackpot + 5 HOF guaranteed every 100 drafts</p>
        </div>
      }
    >
      <div className="relative flex items-center gap-1.5 mr-1 md:mr-4">
        {hot && (
          <div className="pointer-events-none absolute -inset-1 rounded-2xl" style={{ background: haloBg, boxShadow: haloShadow }} />
        )}
        <div className="relative flex flex-col items-center w-auto min-w-[56px] px-0.5 py-1 cursor-default">
          <span className="text-[13px] sm:text-[16px] font-semibold tabular-nums text-white/75 leading-tight">
            {currentDraft}<span className="text-white/40 font-normal">/{batchEnd}</span>
          </span>
          <div className="flex items-center justify-center gap-[7px] sm:gap-[11px] leading-tight whitespace-nowrap">
            {/* JP: count + live chance-to-hit (% climbs as Pro drafts resolve, gone once hit) */}
            <span className="inline-flex items-center gap-[3px]">
              <span className={`text-[12px] sm:text-[14px] font-bold tabular-nums ${jackpotHit ? 'text-green-400' : 'text-red-400'}`}>
                {jackpotHit ? '\u2713' : jackpotRemaining}
              </span>
              <span className="text-[10px] sm:text-[11px] font-semibold text-white/85">JP</span>
              {jackpotPct !== null && (
                <span className="text-[11px] sm:text-[12px] font-semibold tabular-nums text-red-400">{fmtPct(jackpotPct)}</span>
              )}
            </span>
            <span className="inline-flex items-center gap-[3px]">
              <span className={`text-[12px] sm:text-[14px] font-bold tabular-nums ${allHofHit ? 'text-green-400' : 'text-banana'}`}>
                {allHofHit ? '\u2713' : hofRemaining}
              </span>
              <span className="text-[10px] sm:text-[11px] font-semibold text-white/85">HOF</span>
              {hofPct !== null && (
                <span className="text-[11px] sm:text-[12px] font-semibold tabular-nums text-banana">{fmtPct(hofPct)}</span>
              )}
            </span>
          </div>
        </div>

        {/* "N left" heat pill \u2014 only in the hot window, colored by what's live */}
        {hot && accent && (
          accent.kind === 'mix' ? (
            <span className="relative inline-block shrink-0 rounded-full p-px" style={{ background: `linear-gradient(90deg, ${accent.a}, ${accent.b})`, animation: `bpHeatPulse ${1.3 - heat}s ease-in-out infinite` }}>
              <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: '#0b0c10' }}>
                <BoltIcon a={accent.a} b={accent.b} />
                <span style={{ backgroundImage: `linear-gradient(90deg, ${accent.a}, ${accent.b})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{draftsLeft} left</span>
              </span>
            </span>
          ) : (
            <span className="relative inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold" style={{ color: accent.a, borderColor: `${accent.a}66`, background: `${accent.a}1A`, animation: `bpHeatPulse ${1.3 - heat}s ease-in-out infinite` }}>
              <BoltIcon a={accent.a} b={accent.b} />{draftsLeft} left
            </span>
          )
        )}
        <style jsx global>{`@keyframes bpHeatPulse { 0%,100% { transform: scale(1); opacity: .92 } 50% { transform: scale(1.06); opacity: 1 } }`}</style>
      </div>
    </Tooltip>
  );
}
