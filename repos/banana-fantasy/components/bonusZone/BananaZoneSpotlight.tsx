'use client';

// Banana Zone SPOTLIGHT v2 — Free Spins + JackHOF Seats (Boris 2026-08-24,
// signed off from the interactive packs-edition mock). Layout, top to bottom:
//
//   Free Spins + JackHOF Seats / BANANA ZONE            DETAILS ▾
//   intro: paid fills earn Free Spins and sealed Packs, 10 seats inside
//   deal rows: Buy N Get 1 Spin · Drafts a–b · N JACKHOF SEATS
//   ┌──────────────┬────────────────────┬──────────────────┐
//   │ DRAFTS LEFT… │ YOUR FILLED DRAFTS │ YOUR PACKS       │
//   │      6       │  🍌 ◌  CLAIM SPIN  │ [pack ×7] unlock │
//   └──────────────┴────────────────────┴──────────────────┘
//   [BUY 1 GET 1 SPIN · live]  [BUY 2 GET 1 SPIN]
//
// Everything band-shaped derives from the LIVE config (tier1/2/3Through on
// the SSE view, packBands stamped by /api/promos while the drop switch is
// on) — a re-tier by Richard moves every surface with zero code change.
// Real-time: window state rides useBatchProgress (same stream as the header
// pills); the user's units ride /api/promos (usePromos refetches on stream
// pings); the user's pack counts ride useZonePacks (same trigger). Ripping
// packs happens in the modal's pack room — Open here just opens the modal.
//
// Two layouts in one card (Boris 2026-08-24): >=560px keeps the deal rows +
// three-column panel; under 560px the card becomes SECTIONS with dividers —
// intro, chips, YOUR SPINS, YOUR PACKS — so nothing crams (mock sign-off).

import React from 'react';
import type { Promo } from '@/types';
import { useBatchProgress } from '@/hooks/useBatchProgress';
import { useZonePacks } from '@/hooks/useZonePacks';
import { promoHueStyle } from '@/lib/promoTheme';
import { SealedPack } from '@/components/promos/PackVisuals';

/** Units of a spin one paid fill banks at each tier (spin = 6 units). */
const UNITS = 6;
const creditFor = (tier: 1 | 2 | 3) => (tier === 1 ? 6 : tier === 2 ? 3 : 2);

interface BandRow { band: 1 | 2 | 3; buy: number; from: number; to: number; seats: number | null }
const bandRows = (
  t1: number, t2: number, t3: number,
  packBands: Array<{ from: number; to: number; seats: number }> | null,
): BandRow[] => {
  const end = Math.max(t2, t3);
  const rows: BandRow[] = [
    { band: 1, buy: 1, from: 1, to: t1, seats: null },
    { band: 2, buy: 2, from: t1 + 1, to: t2, seats: null },
    ...(end > t2 ? [{ band: 3 as const, buy: 3, from: t2 + 1, to: end, seats: null }] : []),
  ];
  // Seats print only while ZONE PACKS is live (packBands stamped) — matched
  // by range so a re-tier can never mispair a band with its seat count.
  if (packBands) for (const r of rows) {
    r.seats = packBands.find((p) => p.from === r.from && p.to === r.to)?.seats ?? null;
  }
  return rows;
};

export interface BananaZoneSpotlightProps {
  promo: Promo;
  wallet: string | null;
  hasVisibleClaim: boolean;
  onClaim: () => void;
  onOpenModal: () => void;
}

export function BananaZoneSpotlight({ promo, wallet, hasVisibleClaim, onClaim, onOpenModal }: BananaZoneSpotlightProps) {
  const bz = promo.modalContent?.bonusZone;
  const { data } = useBatchProgress();
  const packs = useZonePacks(wallet);
  // Live view from the global stream; the /api/promos snapshot is the
  // first-paint fallback so the card never renders empty. "Closed" is only
  // ever asserted from REAL data — before any data we show a syncing state.
  const live = data?.bonusZone;
  const hasView = Boolean(live || bz);
  const tier = (live ? live.tier : bz?.tier) ?? null;
  const draftsLeftInTier = (live ? live.draftsLeftInTier : bz?.draftsLeftInTier) ?? 0;
  const position = (live ? live.position : bz?.position) ?? 0;
  const t1 = (live?.tier1Through ?? bz?.tier1Through) ?? 25;
  const t2 = (live?.tier2Through ?? bz?.tier2Through) ?? 50;
  const t3 = (live?.tier3Through ?? bz?.tier3Through) ?? 50;
  const packBands = (bz as { packBands?: Array<{ from: number; to: number; seats: number }> } | undefined)?.packBands ?? null;
  const rows = bandRows(t1, t2, t3, packBands);
  const totalSeats = packBands ? packBands.reduce((n, b) => n + b.seats, 0) : null;

  const units = bz?.unitsThisWindow ?? 0;
  const credit = tier ? creditFor(tier) : 2;
  const slots = tier ? Math.ceil(UNITS / credit) : 3;
  const filled = Math.min(slots, Math.floor(units / credit));
  const hasPartial = units - filled * credit > 0 && filled < slots;
  const fillsNeeded = Math.max(1, Math.ceil((UNITS - units) / credit));
  const claimCount = promo.claimCount || 0;
  // Progress within the LIVE deal segment ("DRAFT 19 OF 25").
  const segSize = tier === 1 ? t1 : tier === 2 ? t2 - t1 : Math.max(1, t3 - t2);
  const segDone = tier === 1 ? position : tier === 2 ? position - t1 : position - t2;
  const unlockAt = tier === 1 ? t1 : Math.max(t2, t3);

  const bandState = (band: 1 | 2 | 3): 'live' | 'dead' | 'future' => {
    if (!hasView) return 'future'; // syncing — never paint tiers as burned without data
    if (tier === null) return 'dead';
    if (band === tier) return 'live';
    return band < tier ? 'dead' : 'future';
  };

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
            <h3 className="text-[25px] sm:text-[34px] font-extrabold leading-[1.05] tracking-[-.8px] text-banana">
              Free Spins <span className="text-white/55 font-bold">+</span> JackHOF Seats
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

        {/* intro + deal rows — ranges and seats from the live config */}
        <div className="promo-tx mt-3 max-w-[58ch]">
          <p className="text-[15.5px] leading-[1.5] text-[rgba(255,255,255,.92)] font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,.45)]">
            Jackpot just hit? Enter the Banana Zone — paid fills earn <b className="text-banana">Free Spins</b> and
            sealed <b className="text-banana">Packs</b>{totalSeats ? <>, with <b className="text-banana whitespace-nowrap">{totalSeats} JackHOF seats</b> hidden inside the Packs</> : null}.
          </p>
          {/* the JackHOF payoff (Boris 2026-08-24): its own warm orange so it
              reads as the prize world, not this promo's mechanics */}
          <p className="hidden min-[560px]:block mt-1.5 text-[13.5px] leading-[1.5] font-semibold whitespace-nowrap text-[#ff9838] [text-shadow:0_1px_3px_rgba(0,0,0,.4)]">
            JackHOF — win the league and go straight to the Finals, plus you compete for added prizes.
          </p>
          <p className="mt-1.5 text-[13.5px] leading-[1.5] font-semibold text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,.4)]">
            Win your JackHOF league → skip straight to the <b className="text-white">Finals</b> and play for <b className="text-banana">added prizes</b>.
          </p>
          <div className="mt-2.5 max-w-[470px] hidden min-[560px]:block">
            {rows.map((r) => (
              <div key={r.band} className="flex items-baseline justify-between gap-4 py-[7px] border-t border-white/20 first:border-t-0 text-[15.5px] leading-[1.35] [text-shadow:0_1px_3px_rgba(0,0,0,.45)]">
                <b className="text-white font-extrabold whitespace-nowrap">Buy {r.buy} Get 1 Spin</b>
                <span className="flex items-baseline gap-3 whitespace-nowrap">
                  <span className="text-[rgba(235,245,240,.85)] text-[14px] font-bold tracking-[.4px]">Drafts {r.from}–{r.to}</span>
                  {r.seats !== null && (
                    <span className="text-banana text-[12px] font-black tracking-[.6px]">{r.seats} JACKHOF SEATS</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* MOBILE (<560px): sectioned layout — chips, then YOUR SPINS and
            YOUR PACKS split by full-width dividers. Same data, zero cram. */}
        <div className="min-[560px]:hidden">
          <p className="mt-1.5 text-[12px] leading-[1.5] font-semibold whitespace-nowrap text-[#ff9838] [text-shadow:0_1px_3px_rgba(0,0,0,.4)]">
            JackHOF — win the league → Finals + added prizes.
          </p>
          <div className={`mt-3 grid gap-2 ${rows.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {rows.map(({ band, buy, from, to, seats }) => {
              const st = bandState(band);
              return (
                <div key={band} className={`text-center rounded-[12px] px-1 pt-2.5 pb-2 uppercase font-extrabold leading-[1.25] ${
                  st === 'live'
                    ? 'text-[13px] text-white border-[1.5px] border-emerald-300 bg-gradient-to-br from-[#128a60] via-[#0b6a49] to-[#07523a] shadow-[0_0_18px_rgba(52,211,153,.4)] bz-fire'
                    : 'text-[12px] text-white/70 border border-white/[.14] bg-black/25'
                }`}>
                  BUY {buy} GET <span className="text-banana">1 SPIN</span>
                  <em className="block not-italic mt-[2px] text-[9px] font-extrabold tracking-[1.3px] text-white/50">DRAFTS {from}–{to}</em>
                  {seats !== null && <span className="block mt-[2px] text-[11px] font-black tracking-[.7px] text-banana">{seats} JACKHOF SEATS</span>}
                  {st === 'live' && <span className="block mt-0.5 text-[8px] font-black tracking-[2px] text-[#7ff0c3]">● LIVE</span>}
                </div>
              );
            })}
          </div>

          <div className="h-px bg-white/[.16] -mx-6 my-4" />
          {/* section 1 — mirrors desktop box 1: the countdown owns its row */}
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[10px] font-extrabold tracking-[1.6px] uppercase text-[rgba(235,245,240,.85)]">Drafts Left at Buy {tier ?? 1} Get 1 Spin</span>
              {tier !== null && (
                <span className="block mt-1 text-[9.5px] font-extrabold tracking-[1.2px] uppercase text-[rgba(235,245,240,.75)]">Draft {segDone} of {segSize}</span>
              )}
            </span>
            <span className="text-[34px] font-extrabold leading-none tabular-nums text-banana [text-shadow:0_0_18px_rgba(255,207,61,.5)]">
              {tier ? draftsLeftInTier : hasView ? 0 : '—'}
            </span>
          </div>

          <div className="h-px bg-white/[.16] -mx-6 my-4" />
          {/* section 2 — mirrors desktop box 2 */}
          <span className="block text-[10px] font-extrabold tracking-[2px] uppercase text-[rgba(235,245,240,.85)]">Your Filled Drafts</span>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="inline-flex gap-2.5">
              {Array.from({ length: slots }, (_, i) => {
                const on = i < filled;
                const part = i === filled && hasPartial;
                const next = i === filled && !hasPartial && tier !== null;
                return (
                  <span key={i} className={`w-[44px] h-[44px] rounded-full flex items-center justify-center text-[21px] ${
                    on ? 'border-[3px] border-banana bg-banana/15 shadow-[0_0_14px_rgba(255,207,61,.6)]'
                      : part ? 'border-[3px] border-banana/60 bg-banana/[.08]'
                        : `border-[3px] border-dashed border-white/45 bg-black/20 ${next ? 'bz-nextup' : ''}`
                  }`}><span className={on ? '' : 'opacity-80 grayscale-[.5] brightness-[.85]'}>🍌</span></span>
                );
              })}
            </span>
            {hasVisibleClaim && claimCount > 0 ? (
              <button
                type="button"
                onClick={onClaim}
                className="promo-glow rounded-full bg-banana px-[18px] py-2.5 text-[11.5px] font-extrabold tracking-[.8px] text-black uppercase bz-claimpulse active:scale-[.97] transition-transform"
              >
                {claimCount > 1 ? `Claim ${claimCount} Spins` : 'Claim Spin'}
              </button>
            ) : (
              tier === null ? (
                <span className="text-[11px] font-bold text-white/50 uppercase tracking-[.6px] text-right">{hasView ? 'Zone closed' : '…'}</span>
              ) : units === 0 ? (
                <span className="text-[11px] font-bold text-white/75 text-right">Fill a paid draft → <span className="text-banana font-extrabold">Free Spin</span></span>
              ) : (
                <span className="text-[12px] font-extrabold tracking-[.6px] uppercase text-banana text-right">{`${fillsNeeded} more = Free Spin`}</span>
              )
            )}
          </div>

          <div className="h-px bg-white/[.16] -mx-6 my-4" />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-[rgba(235,245,240,.75)]">Your Packs</span>
            {packs.sealed > 0 && packs.openable === 0 && (
              <span className="text-[10px] font-extrabold tracking-[.8px] uppercase text-banana">{packs.sealed} Packs</span>
            )}
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className={`relative inline-block ${packs.sealed === 0 ? 'opacity-40 grayscale-[.5] bz-pack-idle' : 'bz-pack-hot'}`}>
              <SealedPack w={46} />
              {packs.sealed > 0 && (
                <span className="absolute -top-[6px] -right-[8px] min-w-[20px] h-[20px] rounded-full bg-banana text-black text-[11px] font-black flex items-center justify-center px-1 shadow-[0_2px_6px_rgba(0,0,0,.45)]">{packs.sealed}</span>
              )}
            </span>
            {packs.openable > 0 ? (
              <button
                type="button"
                onClick={onOpenModal}
                className="rounded-full bg-gradient-to-br from-[#7ff0c3] to-[#34d399] px-[18px] py-2.5 text-[11.5px] font-black tracking-[.8px] text-[#04231a] uppercase bz-claimpulse active:scale-[.97] transition-transform"
              >
                Open {packs.openable} Pack{packs.openable === 1 ? '' : 's'}
              </button>
            ) : (
              <span className="text-right text-[10px] font-extrabold tracking-[.6px] uppercase leading-[1.6] text-[rgba(235,245,240,.75)]">
                {packs.sealed > 0
                  ? <>Unlock at {unlockAt} Drafts<br /><span className="text-white">or when the JP hits</span></>
                  : <>Fill a paid draft → <span className="text-banana font-extrabold normal-case">1 Pack</span></>}
              </span>
            )}
          </div>
        </div>

        {/* combined panel — three columns on a strict shared grid so headers,
            visuals and footer lines all align (Boris 2026-08-24) */}
        <div className="mt-5 rounded-[18px] border-[1.5px] border-banana/50 bg-black/30 shadow-[0_0_22px_rgba(255,207,61,.13)] hidden min-[560px]:grid min-[560px]:grid-cols-[1fr_1px_1.1fr_1px_1.2fr] items-start gap-3.5 px-5 py-4">
          {/* col 1 — countdown */}
          <div className="grid grid-rows-[18px_108px_minmax(30px,auto)] items-center justify-items-center text-center gap-2 min-h-[170px]">
            <div className="self-start text-[10.5px] font-extrabold tracking-[1.6px] uppercase text-[rgba(235,245,240,.88)]">
              Drafts Left at Buy {tier ?? 1} Get 1 Spin
            </div>
            {tier ? (
              <div className="text-[44px] sm:text-[48px] font-extrabold leading-none tabular-nums text-banana [text-shadow:0_0_22px_rgba(255,207,61,.5)]">
                {draftsLeftInTier}
              </div>
            ) : (
              <div className="text-[44px] font-extrabold leading-none tabular-nums text-white/35">{hasView ? 0 : '—'}</div>
            )}
            <div className="self-start text-[10px] font-extrabold tracking-[1.3px] uppercase text-[rgba(235,245,240,.82)]">
              {tier ? `Draft ${segDone} of ${segSize}` : hasView ? 'Reopens at next Jackpot' : 'Connecting…'}
            </div>
          </div>
          <div className="hidden min-[560px]:block w-px self-stretch bg-banana/30" />

          {/* col 2 — fills + claim */}
          <div className="grid grid-rows-[18px_108px_minmax(30px,auto)] items-center justify-items-center text-center gap-2 min-h-[170px]">
            <div className="self-start text-[11px] font-extrabold tracking-[2.6px] uppercase text-[rgba(235,245,240,.88)]">Your Filled Drafts</div>
            <div className="inline-flex gap-3">
              {Array.from({ length: slots }, (_, i) => {
                const on = i < filled;
                const part = i === filled && hasPartial;
                const next = i === filled && !hasPartial && tier !== null;
                return (
                  <span
                    key={i}
                    className={`w-[50px] h-[50px] rounded-full flex items-center justify-center text-[24px] transition-all duration-300 ${
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
            <div className="self-start">
              {hasVisibleClaim && claimCount > 0 ? (
                <button
                  type="button"
                  onClick={onClaim}
                  className="promo-glow rounded-full bg-banana px-5 py-2.5 text-[12.5px] font-extrabold tracking-[1px] text-black uppercase bz-claimpulse hover:-translate-y-px active:scale-[.97] transition-transform"
                >
                  {claimCount > 1 ? `Claim ${claimCount} Spins` : 'Claim Spin'}
                </button>
              ) : (
                tier === null ? (
                  <div className="text-[12px] font-bold text-white/50 uppercase tracking-[.8px]">{hasView ? 'Zone closed' : '…'}</div>
                ) : units === 0 ? (
                  <div className="text-[11.5px] font-bold text-white/75">Fill a paid draft → <span className="text-banana font-extrabold">Free Spin</span></div>
                ) : (
                  <div className="text-[14px] font-extrabold tracking-[.8px] uppercase text-banana [text-shadow:0_0_12px_rgba(255,207,61,.5)]">{`${fillsNeeded} more = Free Spin`}</div>
                )
              )}
            </div>
          </div>
          <div className="hidden min-[560px]:block w-px self-stretch bg-banana/30" />

          {/* col 3 — packs (count badge on the pack; ripping lives in the modal) */}
          <div className="grid grid-rows-[18px_108px_minmax(30px,auto)] items-center justify-items-center text-center gap-2 min-h-[170px]">
            <div className="self-start text-[11px] font-extrabold tracking-[2.6px] uppercase text-[rgba(235,245,240,.88)]">Your Packs</div>
            <div className={`relative ${packs.sealed === 0 ? 'opacity-40 grayscale-[.5] bz-pack-idle' : 'bz-pack-hot'}`}>
              <SealedPack w={70} />
              {packs.sealed > 0 && (
                <span className="absolute -top-[7px] -right-[10px] min-w-[24px] h-[24px] rounded-full bg-banana text-black text-[13px] font-black flex items-center justify-center px-1.5 shadow-[0_2px_8px_rgba(0,0,0,.5)]">
                  {packs.sealed}
                </span>
              )}
            </div>
            <div className="self-start">
              {packs.openable > 0 ? (
                <button
                  type="button"
                  onClick={onOpenModal}
                  className="rounded-full bg-gradient-to-br from-[#7ff0c3] to-[#34d399] px-5 py-2.5 text-[12.5px] font-black tracking-[1px] text-[#04231a] uppercase bz-claimpulse hover:-translate-y-px active:scale-[.97] transition-transform"
                >
                  Open {packs.openable} Pack{packs.openable === 1 ? '' : 's'}
                </button>
              ) : packs.sealed > 0 ? (
                <div className="text-[11.5px] font-extrabold tracking-[.9px] uppercase whitespace-nowrap text-banana">
                  Unlock at Draft {unlockAt} <span className="text-white/85">· or when the JP hits</span>
                </div>
              ) : (
                <div className="text-[11.5px] font-bold text-white/75">Fill a paid zone draft → <span className="text-banana font-extrabold">1 Pack</span></div>
              )}
            </div>
          </div>
        </div>

        {/* tier chips — deep emerald live so white + banana copy stays loud */}
        <div className={`mt-3.5 hidden min-[560px]:grid gap-2 ${rows.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {rows.map(({ band, buy, from, to, seats }) => {
            const st = bandState(band);
            return (
              <div
                key={band}
                className={`relative overflow-hidden text-center rounded-[14px] px-1.5 pt-3 pb-2.5 uppercase font-extrabold leading-[1.25] transition-all duration-300 ${
                  st === 'live'
                    ? 'text-[16px] sm:text-[18px] text-white border-[1.5px] border-emerald-300 bg-gradient-to-br from-[#128a60] via-[#0b6a49] to-[#07523a] scale-[1.04] shadow-[0_0_24px_rgba(52,211,153,.45)] bz-fire'
                    : st === 'dead'
                      ? 'text-[14px] sm:text-[16px] text-white/55 border border-white/10 bg-black/25'
                      : 'text-[14px] sm:text-[16px] text-white border border-white/[.18] bg-black/[.28]'
                }`}
              >
                BUY {buy} GET <span className="text-banana">1 SPIN</span>
                <em className={`block not-italic mt-[3px] text-[10px] sm:text-[11px] font-extrabold tracking-[1.6px] ${
                  st === 'live' ? 'text-white/65' : 'text-white/45'
                }`}>DRAFTS {from}–{to}</em>
                {seats !== null && (
                  <span className="block mt-[3px] text-[12.5px] sm:text-[14px] font-black tracking-[.9px] text-banana">{seats} JACKHOF SEATS</span>
                )}
                {st === 'live' && (
                  <span className="block mt-0.5 text-[9px] font-black tracking-[2px] text-[#7ff0c3]">● LIVE</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
