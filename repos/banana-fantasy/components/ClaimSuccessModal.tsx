'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import confetti from 'canvas-confetti';

interface ClaimSuccessModalProps {
  count: number;
  /** Promo type — buy-bonus shifts the CTA to "Go Draft" + reward labeling. */
  promoType?: string;
  onClose: () => void;
}

/**
 * Apple-style "Claimed" celebration modal with a banana-yellow confetti
 * shower. Fires from ClaimCelebrationProvider, which is the single
 * source of truth for claim celebrations across all pages (homepage
 * carousel, /promos, /drafting, /banana-wheel).
 *
 * Confetti uses two staggered bursts from the top-left and top-right
 * corners (banana yellow + gold tones) so the particles rain down
 * across the whole viewport instead of stacking in one spot. Burst is
 * timed once on mount; subsequent re-opens (same modal instance left
 * mounted) won't re-fire — the provider unmounts/remounts which is
 * the desired behavior.
 */
export function ClaimSuccessModal({ count, promoType, onClose }: ClaimSuccessModalProps) {
  const router = useRouter();

  // Banana shower — two staggered side bursts so particles cover the
  // whole viewport. Fires once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const bananaColors = ['#fbbf24', '#fcd34d', '#f59e0b', '#fde047', '#facc15'];

    const fire = (originX: number, angle: number) => {
      confetti({
        particleCount: 70,
        spread: 70,
        angle,
        startVelocity: 55,
        gravity: 0.85,
        ticks: 220,
        scalar: 1.05,
        origin: { x: originX, y: 0.1 },
        colors: bananaColors,
        zIndex: 60,
        disableForReducedMotion: true,
      });
    };

    // Initial bursts from both top corners.
    fire(0.15, -65);
    fire(0.85, -115);

    // Second wave 250ms later for the "shower" feel (lighter, slower).
    const t = setTimeout(() => {
      confetti({
        particleCount: 90,
        spread: 120,
        startVelocity: 35,
        gravity: 0.6,
        ticks: 280,
        scalar: 0.9,
        origin: { x: 0.5, y: 0 },
        colors: bananaColors,
        zIndex: 60,
        disableForReducedMotion: true,
      });
    }, 250);

    return () => clearTimeout(t);
  }, []);

  // Reward labeling — buy-bonus rewards are free drafts, everything else
  // (mint/daily/pick-10/jackpot/referral/new-user) is free spins.
  const isBuyBonus = promoType === 'buy-bonus';
  const rewardLabel = isBuyBonus
    ? `${count} Free ${count === 1 ? 'Draft' : 'Drafts'}`
    : `${count} Free ${count === 1 ? 'Spin' : 'Spins'}`;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50">
      <div
        className="relative overflow-hidden rounded-[28px] p-[1px] animate-slide-up"
        style={{
          background:
            'linear-gradient(145deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 50%, rgba(251,191,36,0.2) 100%)',
        }}
      >
        <div
          className="relative bg-[#1c1c1e] rounded-[27px] px-10 py-9 text-center min-w-[300px]"
          style={{
            boxShadow:
              '0 25px 50px -12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
          }}
        >
          {/* Subtle glow behind emoji */}
          <div className="absolute top-6 left-1/2 -translate-x-1/2 w-20 h-20 bg-banana/20 rounded-full blur-2xl" />

          <div className="relative text-5xl mb-5">🎉</div>

          <p className="text-[#86868b] text-sm font-medium tracking-wide uppercase mb-2">
            Claimed
          </p>

          <h3 className="text-[26px] font-semibold text-white tracking-tight mb-7">
            {rewardLabel}
          </h3>

          <div className="flex flex-col gap-3">
            {isBuyBonus ? (
              <button
                onClick={() => {
                  onClose();
                  router.push('/drafting');
                }}
                className="w-full py-3.5 bg-[#fbbf24] text-[#1a1a1f] font-semibold rounded-xl hover:bg-[#fcd34d] active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
              >
                Go Draft <span className="text-lg">🏈</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  onClose();
                  router.push('/banana-wheel');
                }}
                className="w-full py-3.5 bg-[#fbbf24] text-[#1a1a1f] font-semibold rounded-xl hover:bg-[#fcd34d] active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
              >
                Spin the Wheel <span className="text-lg">🎡</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-full py-3 text-[#86868b] font-medium rounded-xl hover:text-white hover:bg-white/5 active:scale-[0.98] transition-all duration-150"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
