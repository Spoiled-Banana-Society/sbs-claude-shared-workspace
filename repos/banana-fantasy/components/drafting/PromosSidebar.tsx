'use client';

import React from 'react';
import type { Promo } from '@/types';
import { SpinExplainer } from '@/components/promos/SpinExplainer';

interface PromosSidebarProps {
  promos: Promo[];
  promoIndex: number;
  promoCount: number;
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
  claimedPromos,
  onSelectPromo,
  onClaim,
  onSelectIndex,
  onPrev,
  onNext,
}: PromosSidebarProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Promos</h3>
        <span className="text-xs text-white/30">
          {promoCount === 0 ? '0/0' : `${promoIndex + 1}/${promoCount}`}
        </span>
      </div>

      {promoCount === 0 ? (
        <div className="rounded-[20px] p-5 h-44 bg-[#fbfbfd] border border-[#d2d2d7] flex items-center justify-center text-sm text-[#4a4a4a]">
          No promos available
        </div>
      ) : (
        (() => {
          const promo = promos[promoIndex];
          const hasProgress = promo.progressMax !== undefined && promo.progressMax > 0;
          const progressPercent = hasProgress ? ((promo.progressCurrent || 0) / promo.progressMax!) * 100 : 0;

          return (
            <div
              onClick={() => onSelectPromo(promo)}
              className="relative rounded-[20px] p-5 h-44 bg-[#fbfbfd] border border-[#d2d2d7] hover:border-banana hover:shadow-[0_0_15px_rgba(251,191,36,0.3)] cursor-pointer transition-all flex flex-col"
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
              <SpinExplainer promoTitle={promo.title} className="mt-1 block text-center text-[11px] leading-snug text-[#4a4a4a]" />
              <div className="mt-auto">
                {hasProgress && (
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
    </div>
  );
}
