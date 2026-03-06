'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';

const BananaWheel = dynamic(() => import('@/components/wheel/BananaWheel').then(m => ({ default: m.BananaWheel })), {
  ssr: false,
  loading: () => <div className="w-[300px] h-[300px] mx-auto bg-bg-tertiary rounded-full animate-pulse" />,
});
import { PromoCarousel } from '@/components/home/PromoCarousel';
import { useAuth } from '@/hooks/useAuth';
import { useWheel, type WheelSpinOutcome } from '@/hooks/useWheel';
import { usePromos } from '@/hooks/usePromos';
import { wheelSegments, type WheelSegment } from '@/lib/wheelConfig';

export default function BananaWheelPage() {
  const { user, updateUser } = useAuth();
  const wheelQuery = useWheel();
  const promosQuery = usePromos({ userId: user?.id });
  const [spinHistory, setSpinHistory] = useState<Array<{ id: string; date: string; result: string }>>([]);
  const [spinsAvailable, setSpinsAvailable] = useState(user?.wheelSpins || 0);

  useEffect(() => {
    setSpinsAvailable(user?.wheelSpins || 0);
  }, [user?.wheelSpins]);

  const segmentMap = useMemo(() => new Map(wheelSegments.map((segment) => [segment.id, segment])), []);

  const handleSpin = useCallback(async (): Promise<WheelSpinOutcome | null> => {
    return wheelQuery.spin();
  }, [wheelQuery]);

  const handleSpinComplete = useCallback(
    (outcome: WheelSpinOutcome, segment: WheelSegment | null) => {
      const today = new Date().toISOString().split('T')[0];
      setSpinHistory((prev) => [{ id: outcome.spinId, date: today, result: outcome.result }, ...prev]);
      setSpinsAvailable((prev) => Math.max(0, prev - 1));

      if (!user || !segment) return;
      if (segment.prizeType === 'draft_pass' && typeof segment.prizeValue === 'number') {
        updateUser({ freeDrafts: (user.freeDrafts || 0) + segment.prizeValue });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'jackpot') {
        updateUser({ jackpotEntries: (user.jackpotEntries || 0) + 1 });
      } else if (segment.prizeType === 'custom' && segment.prizeValue === 'hof') {
        updateUser({ hofEntries: (user.hofEntries || 0) + 1 });
      }
    },
    [updateUser, user],
  );

  const prizeSummary = useMemo(() => {
    const summary = new Map<string, { label: string; color: string; probability: number }>();
    for (const segment of wheelSegments) {
      const key = `${segment.prizeType}:${segment.prizeValue ?? ''}:${segment.label}`;
      const existing = summary.get(key);
      if (existing) {
        existing.probability += segment.probability;
      } else {
        summary.set(key, { label: segment.label, color: segment.color, probability: segment.probability });
      }
    }
    return Array.from(summary.values()).sort((a, b) => b.probability - a.probability);
  }, []);

  const getPrizeLabel = (segmentId: string): string => segmentMap.get(segmentId)?.label ?? '';
  const getPrizeColor = (segmentId: string): string => segmentMap.get(segmentId)?.color ?? '#94a3b8';

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-4">
      {/* Page Header */}
      <div className="text-center mb-6" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>
        <h1 className="text-[28px] font-semibold text-white tracking-tight mb-1">Banana Wheel</h1>
        <p className="text-white text-[14px]">Spin to win Free Drafts and Special Entries</p>
      </div>

      {/* Main Layout - Wheel in center, info on sides */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-4 items-start">
        {/* Left Column */}
        <div className="flex flex-col gap-4 order-2 lg:order-1">
          {/* My Winnings */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">My Winnings</h3>
            <div className="space-y-3.5">
              <div className="flex justify-between items-center">
                <span className="text-white text-[14px] font-medium">Free Drafts</span>
                <span className="text-[#32d74b] font-semibold text-[16px]">{user?.freeDrafts || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white text-[14px] font-medium">Jackpot</span>
                <span className="text-[#ff6b6b] font-semibold text-[16px]">{user?.jackpotEntries || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white text-[14px] font-medium">HOF</span>
                <span className="text-[#ffd60a] font-semibold text-[16px]">{user?.hofEntries || 0}</span>
              </div>
            </div>
          </div>

          {/* What Are These? */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">What Are These?</h3>
            <div className="space-y-4 text-[13px]">
              <div>
                <span className="text-[#ff6b6b] font-bold text-[15px]">Jackpot</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Land on Jackpot and you&apos;re placed into a Jackpot league. Win that league and skip straight to the finals!
                </p>
              </div>
              <div>
                <span className="text-[#ffd60a] font-bold text-[15px]">HOF</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Land on HOF and you&apos;re placed into a HOF league. Compete for bonus prizes on top of regular rewards!
                </p>
              </div>
              <div>
                <span className="text-[#32d74b] font-bold text-[15px]">Free Drafts</span>
                <p className="text-white mt-1.5 leading-relaxed">
                  Free drafts can only be used to draft. They cannot be used for promos.
                </p>
              </div>
            </div>
          </div>

        </div>

        {/* Center - Wheel */}
        <div className="flex justify-center order-1 lg:order-2">
          <BananaWheel
            spinsAvailable={spinsAvailable}
            onSpin={handleSpin}
            onSpinComplete={handleSpinComplete}
          />
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-4 order-3">
          {/* Prizes */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">Prizes on Wheel</h3>
            <div className="space-y-3.5 text-[14px]">
              {prizeSummary.map((item) => (
                <div key={`${item.label}-${item.probability}`} className="flex justify-between">
                  <span className="font-bold" style={{ color: item.color }}>{item.label}</span>
                  <span className="font-bold" style={{ color: item.color }}>{(item.probability * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Spin History */}
          <div
            className="rounded-2xl p-6 backdrop-blur-md"
            style={{
              background: 'rgba(20, 20, 20, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            }}
          >
            <h3 className="text-[16px] font-semibold text-white mb-4 tracking-tight">Spin History</h3>
            {spinHistory.length > 0 ? (
              <div
                className="space-y-3.5 max-h-[200px] overflow-y-auto text-[13px] pr-6 [&::-webkit-scrollbar]:w-[10px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#3a3a3a] [&::-webkit-scrollbar-thumb]:rounded-full"
              >
                {spinHistory.slice(0, 10).map((spin) => (
                  <div key={spin.id} className="flex justify-between">
                    <span className="text-white">{spin.date}</span>
                    <span className="font-medium" style={{ color: getPrizeColor(spin.result) }}>
                      {getPrizeLabel(spin.result)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#636366] text-center text-[13px] py-2">No spins yet</p>
            )}
          </div>
        </div>
      </div>

      {/* How to Earn Spins */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-text-primary mb-4">How to Earn Spins</h2>
        <PromoCarousel
          promos={promosQuery.data ?? []}
          autoPlay={false}
          claimPromo={promosQuery.claimPromo}
          onVerifyTweet={promosQuery.verifyTweetEngagement}
          onGenerateReferralCode={promosQuery.generateReferralCode}
        />
      </section>
    </div>
  );
}
