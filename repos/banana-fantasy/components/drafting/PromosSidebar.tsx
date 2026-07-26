'use client';

import React, { useState, useEffect } from 'react';
import type { Promo } from '@/types';
import { SpinExplainer } from '@/components/promos/SpinExplainer';
import { deriveChaseState } from '@/lib/chasePromo';

// Chase Your Pick clock — dormant reads a full 24:00:00 that hasn't started.
function formatChaseTime(endTime?: string): string {
  if (!endTime) return '24:00:00';
  const diff = new Date(endTime).getTime() - Date.now();
  if (diff <= 0) return '0:00:00';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface PromosSidebarProps {
  promos: Promo[];
  promoIndex: number;
  promoCount: number;
  /** True while promos are still loading (e.g. on refresh, before auth/promos
   *  resolve) — so we show a loading state instead of flashing "No promos". */
  loading?: boolean;
  claimedPromos: Set<string>;
  onSelectPromo: (promo: Promo) => void;
  onClaim: (promo: Promo, e?: React.MouseEvent) => void | Promise<void>;
  onSelectIndex: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function PromosSidebar({
  promos,
  promoIndex,
  promoCount,
  loading,
  claimedPromos,
  onSelectPromo,
  onClaim,
  onSelectIndex,
  onPrev,
  onNext,
}: PromosSidebarProps) {
  // 1s tick so the Chase Your Pick countdown ticks live on the sidebar.
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Promos</h3>
        <span className="text-xs text-white/30">
          {promoCount === 0 ? '0/0' : `${promoIndex + 1}/${promoCount}`}
        </span>
      </div>

      {loading ? (
        // Apple-style skeleton silhouette while promos resolve — no text flash.
        <div className="rounded-[20px] p-5 h-44 bg-[#fbfbfd] border border-[#d2d2d7] flex flex-col animate-pulse" aria-hidden="true">
          <div className="mx-auto h-4 w-3/5 rounded-full bg-[#e8e8ed]" />
          <div className="mx-auto mt-2 h-3 w-2/5 rounded-full bg-[#ececf0]" />
          <div className="mt-auto">
            <div className="mb-2 h-1.5 w-full rounded-full bg-[#e8e8ed]" />
            <div className="h-9 w-full rounded-full bg-[#e8e8ed]" />
          </div>
        </div>
      ) : promoCount === 0 ? (
        <div className="rounded-[20px] p-5 h-44 bg-[#fbfbfd] border border-[#d2d2d7] flex items-center justify-center text-sm text-[#4a4a4a]">
          No promos available
        </div>
      ) : (
        (() => {
          const promo = promos[promoIndex];
          // Binary promos (max <= 1) skip the counter+bar — "0/1" says nothing.
          const hasProgress = promo.progressMax !== undefined && promo.progressMax > 1;
          const progressPercent = hasProgress ? ((promo.progressCurrent || 0) / promo.progressMax!) * 100 : 0;
          const isChase = promo.type === 'pick-chase';
          const chase = isChase ? deriveChaseState(promo) : null;

          return (
            <div
              onClick={() => onSelectPromo(promo)}
              // min-height (not fixed h-44): the Match Your Pick card carries an
              // extra offer line + a tall countdown + CLAIM, which overran a rigid
              // 176px box and jammed the clock onto "guaranteed at least 1". Letting
              // it grow keeps the mt-auto bottom-pin intact for the shorter promos.
              className="relative rounded-[20px] p-5 min-h-[11rem] bg-[#fbfbfd] border border-[#d2d2d7] hover:border-banana hover:shadow-[0_0_15px_rgba(251,191,36,0.3)] cursor-pointer transition-all flex flex-col"
            >
              {promo.isNew && (
                <span className="absolute top-2 right-2 px-2 py-0.5 bg-banana text-[#1d1d1f] text-[10px] font-bold rounded-full tracking-wide">
                  NEW
                </span>
              )}
              <h4 className="font-semibold text-[#1d1d1f] text-lg leading-snug tracking-tight text-center">
                {promo.title.includes('→') ? (
                  <>
                    <span>{promo.title.split('→')[0].trim()}</span>
                    <br />
                    <span className="text-[#4a4a4a] text-sm font-semibold">
                      → {promo.title.split('→')[1].trim()}
                    </span>
                  </>
                ) : (
                  <span>{promo.title}</span>
                )}
              </h4>
              {/* FIRST-PURCHASE ONLY (Boris 2026-07-13): full offer copy on
                  the box front as FIXED LINES — each line one complete idea,
                  never wrapping mid-phrase. Other promos stay title-only. */}
              {promo.type === 'first-purchase' && (
                <div className="mt-1.5 text-center text-[11px] leading-relaxed text-[#4a4a4a]">
                  <span className="block whitespace-nowrap">Every Pass = 2 Free Spins</span>
                  <span className="block whitespace-nowrap">Buy 1 → 2 Free Drafts GTD</span>
                  <span className="block whitespace-nowrap">Win up to 40 Free Drafts</span>
                  <span className="block whitespace-nowrap">($1,000 in Drafts)</span>
                </div>
              )}
              <SpinExplainer promoTitle={promo.title} className="mt-1 block text-center text-[11px] leading-snug text-[#4a4a4a]" />
              <div className="mt-auto">
                {/* Chase Your Pick — bottom row: live countdown, plus (once a draft
                    locks a pick) the slot, attempts, and next-hit Spins. */}
                {isChase && (
                  // mt-3 guarantees a gap above the clock even when the card has
                  // grown to fit its content and mt-auto has no slack to give.
                  <div className="mt-3 mb-2 flex flex-col items-center gap-0.5">
                    {chase?.active && (
                      <div className="flex items-center justify-center gap-1 text-[11px] text-[#4a4a4a] whitespace-nowrap">
                        <span className="font-bold text-[#1d1d1f]">Pick {chase.slot}</span>
                        <span className="text-[#c4c4c8]">·</span>
                        <span className="font-semibold">Att {chase.attempt}</span>
                        <span className="text-[#c4c4c8]">→</span>
                        <span className="font-bold text-[#f97316]">{chase.nextHit} {chase.nextHit === 1 ? 'Spin' : 'Spins'}{chase.isMax ? ' MAX' : ''}</span>
                      </div>
                    )}
                    <span className="text-[15px] font-bold tabular-nums text-[#1d1d1f]">{formatChaseTime(promo.timerEndTime)}</span>
                  </div>
                )}
                {/* Banana Draw — same bottom row as Chase: Bananas (once earned)
                    above a live countdown. Also missing before 2026-07-26. */}
                {promo.type === 'banana-draw' && (
                  <div className="mt-3 mb-2 flex flex-col items-center gap-0.5">
                    {(promo.modalContent.bananaDraw?.bananas ?? 0) > 0 && (
                      <div className="flex items-center justify-center gap-1 text-[11px] text-[#4a4a4a] whitespace-nowrap">
                        <span className="font-bold text-[#ef6c37]">🍌 {promo.modalContent.bananaDraw?.bananas}</span>
                        {(promo.modalContent.bananaDraw?.pending ?? 0) > 0 && (
                          <>
                            <span className="text-[#c4c4c8]">·</span>
                            <span className="font-semibold">{promo.modalContent.bananaDraw?.pending} filling</span>
                          </>
                        )}
                      </div>
                    )}
                    <span className="text-[15px] font-bold tabular-nums text-[#1d1d1f]">{formatChaseTime(promo.timerEndTime) || '24:00:00'}</span>
                  </div>
                )}
                {!isChase && hasProgress && (
                  <div className="mb-2">
                    <div className="flex justify-center text-xs text-[#4a4a4a] mb-1">
                      <span className="font-semibold">{promo.progressCurrent}/{promo.progressMax}</span>
                    </div>
                    <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1d1d1f] rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
                {promo.claimable && !claimedPromos.has(promo.id) && (
                  <button
                    onClick={(e) => {
                      void onClaim(promo, e);
                    }}
                    className="w-full py-2 bg-banana text-[#1d1d1f] text-xs font-bold rounded-full hover:scale-105 transition-all"
                  >
                    {promo.claimCount && promo.claimCount > 1 ? `CLAIM (${promo.claimCount})` : 'CLAIM'}
                  </button>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* Dots + nav only once real promos are present — never under the skeleton/empty. */}
      {!loading && promoCount > 0 && (
        <>
          <div className="flex justify-center gap-1.5 mt-3">
            {promos.map((_, idx) => (
              <button
                key={idx}
                onClick={() => onSelectIndex(idx)}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === promoIndex ? 'bg-banana w-4' : 'bg-white/20 hover:bg-white/40'
                }`}
              />
            ))}
          </div>

          <div className="flex justify-between mt-3">
            <button onClick={onPrev} className="px-3 py-1.5 text-white/40 hover:text-white/70 transition-colors text-sm">
              ← Prev
            </button>
            <button onClick={onNext} className="px-3 py-1.5 text-white/40 hover:text-white/70 transition-colors text-sm">
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
