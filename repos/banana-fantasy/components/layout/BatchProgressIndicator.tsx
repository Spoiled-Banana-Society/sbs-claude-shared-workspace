'use client';

import { useEffect, useRef, useState } from 'react';
import { useBatchProgress } from '@/hooks/useBatchProgress';
import type { BatchProgress } from '@/lib/api/leagues';
import { lanePosition, laneDraftsLeft, lanePct, WINDOW_SIZE, HOF_PER_WINDOW, type LaneSnapshot } from '@/lib/rollingLanes';
import { Tooltip } from '../ui/Tooltip';
import { useAuth } from '@/hooks/useAuth';

const HEAT_TRIGGER_PCT = 10; // a live special starts pulsing once ITS odds hit 10%
const HEAT_MAX_PCT = 35;     // …ramping to full intensity by ~35% (a near-lock)
const JP_RED = '#ef4444';
const HOF_GOLD = '#D4AF37';

interface RevealGated {
  filledLeaguesCount: number;   // LIVE — ticks the instant a draft fills (X/100)
  jackpotRemaining: number;     // REVEALED as of now — flips at the slot landing
  hofRemaining: number;         // REVEALED as of now
  revealedFilled: number;       // filled minus not-yet-revealed (drives the %)
  jpPending: boolean;           // a JP hit has filled but its slot hasn't landed
  hofPending: boolean;          // same for a HOF hit
  recentJpHit: boolean;         // a JP reveal landed <8s ago (drives the HIT flash)
  recentHofHit: boolean;        // same for HOF
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
        // Second tick ~8s after the reveal clears the transient HIT flash the
        // rolling-lanes pills show (harmless no-op re-render in legacy mode).
        timers.push(setTimeout(() => tick((t) => t + 1), delay + 8_200));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [data]);

  if (!data) return null;
  const serverNow = Date.now() - offsetRef.current;
  const pending = data.pendingReveals ?? [];
  const notYet = pending.filter((p) => p.atMs > serverNow);
  const jpBack = notYet.reduce((s, p) => s + (p.jp || 0), 0);
  const hofBack = notYet.reduce((s, p) => s + (p.hof || 0), 0);
  const recentlyLanded = (kind: 'jp' | 'hof') =>
    pending.some((p) => (p[kind] || 0) > 0 && p.atMs <= serverNow && serverNow - p.atMs < 8_000);
  return {
    filledLeaguesCount: data.filledLeaguesCount,
    jackpotRemaining: data.jackpotRemaining + jpBack,
    hofRemaining: data.hofRemaining + hofBack,
    revealedFilled: data.filledLeaguesCount - notYet.length,
    jpPending: jpBack > 0,
    hofPending: hofBack > 0,
    recentJpHit: recentlyLanded('jp'),
    recentHofHit: recentlyLanded('hof'),
  };
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
  // Two decimals — MATCHES the X/Discord bot + Go API exactly (they render
  // toFixed(2)), so the header and the bot always read the SAME number (e.g.
  // both "HOF 4.76%") instead of the header rounding to 4.8% while the bot says
  // 4.76%. Still ticks every draft (the reason we moved off whole numbers).
  const fmtPct = (p: number) => `${p.toFixed(2)}%`;
  const jackpotPct = !jackpotHit && rDraftsLeft > 0 ? (jackpotRemaining / rDraftsLeft) * 100 : null;
  const hofPct = !allHofHit && rDraftsLeft > 0 ? (hofRemaining / rDraftsLeft) * 100 : null;

  // ── "Heating up" — a still-live special starts pulsing once ITS OWN live odds
  // reach HEAT_TRIGGER_PCT (10%), then intensifies the higher the % climbs,
  // maxing out around HEAT_MAX_PCT (a near-lock). Driven by each special's own
  // chance-to-hit — so JP and HOF light up INDEPENDENTLY (and both, when both
  // qualify), and more specials still out → higher % → it lights up earlier.
  // jackpotPct/hofPct are already null once that special is hit, so a hit one
  // never pulses. The special's number + label + % scales + glows in place;
  // pulse speed AND glow both ramp with its heat. No pill, no outer box glow.
  // Crossing the trigger must be INSTANTLY visible (Boris 2026-07-16: at 10%
  // the old ramp started from zero — a 1.07x pulse nobody could see). So heat
  // FLOORS at 0.35 the moment odds hit 10%, then ramps to full by ~35%.
  const HEAT_FLOOR = 0.35;
  const heatFor = (pct: number | null): number =>
    pct == null || pct < HEAT_TRIGGER_PCT
      ? 0
      : HEAT_FLOOR + (1 - HEAT_FLOOR) * Math.min(1, (pct - HEAT_TRIGGER_PCT) / (HEAT_MAX_PCT - HEAT_TRIGGER_PCT));
  const jpHeat = heatFor(jackpotPct);
  const hofHeat = heatFor(hofPct);
  const a2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  const heatPulse = (heat: number, color: string): React.CSSProperties | undefined =>
    heat > 0
      ? ({
          animation: `bpHeatPulse ${(1.4 - heat).toFixed(2)}s ease-in-out infinite`,
          ['--bpScale']: (1.06 + heat * 0.17).toFixed(3),
          textShadow: `0 0 ${(3 + heat * 9).toFixed(1)}px ${color}${a2(0.5 + heat * 0.45)}, 0 0 ${(7 + heat * 22).toFixed(1)}px ${color}${a2(0.2 + heat * 0.45)}`,
          willChange: 'transform',
        } as React.CSSProperties)
      : undefined;

  // ── ROLLING WINDOWS (post-cutover) — two independent lanes, equal billing.
  // Activated purely by the payload carrying `lanes` (tracker has
  // RollingStartDraft); until Go writes that field this branch is dead code
  // and the legacy fixed-batch view below renders unchanged. Reveal gating:
  // while a lane's hit is pending its slot landing, we show the lane's `pre`
  // snapshot (the old window), so the counter can't spoil the slot machine;
  // the useRevealGated timers re-render at the exact landing moment.
  if (data.lanes) {
    const lanes = data.lanes;
    const jpView: LaneSnapshot = gated.jpPending && lanes.jp.pre ? lanes.jp.pre : lanes.jp;
    const hofView: LaneSnapshot = gated.hofPending && lanes.hof.pre ? lanes.hof.pre : lanes.hof;
    const jpPos = lanePosition(filledLeaguesCount, jpView.windowStart);
    const hofPos = lanePosition(filledLeaguesCount, hofView.windowStart);
    const jpLanePct = lanePct(jpView.remaining, laneDraftsLeft(rFilled, jpView.windowStart));
    const hofLanePct = lanePct(hofView.remaining, laneDraftsLeft(rFilled, hofView.windowStart));

    const pills = [
      {
        key: 'jp',
        tag: 'JACKPOT',
        mobileTag: 'Jackpot',
        shortTag: 'JP',
        color: JP_RED,
        textCls: 'text-red-400',
        frameCls: 'border-red-500/40 bg-red-500/[0.06]',
        barBg: 'linear-gradient(90deg,#b91c1c,#ef4444)',
        pos: jpPos,
        pct: jpLanePct,
        heat: heatFor(jpLanePct),
        hit: gated.recentJpHit,
        hitDots: null as number | null,
      },
      {
        key: 'hof',
        tag: 'HOF',
        mobileTag: 'HOF',
        shortTag: 'HOF',
        color: HOF_GOLD,
        textCls: 'text-[#e6c35c]',
        frameCls: 'border-[#D4AF37]/40 bg-[#D4AF37]/[0.06]',
        barBg: 'linear-gradient(90deg,#8a6d1f,#D4AF37)',
        pos: hofPos,
        pct: hofLanePct,
        heat: heatFor(hofLanePct),
        hit: gated.recentHofHit,
        hitDots: hofView.hitsInWindow as number | null,
      },
    ];

    return (
      <Tooltip
        content={
          <div className="w-[250px] py-0.5">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-text-primary">Draft #{filledLeaguesCount}</span>
              <span className="text-[10.5px] text-text-muted">rolling windows</span>
            </div>

            {/* Jackpot lane */}
            <div className="mb-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] font-bold text-red-400">JACKPOT · {jpPos}/{WINDOW_SIZE}</span>
                {jpLanePct !== null && <span className="text-[12px] font-semibold tabular-nums text-red-400">{fmtPct(jpLanePct)}</span>}
              </div>
              <p className="text-[10.5px] leading-snug text-text-secondary">
                Guaranteed within the next {WINDOW_SIZE - jpPos} drafts — the window resets every time it hits.
              </p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${jpPos}%`, background: pills[0].barBg }} />
              </div>
            </div>

            {/* HOF lane */}
            <div className="mb-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] font-bold text-[#e6c35c]">HOF · {hofPos}/{WINDOW_SIZE}</span>
                {hofLanePct !== null && <span className="text-[12px] font-semibold tabular-nums text-[#e6c35c]">{fmtPct(hofLanePct)}</span>}
              </div>
              <p className="text-[10.5px] leading-snug text-text-secondary">
                {hofView.hitsInWindow} of {HOF_PER_WINDOW} hit this window — resets after the 5th.
              </p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${hofPos}%`, background: pills[1].barBg }} />
              </div>
            </div>

            {/* What they are + JackHOF */}
            <div className="space-y-1 border-t border-white/[0.08] pt-2.5 text-center">
              <p className="text-[11px]"><span className="font-semibold text-red-400">Jackpot</span><span className="text-text-secondary"> · win your league, skip to finals</span></p>
              <p className="text-[11px]"><span className="font-semibold text-[#e6c35c]">HOF</span><span className="text-text-secondary"> · compete for bonus prizes</span></p>
              <p className="text-[11px]"><span className="font-semibold"><span className="text-red-400">JACK</span><span className="text-[#e6c35c]">HOF</span></span><span className="text-text-secondary"> · both land on one draft — two perks</span></p>
            </div>
            <p className="mt-2 text-center text-[10px] text-text-muted">A Jackpot is always within 100 drafts of the last · 5 HOF per window</p>
          </div>
        }
      >
        <div className="relative flex flex-col items-center gap-[2px] ml-2 mr-1 sm:flex-row sm:gap-1.5 sm:ml-0 md:mr-3 cursor-default">
          {/* Global draft number — always one glance away of the window counters */}
          <div className="flex flex-row items-baseline gap-1 leading-tight sm:flex-col sm:items-center sm:gap-0 sm:px-0.5 sm:pr-2 sm:mr-0.5 sm:border-r sm:border-white/10">
            <span className="text-[7px] sm:text-[8px] font-bold tracking-[0.14em] text-white/40">DRAFT</span>
            <span className="text-[9.5px] sm:text-[13px] font-bold tabular-nums text-white/80">#{filledLeaguesCount}</span>
          </div>

          <div className="flex flex-row gap-1 sm:gap-1.5">
            {pills.map((p) => (
              <div key={p.key}>
                {/* One pill, same design on every screen — mobile is just a
                    tighter cut of the desktop pill (Boris 2026-07-21). */}
                <div className={`flex flex-col gap-[2px] rounded-[8px] sm:rounded-[10px] border px-1.5 sm:px-2.5 py-[2px] sm:py-[5px] min-w-[76px] sm:min-w-[122px] ${p.hit ? 'border-green-400/70 bg-green-400/10' : p.frameCls}`}>
                  <div className="flex items-center gap-1 sm:gap-1.5 leading-none">
                    <span className={`text-[7.5px] sm:text-[10px] font-extrabold tracking-[0.1em] sm:tracking-[0.12em] ${p.textCls}`}>{p.tag}</span>
                    {!p.hit && p.pct !== null && (
                      <span className={`ml-auto text-[9px] sm:text-[11.5px] font-bold tabular-nums ${p.textCls}`}>{fmtPct(p.pct)}</span>
                    )}
                  </div>
                  <div className="leading-none" style={heatPulse(p.heat, p.color)}>
                    {p.hit ? (
                      <span className="text-[10.5px] sm:text-[12px] font-extrabold text-green-400">✓ HIT</span>
                    ) : (
                      <span className="text-[10px] sm:text-[13px] font-extrabold tabular-nums text-white/90">
                        {p.pos}<span className="text-[8px] sm:text-[10.5px] font-medium text-white/40">/{WINDOW_SIZE}</span>
                      </span>
                    )}
                  </div>
                  <div className="h-[2px] sm:h-[2.5px] overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${p.hit ? 100 : p.pos}%`, background: p.hit ? '#4ade80' : p.barBg }} />
                  </div>
                </div>

              </div>
            ))}
          </div>
          <style jsx global>{`@keyframes bpHeatPulse { 0%,100% { transform: scale(1); opacity: .9 } 50% { transform: scale(var(--bpScale, 1.08)); opacity: 1 } }`}</style>
        </div>
      </Tooltip>
    );
  }

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
      <div className="relative flex items-center gap-1.5 mr-1 md:mr-3">
        <div className="relative flex flex-col items-center w-auto min-w-[56px] px-0.5 py-1 cursor-default">
          <span className="text-[13px] sm:text-[16px] font-semibold tabular-nums text-white/75 leading-tight">
            {currentDraft}<span className="text-white/40 font-normal">/{batchEnd}</span>
          </span>
          <div className="flex items-center justify-center gap-[7px] sm:gap-[11px] leading-tight whitespace-nowrap">
            {/* JP: count + live chance-to-hit (% climbs as Pro drafts resolve, gone once hit).
                In the hot window while still live, the whole group pulses + glows red,
                intensifying the closer the batch gets to a guaranteed drop. */}
            <span className="inline-flex items-center gap-[3px]" style={heatPulse(jpHeat, JP_RED)}>
              <span className={`text-[12px] sm:text-[14px] font-bold tabular-nums ${jackpotHit ? 'text-green-400' : 'text-red-400'}`}>
                {jackpotHit ? '\u2713' : jackpotRemaining}
              </span>
              <span className="text-[10px] sm:text-[11px] font-semibold text-white/85">JP</span>
              {jackpotPct !== null && (
                <span className="text-[11px] sm:text-[12px] font-semibold tabular-nums text-red-400">{fmtPct(jackpotPct)}</span>
              )}
            </span>
            <span className="inline-flex items-center gap-[3px]" style={heatPulse(hofHeat, HOF_GOLD)}>
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
        <style jsx global>{`@keyframes bpHeatPulse { 0%,100% { transform: scale(1); opacity: .9 } 50% { transform: scale(var(--bpScale, 1.08)); opacity: 1 } }`}</style>
      </div>
    </Tooltip>
  );
}
