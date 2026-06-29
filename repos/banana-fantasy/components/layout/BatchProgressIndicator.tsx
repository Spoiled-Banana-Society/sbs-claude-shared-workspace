'use client';

import { useBatchProgress } from '@/hooks/useBatchProgress';
import { Tooltip } from '../ui/Tooltip';
import { useAuth } from '@/hooks/useAuth';

const HOT_WINDOW = 20;       // heat starts when ≤ 20 drafts left this batch
const JP_RED = '#ef4444';
const HOF_GOLD = '#D4AF37';

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

  if (!isLoggedIn || !data) return null;

  const { jackpotRemaining, hofRemaining, filledLeaguesCount } = data;
  const currentDraft = filledLeaguesCount;
  const batchEnd = filledLeaguesCount === 0 ? 100 : Math.ceil(filledLeaguesCount / 100) * 100;
  const jackpotHit = jackpotRemaining <= 0;
  const allHofHit = hofRemaining <= 0;
  const draftsLeft = batchEnd - currentDraft;

  // Live chance-to-hit = remaining specials ÷ slots left in the 100-batch — the
  // SAME formula the X/Discord bot + Go API (ReturnBatchProgress) use, so the
  // dashboard always matches them. Derived from the exact values that drive the
  // JP/HOF counts above, so the % moves ONLY when a draft's TYPE is determined
  // (the count deduct), in lockstep with it — never on a partial fill. null once
  // that special is hit (so it shows nothing instead of "0%").
  const fmtPct = (p: number) => (p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`);
  const jackpotPct = !jackpotHit && draftsLeft > 0 ? (jackpotRemaining / draftsLeft) * 100 : null;
  const hofPct = !allHofHit && draftsLeft > 0 ? (hofRemaining / draftsLeft) * 100 : null;

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
              {jackpotPct !== null && <span className="text-[10px] tabular-nums text-red-400/85">{fmtPct(jackpotPct)} shot</span>}
            </span>
            <span className="flex flex-col items-center gap-0.5">
              <span className="flex items-center gap-1.5">
                <span className={`text-base font-bold tabular-nums ${allHofHit ? 'text-green-400' : 'text-banana'}`}>{allHofHit ? '✓' : hofRemaining}</span>
                <span className="text-[11px] font-medium text-text-secondary">{allHofHit ? 'HOF hit' : 'HOF left'}</span>
              </span>
              {hofPct !== null && <span className="text-[10px] tabular-nums text-banana/85">{fmtPct(hofPct)} shot</span>}
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
      <div className="relative flex items-center gap-1.5 mr-2 md:mr-0">
        {hot && (
          <div className="pointer-events-none absolute -inset-1 rounded-2xl" style={{ background: haloBg, boxShadow: haloShadow }} />
        )}
        <div className="relative flex flex-col items-center w-auto min-w-[56px] px-0.5 py-1 cursor-default">
          <span className="text-[13px] sm:text-[16px] font-semibold tabular-nums text-white/75 leading-tight">
            {currentDraft}<span className="text-white/40 font-normal">/{batchEnd}</span>
          </span>
          <div className="flex items-center justify-center gap-[5px] sm:gap-[8px] leading-tight whitespace-nowrap">
            {/* JP: count + live chance-to-hit (% climbs as Pro drafts resolve, gone once hit) */}
            <span className="inline-flex items-center gap-[2px]">
              <span className={`text-[10px] sm:text-[12px] font-bold tabular-nums ${jackpotHit ? 'text-green-400' : 'text-red-400'}`}>
                {jackpotHit ? '\u2713' : jackpotRemaining}
              </span>
              <span className="text-[8px] sm:text-[9px] font-semibold text-white/50">JP</span>
              {jackpotPct !== null && (
                <span className="text-[8px] sm:text-[9px] font-medium tabular-nums text-white/75">{fmtPct(jackpotPct)}</span>
              )}
            </span>
            <span className="inline-flex items-center gap-[2px]">
              <span className={`text-[10px] sm:text-[12px] font-bold tabular-nums ${allHofHit ? 'text-green-400' : 'text-banana'}`}>
                {allHofHit ? '\u2713' : hofRemaining}
              </span>
              <span className="text-[8px] sm:text-[9px] font-semibold text-white/50">HOF</span>
              {hofPct !== null && (
                <span className="text-[8px] sm:text-[9px] font-medium tabular-nums text-white/75">{fmtPct(hofPct)}</span>
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
