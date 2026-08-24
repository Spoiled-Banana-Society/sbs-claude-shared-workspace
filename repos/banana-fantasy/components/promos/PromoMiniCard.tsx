'use client';

// Compact promo card — the home carousel (208×240) and the draft-room sidebar
// (224 wide) share this one component: colored block on top with the kicker
// and the promo's indicator, then name, one line, and the live fact + action.
// Same hues / indicators / chip as the /promos page, no tilt, no sweep — the
// gradient drifts and that's it. Tap → the parent opens the promo modal.

import React from 'react';
import type { Promo } from '@/types';
import { PromoSwatch, PromoLive } from '@/components/promos/PromoVisuals';
import { promoKickerLines, promoName } from '@/lib/promoTheme';
import { firstPurchaseRedesign } from '@/lib/firstPurchaseCopy';
import { SpinExplainer } from '@/components/promos/SpinExplainer';
import { useAuth } from '@/hooks/useAuth';
import { useBatchProgress } from '@/hooks/useBatchProgress';
import { useZonePacks } from '@/hooks/useZonePacks';

export interface PromoMiniCardProps {
  promo: Promo;
  wallet: string | null;
  isClaimed: boolean;
  hasVisibleClaim: boolean;
  onOpen: () => void;
  onClaim: (e: React.MouseEvent) => void;
  /** First-purchase copy variant (server-computed). */
  fpVariant?: 'new' | 'returning';
  fpShowNewPlayerTag?: boolean;
  /** Fixed card size for the carousel; the sidebar lets it grow. */
  fixed?: boolean;
  className?: string;
}

export function PromoMiniCard({
  promo,
  wallet,
  isClaimed,
  hasVisibleClaim,
  onOpen,
  onClaim,
  fpVariant = 'new',
  fpShowNewPlayerTag = false,
  fixed = true,
  className = '',
}: PromoMiniCardProps) {
  const passive = promo.type === 'pick-10' || promo.type === 'jackpot';
  const isFp = promo.type === 'first-purchase';
  const isNu = promo.type === 'new-user';
  const isBz = promo.type === 'bonus-zone';
  const { isTwitterVerified, linkTwitter } = useAuth();
  // Banana Zone rides the same live stream as the header pills so the deal
  // tiles flip the moment the window rolls (or the JP hits); pack counts ride
  // their own status pull, re-fetched on the user-event stream ping.
  const { data: bp } = useBatchProgress();
  const zonePacks = useZonePacks(isBz ? wallet : null);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className={`relative group flex flex-col overflow-hidden rounded-[18px] bg-[#131318] border text-left cursor-pointer select-none
        transition-all duration-300 hover:-translate-y-[3px] hover:shadow-[0_16px_36px_rgba(0,0,0,.45)] active:scale-[.985]
        ${hasVisibleClaim ? 'border-banana/70 shadow-[0_0_0_1px_rgba(251,191,36,.3)]' : 'border-white/[0.08]'}
        ${passive && !hasVisibleClaim ? 'opacity-80' : ''}
        ${fixed ? 'w-52 h-[272px] shrink-0' : 'w-full min-h-[17rem]'} ${className}`}
    >
      {/* Colored block: kicker left, indicator right */}
      <div className="relative shrink-0 h-[96px]">
        <PromoSwatch promo={promo} size="md" wallet={wallet} isClaimed={isClaimed} fpVariant={fpVariant} align="right" className="h-full w-full" />
        <div className="absolute inset-0 z-[1] flex items-center justify-between gap-2 px-3.5 pointer-events-none">
          {/* Two deliberate lines, capped to the swatch's reserved left
              column: quiet qualifier on top, the PRIZE bigger underneath —
              no mid-phrase wraps (Boris 2026-08-19). */}
          {(() => {
            const k = promoKickerLines(promo);
            if (isBz) {
              const mc = promo.modalContent?.bonusZone;
              const tier = bp?.bonusZone?.tier ?? mc?.tier ?? null;
              const bands = (mc as { packBands?: Array<{ from: number; to: number; seats: number }> } | undefined)?.packBands;
              const t1 = bp?.bonusZone?.tier1Through ?? mc?.tier1Through ?? 25;
              const seats = bands?.find((b) => (tier === 1 ? b.from === 1 : b.from === t1 + 1))?.seats ?? null;
              return (
                <span className="promo-tx block max-w-[118px] shrink-0">
                  <span className="block font-extrabold text-white leading-[1.15] whitespace-nowrap text-[14px] tracking-[.8px]">FREE SPINS</span>
                  {seats !== null && tier !== null && (
                    <span className="block text-[10px] font-black tracking-[.7px] text-banana leading-[1.2] mt-[4px] whitespace-nowrap">+ {seats} JACKHOF SEATS</span>
                  )}
                </span>
              );
            }
            return (
              <span className="promo-tx block max-w-[92px]">
                {k.top && <span className="block text-[8.5px] font-extrabold tracking-[1.3px] text-white/75 leading-[1.3]">{k.top}</span>}
                <span className="block font-extrabold text-white leading-[1.15] mt-[2px] text-[14px] tracking-[1px]">{k.big}</span>
              </span>
            );
          })()}
        </div>
        {promo.isNew && (
          <span className="absolute top-2 right-2 z-[2] rounded-full bg-banana px-2 py-[3px] text-[9px] font-black tracking-[1.4px] text-black">
            NEW
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5 flex-1 min-h-0 px-3.5 pt-3 pb-3.5 overflow-hidden">
        <h4 className="text-[14.5px] font-extrabold text-white leading-tight tracking-[-.2px]">{promoName(promo)}</h4>
        {isFp ? (
          (() => {
            const r = firstPurchaseRedesign(fpVariant);
            return (
              <div className="text-[11px] leading-snug text-[#c9c9d2]">
                {fpShowNewPlayerTag && (
                  <span className="block text-[9px] font-extrabold uppercase tracking-[1.4px] text-white/80 mb-0.5">New players</span>
                )}
                <span className="block font-bold text-white">{r.line1}</span>
                <span className="block mt-[2px]">{r.line2}</span>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {r.ladder.map((rung) => (
                    <div key={rung.buy} className={`relative text-center rounded-lg py-[6px] px-[2px] border ${rung.max ? 'border-banana/55 bg-banana/[.07]' : 'border-white/[.14] bg-white/[0.05]'}`}>
                      {rung.max && (
                        <span className="absolute -top-[6px] left-1/2 -translate-x-1/2 rounded-full border border-banana/45 bg-[#14141a] px-[5px] text-[6px] font-extrabold tracking-[.16em] text-banana">MAX</span>
                      )}
                      <i className="block not-italic text-[8.5px] font-black tracking-[.06em] text-white whitespace-nowrap">{rung.buy}</i>
                      <b className="block text-[11px] font-extrabold leading-[1.1] mt-[1px] text-banana whitespace-nowrap">{rung.get.replace(' Free', '')}</b>
                    </div>
                  ))}
                </div>
                {r.showBonus && (
                  <span className="block mt-2 text-[10.5px]">Plus a <b className="text-banana">Bonus Spin</b> with every pass.</span>
                )}
              </div>
            );
          })()
        ) : promo.type === 'bonus-zone' && promo.modalContent?.bonusZone ? (
          /* Compact SPOTLIGHT mirror v2 (Boris 2026-08-24): micro deal table
             (live band highlighted), the Jackpot-hit intro, your fill sockets,
             then the live stats + pack-unlock rule. All band data from the
             live config so a re-tier moves this card too. */
          (() => {
            const bz = promo.modalContent.bonusZone;
            const tier = bp?.bonusZone?.tier ?? bz.tier ?? null;
            const t1 = bp?.bonusZone?.tier1Through ?? bz.tier1Through ?? 25;
            const t2 = bp?.bonusZone?.tier2Through ?? bz.tier2Through ?? 50;
            const t3 = bp?.bonusZone?.tier3Through ?? bz.tier3Through ?? 50;
            const end = Math.max(t2, t3);
            const draftsLeft = bp?.bonusZone?.draftsLeftInTier ?? bz.draftsLeftInTier ?? 0;
            const bands = (bz as { packBands?: Array<{ from: number; to: number; seats: number }> }).packBands ?? null;
            const totalSeats = bands ? bands.reduce((n, b) => n + b.seats, 0) : null;
            const rows: Array<[number, number, number]> = [[1, 1, t1], [2, t1 + 1, t2], ...(end > t2 ? [[3, t2 + 1, end] as [number, number, number]] : [])];
            const credit = tier === 1 ? 6 : tier === 2 ? 3 : 2;
            const units = bz.unitsThisWindow ?? 0;
            const slots = tier ? Math.ceil(6 / credit) : 0;
            const filledN = Math.min(slots, Math.floor(units / credit));
            const need = Math.max(1, Math.ceil((6 - units) / credit));
            const unlockAt = tier === 1 ? t1 : end;
            return (
              <>
                <div className="flex flex-col gap-[3px]">
                  {rows.map(([b, f, to]) => {
                    const on = b === tier;
                    const seats = bands?.find((p) => p.from === f)?.seats ?? null;
                    return (
                      <div key={b} className={`flex flex-col gap-[2px] rounded-lg px-2.5 py-[5px] pr-3.5 border ${on ? 'bg-emerald-400/[.12] border-emerald-300/45' : 'border-white/[.08] opacity-70'}`}>
                        <div className={`font-extrabold whitespace-nowrap ${on ? 'text-[12.5px] text-emerald-300' : 'text-[10.5px] text-white/85'}`}>
                          Buy {b} Get <span className="text-banana">1 Spin</span>
                        </div>
                        <div className="text-[8px] font-extrabold tracking-[.25px] whitespace-nowrap">
                          <span className="text-[rgba(235,245,240,.7)]">DRAFTS {f}–{to}</span>
                          {seats !== null && <span className="text-banana"> · {seats} JACKHOF SEATS</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11.5px] leading-snug text-[#c9c9d2]">
                  Jackpot just hit? Enter the Banana Zone — paid fills earn <b className="text-banana font-extrabold">Free Spins</b> and
                  sealed <b className="text-banana font-extrabold">Packs</b>{totalSeats !== null ? <>, with <b className="text-banana font-extrabold whitespace-nowrap">{totalSeats} JackHOF seats</b> hidden inside the Packs</> : null}.
                </p>
                {tier !== null && zonePacks.openable === 0 && (
                  <div className="flex items-center gap-2">
                    {Array.from({ length: slots }, (_, i) => (
                      <span key={i} className={`w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[11px] ${
                        i < filledN ? 'border-2 border-banana bg-banana/15 shadow-[0_0_8px_rgba(255,207,61,.55)]' : 'border-2 border-dashed border-white/40 bg-black/20'
                      }`}><span className={i < filledN ? '' : 'opacity-70 grayscale-[.5]'}>🍌</span></span>
                    ))}
                    <span className="text-[10.5px] font-extrabold tracking-[.5px] uppercase text-banana">
                      {hasVisibleClaim ? 'Spin ready' : `${need} more = Free Spin`}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-2 gap-y-[2px] text-[10px] font-extrabold tracking-[.5px] uppercase text-[rgba(235,245,240,.85)]">
                  {zonePacks.openable > 0 ? (
                    <span className="whitespace-nowrap"><b className="text-banana">{zonePacks.openable} PACKS READY</b> — SEATS INSIDE</span>
                  ) : tier !== null ? (
                    <>
                      <span className="whitespace-nowrap"><b className="text-banana">{draftsLeft}</b> DRAFTS LEFT</span>
                      <span className="whitespace-nowrap"><b className="text-banana">{zonePacks.sealed}</b> PACK{zonePacks.sealed === 1 ? '' : 'S'}</span>
                    </>
                  ) : (
                    <span className="whitespace-nowrap text-white/55">ZONE REOPENS WHEN THE JP HITS</span>
                  )}
                </div>
                {tier !== null && zonePacks.openable === 0 && (
                  <span className="block text-[9.5px] leading-[1.5] font-extrabold tracking-[.4px] uppercase text-[rgba(235,245,240,.55)]">
                    {zonePacks.sealed > 0 ? `Packs unlock at ${unlockAt} drafts or when the JP hits` : 'Every paid fill = 1 sealed Pack'}
                  </span>
                )}
                <div className={`mt-auto pt-1 ${hasVisibleClaim && zonePacks.openable > 0 ? 'grid grid-cols-2 gap-2' : ''}`}>
                  {hasVisibleClaim && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onClaim(e); }}
                      className="promo-glow w-full rounded-full bg-banana px-3 py-2 text-[11px] font-extrabold text-black uppercase tracking-[.5px] active:scale-[.97] transition-transform"
                    >
                      {promo.claimCount && promo.claimCount > 1 ? `Claim · ${promo.claimCount}` : 'Claim Spin'}
                    </button>
                  )}
                  {zonePacks.openable > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpen(); }}
                      className="w-full rounded-full bg-gradient-to-br from-[#7ff0c3] to-[#34d399] px-3 py-2 text-[11px] font-black text-[#04231a] uppercase tracking-[.5px] active:scale-[.97] transition-transform"
                    >
                      Open Packs
                    </button>
                  )}
                </div>
              </>
            );
          })()
        ) : (
          <>
            <p className="text-[11.5px] leading-snug text-[#c9c9d2] line-clamp-4 whitespace-pre-line overflow-hidden">{promo.description}</p>
            <SpinExplainer promoTitle={promo.title} promoType={promo.type} className="block text-[10px] leading-snug text-banana/80" />
          </>
        )}
        {isNu && !isTwitterVerified && !isClaimed && !hasVisibleClaim ? (
          /* New User, X not linked: one full-width connect button (Boris 2026-08-19). */
          <div className="mt-auto pt-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); linkTwitter(); }}
              className="w-full rounded-full bg-white px-3 py-2 text-[11.5px] font-extrabold text-black active:scale-[.97] transition-transform"
            >
              Connect your X to claim
            </button>
          </div>
        ) : isFp && !hasVisibleClaim ? (
          /* First Purchase: full-width Buy Drafts (Boris 2026-08-19). */
          <div className="mt-auto pt-1">
            <a
              href="/buy-drafts"
              onClick={(e) => e.stopPropagation()}
              className="block w-full text-center rounded-full bg-white px-3 py-2 text-[11.5px] font-extrabold text-black active:scale-[.97] transition-transform"
            >
              Buy Drafts
            </a>
          </div>
        ) : isBz ? null : (
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 min-h-[30px]">
          <div className="min-w-0 flex-1">
            <PromoLive promo={promo} size="md" wallet={wallet} hasVisibleClaim={hasVisibleClaim} isClaimed={isClaimed} hideLabel={hasVisibleClaim} />
          </div>
          {hasVisibleClaim ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClaim(e); }}
              className="promo-glow shrink-0 rounded-full bg-banana px-3 py-1.5 text-[10.5px] font-extrabold text-black active:scale-[.97] transition-transform"
            >
              {promo.claimCount && promo.claimCount > 1 ? `Claim · ${promo.claimCount}` : 'Claim'}
            </button>
          ) : null}
        </div>
        )}
      </div>
    </div>
  );
}
