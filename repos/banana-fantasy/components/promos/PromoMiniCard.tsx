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
  const { isTwitterVerified, linkTwitter } = useAuth();
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
          {(() => { const k = promoKickerLines(promo); const bzOneLine = promo.type === 'bonus-zone'; return (
            <span className={`promo-tx block ${bzOneLine ? 'max-w-[118px]' : 'max-w-[92px]'}`}>
              {k.top && <span className="block text-[8.5px] font-extrabold tracking-[1.3px] text-white/75 leading-[1.3]">{k.top}</span>}
              <span className={`block text-[14px] font-extrabold tracking-[1px] text-white leading-[1.15] mt-[2px] ${bzOneLine ? 'whitespace-nowrap' : ''}`}>{k.big}</span>
            </span>
          ); })()}
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
          /* Compact SPOTLIGHT mirror (Boris 2026-08-23): as much of the big
             card as fits — description, then your fill sockets + the target. */
          (() => {
            const bz = promo.modalContent.bonusZone;
            const credit = bz.tier === 1 ? 6 : bz.tier === 2 ? 3 : 2;
            const slots = bz.tier ? Math.ceil(6 / credit) : 3;
            const units = bz.unitsThisWindow ?? 0;
            const filled = Math.min(slots, Math.floor(units / credit));
            const part = units - filled * credit > 0 && filled < slots;
            const need = Math.max(1, Math.ceil((6 - units) / credit));
            return (
              <>
                <p className="text-[11.5px] leading-snug text-[#c9c9d2] line-clamp-3 whitespace-pre-line overflow-hidden">{promo.description}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="inline-flex gap-1.5">
                    {Array.from({ length: slots }, (_, i) => (
                      <span
                        key={i}
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] ${
                          i < filled ? 'border-2 border-banana bg-banana/15 shadow-[0_0_8px_rgba(255,207,61,.5)]'
                            : i === filled && part ? 'border-2 border-banana/60 bg-banana/[.08]'
                              : 'border-2 border-dashed border-white/40 bg-black/20'
                        }`}
                      >
                        <span className={i < filled ? '' : 'opacity-80 grayscale-[.5] brightness-[.8]'}>🍌</span>
                      </span>
                    ))}
                  </span>
                  <span className="text-[9.5px] font-extrabold tracking-[.6px] uppercase text-banana leading-tight">
                    {bz.tier ? `${need} more = Free Spin` : 'Back next JP'}
                  </span>
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
        ) : (
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
