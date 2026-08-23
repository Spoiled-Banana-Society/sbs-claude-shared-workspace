'use client';

// Banana Zone SPOTLIGHT — the featured card on /promos (Boris 2026-08-23,
// signed off from the interactive mock). Layout, top to bottom:
//
//   FREE SPINS / BANANA ZONE          [● LIVE · DRAFT N OF THE WINDOW]
//   one-paragraph story (final copy, tier ranges spelled out)
//   ┌──────────────────┬──────────────────────────────┐
//   │  17              │  YOUR FILLS                  │
//   │  DRAFTS LEFT AT  │  🍌 🍌 ◌   1 more = Free Spin│
//   │  BUY 3 GET 1     │  [CLAIM SPIN] when claimable │
//   └──────────────────┴──────────────────────────────┘
//   [BUY 1 GET 1] [BUY 2 GET 1] [● LIVE BUY 3 GET 1]   ← fire on the live one
//
// Real-time: the window view (tier / position / drafts left) rides the SAME
// SSE stream as the header pills (useBatchProgress → data.bonusZone), so this
// card moves the moment any draft's reveal lands — every page, no polling.
// The user's own units/claimable ride /api/promos, which usePromos refetches
// on every user-event stream ping (their fill, their credit) and on focus.
// CLAIM goes through the page's standard onClaim → claimPromo → the same
// ClaimSuccessModal confetti celebration every other promo uses.

import React from 'react';
import type { Promo } from '@/types';
import { useBatchProgress } from '@/hooks/useBatchProgress';
import { promoHueStyle } from '@/lib/promoTheme';

const STORY = (
  <>
    <p className="text-[14.5px] leading-[1.55] text-white/90">
      Jackpot just hit? Enter the Banana Zone — every paid draft you enter earns Free Spins.
    </p>
    <div className="mt-2.5 max-w-[340px] divide-y divide-white/10">
      {[
        ['Buy 1 Get 1 Spin', 'Drafts 1–20'],
        ['Buy 2 Get 1 Spin', 'Drafts 21–40'],
        ['Buy 3 Get 1 Spin', 'Drafts 41–60'],
      ].map(([deal, range]) => (
        <div key={deal} className="flex items-baseline justify-between gap-4 py-[5px] text-[14px] leading-[1.35]">
          <b className="text-white font-bold">{deal}</b>
          <span className="text-white/60 text-[12.5px] font-semibold tracking-[.4px] whitespace-nowrap">{range}</span>
        </div>
      ))}
    </div>
  </>
);

/** Units of a spin one paid fill banks at each tier (spin = 6 units). */
const UNITS = 6;
const creditFor = (tier: 1 | 2 | 3) => (tier === 1 ? 6 : tier === 2 ? 3 : 2);

export interface BananaZoneSpotlightProps {
  promo: Promo;
  hasVisibleClaim: boolean;
  onClaim: () => void;
  onOpenModal: () => void;
}

export function BananaZoneSpotlight({ promo, hasVisibleClaim, onClaim, onOpenModal }: BananaZoneSpotlightProps) {
  const bz = promo.modalContent?.bonusZone;
  const { data } = useBatchProgress();
  // Live view from the global stream; the /api/promos snapshot is the
  // first-paint fallback so the card never renders empty.
  const live = data?.bonusZone;
  // "Closed" is only ever asserted from REAL data (tier === null in an actual
  // view). Before the stream's first push with no snapshot, we show a neutral
  // syncing state — the card must never claim the zone is closed while it's
  // actually live.
  const hasView = Boolean(live || bz);
  const tier = (live ? live.tier : bz?.tier) ?? null;
  const draftsLeftInTier = (live ? live.draftsLeftInTier : bz?.draftsLeftInTier) ?? 0;
  const label = tier ? `Buy ${tier} Get 1` : null;

  const units = bz?.unitsThisWindow ?? 0;
  const credit = tier ? creditFor(tier) : 2;
  const slots = tier ? Math.ceil(UNITS / credit) : 3;
  const filled = Math.min(slots, Math.floor(units / credit));
  const hasPartial = units - filled * credit > 0 && filled < slots;
  const fillsNeeded = Math.max(1, Math.ceil((UNITS - units) / credit));
  const claimCount = promo.claimCount || 0;

  const bandState = (band: 1 | 2 | 3): 'live' | 'dead' | 'future' => {
    if (!hasView) return 'future'; // syncing — never paint tiers as burned without data
    if (tier === null) return 'dead';
    if (band === tier) return 'live';
    return band < tier ? 'dead' : 'future';
  };

  const bands: Array<{ band: 1 | 2 | 3; deal: string; range: string }> = [
    { band: 1, deal: 'BUY 1 GET 1', range: 'DRAFTS 1–20' },
    { band: 2, deal: 'BUY 2 GET 1', range: 'DRAFTS 21–40' },
    { band: 3, deal: 'BUY 3 GET 1', range: 'DRAFTS 41–60' },
  ];

  return (
    <section
      className="promo-grad promo-sweep promo-rise rounded-[24px] p-6 sm:p-8 text-white"
      style={promoHueStyle('bonus-zone', 0)}
      aria-label="Banana Zone — featured promo"
    >
      <div className="relative z-[1]">
        {/* header row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="promo-tx min-w-0">
            <h3 className="text-[30px] sm:text-[40px] font-extrabold leading-[1] tracking-[-.8px]">
              Free <span className="text-banana">Spins</span>
            </h3>
            <div className="mt-1.5 text-[15px] sm:text-[16px] font-extrabold tracking-[5px] text-white">BANANA ZONE</div>
          </div>
          <button
            type="button"
            onClick={onOpenModal}
            className="promo-tx text-[10px] font-extrabold tracking-[1px] text-white/70 hover:text-white whitespace-nowrap"
          >
            DETAILS ▾
          </button>
        </div>

        {/* story */}
        <div className="promo-tx mt-3 max-w-[56ch]">{STORY}</div>

        {/* combined panel: countdown | your fills */}
        <div className="mt-5 rounded-[18px] border-[1.5px] border-banana/50 bg-black/30 shadow-[0_0_22px_rgba(255,207,61,.13)] grid grid-cols-1 min-[480px]:grid-cols-[1fr_1px_1.2fr] items-center gap-4 px-5 py-4">
          <div className="text-center">
            {tier ? (
              <>
                <div className="text-[44px] sm:text-[52px] font-extrabold leading-none tabular-nums text-banana [text-shadow:0_0_22px_rgba(255,207,61,.5)]">
                  {draftsLeftInTier}
                </div>
                <div className="mt-1 text-[10px] font-extrabold tracking-[1.6px] text-white/70 uppercase">
                  drafts left at {label}
                </div>

              </>
            ) : (
              <>
                <div className="text-[44px] sm:text-[52px] font-extrabold leading-none tabular-nums text-white/35">{hasView ? 0 : '—'}</div>
                <div className="mt-1 text-[10px] font-extrabold tracking-[1.6px] text-white/55 uppercase">
                  {hasView ? 'zone closed — reopens at next Jackpot' : 'connecting…'}
                </div>
              </>
            )}
          </div>
          <div className="hidden min-[480px]:block w-px h-[74px] bg-banana/30" />
          <div className="text-center flex flex-col items-center gap-2">
            <div className="text-[10.5px] font-extrabold tracking-[2.6px] text-white/75 uppercase">Your Filled Drafts</div>
            <div className="inline-flex gap-3">
              {Array.from({ length: slots }, (_, i) => {
                const on = i < filled;
                const part = i === filled && hasPartial;
                const next = i === filled && !hasPartial && tier !== null;
                return (
                  <span
                    key={i}
                    className={`w-[52px] h-[52px] sm:w-[58px] sm:h-[58px] rounded-full flex items-center justify-center text-[25px] sm:text-[28px] transition-all duration-300 ${
                      on ? 'border-[3px] border-banana bg-banana/15 shadow-[0_0_18px_rgba(255,207,61,.65)] scale-[1.04]'
                        : part ? 'border-[3px] border-banana/60 bg-banana/[.08]'
                          : `border-[3px] border-dashed border-white/45 bg-black/20 ${next ? 'bz-nextup' : ''}`
                    }`}
                  >
                    <span className={on ? '[filter:drop-shadow(0_0_8px_rgba(255,207,61,.6))]' : part ? 'opacity-80 grayscale-[.3]' : 'opacity-80 grayscale-[.5] brightness-[.8]'}>🍌</span>
                  </span>
                );
              })}
            </div>
            {hasVisibleClaim && claimCount > 0 ? (
              <button
                type="button"
                onClick={onClaim}
                className="promo-glow mt-0.5 rounded-full bg-banana px-5 py-2.5 text-[12.5px] font-extrabold tracking-[1px] text-black uppercase bz-claimpulse hover:-translate-y-px active:scale-[.97] transition-transform"
              >
                {claimCount > 1 ? `Claim ${claimCount} Spins` : 'Claim Spin'}
              </button>
            ) : (
              <div className="text-[14px] sm:text-[15px] font-extrabold tracking-[.8px] uppercase text-banana [text-shadow:0_0_12px_rgba(255,207,61,.5)]">
                {tier === null ? <span className="text-white/50">{hasView ? 'Zone closed' : '…'}</span> : `${fillsNeeded} more = Free Spin`}
              </div>
            )}
          </div>
        </div>

        {/* tier chips — fire on the live one */}
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          {bands.map(({ band, deal, range }) => {
            const st = bandState(band);
            return (
              <div
                key={band}
                className={`relative overflow-hidden text-center rounded-xl px-1 pt-2.5 pb-2 uppercase font-extrabold leading-[1.2] transition-all duration-300 ${
                  st === 'live'
                    ? 'text-[13px] sm:text-[15px] text-[#04231a] border border-emerald-300 bg-gradient-to-br from-[#7ff0c3] via-[#34d399] to-[#0fa371] scale-[1.05] bz-fire'
                    : st === 'dead'
                      ? 'text-[12px] sm:text-[13.5px] text-white/60 border border-white/10 bg-black/25'
                      : 'text-[12px] sm:text-[13.5px] text-white/80 border border-white/15 bg-black/25'
                }`}
              >
                {deal}
                <em className={`block not-italic mt-0.5 text-[9px] sm:text-[10px] font-extrabold tracking-[1.4px] ${
                  st === 'live' ? 'text-[#04231a]/80' : 'text-white/45'
                }`}>{range}</em>
                {st === 'live' && (
                  <span className="block mt-0.5 text-[8px] font-black tracking-[2px] text-[#04231a]/85">● LIVE</span>
                )}
                {st === 'dead' && (
                  <span className="block mt-0.5 text-[7.5px] font-extrabold tracking-[1.8px] text-white/35">BACK NEXT JP</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
