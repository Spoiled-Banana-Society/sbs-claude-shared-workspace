'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import type { RevealPlayer } from '@/components/drafting/TeamReveal';
import { SpinWheel, BBB4_SLICES, type SpinResult } from '@/components/SpinWheel';

const TeamReveal = dynamic(() => import('@/components/drafting/TeamReveal').then(m => ({ default: m.TeamReveal })), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-bg-primary flex items-center justify-center"><div className="animate-pulse text-text-muted">Loading reveal...</div></div>,
});
import { useAuth } from '@/hooks/useAuth';
import { getDraftSummary, getDraftInfo, type ApiDraftPick } from '@/lib/api/drafts';

type Phase = 'reveal' | 'spin';

function DraftRevealContent() {
  const searchParams = useSearchParams();
  const params = searchParams ?? new URLSearchParams();
  const draftId = params.get('id') || '';
  const { user } = useAuth();
  const walletAddress = user?.walletAddress ?? '';

  const [players, setPlayers] = useState<RevealPlayer[]>([]);
  const [draftLevel, setDraftLevel] = useState<string>('Pro');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('reveal');
  const [spinComplete, setSpinComplete] = useState(false);

  useEffect(() => {
    if (!draftId) {
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const [summaryResult, infoResult] = await Promise.allSettled([
          getDraftSummary(draftId),
          getDraftInfo(draftId),
        ]);

        // Get draft level
        if (infoResult.status === 'fulfilled') {
          const info = infoResult.value as Record<string, unknown>;
          const level = String(info.draftLevel ?? info.level ?? info._level ?? info.draftType ?? 'Pro');
          setDraftLevel(level);
        }

        // Get picks — filter to user's picks if wallet available
        if (summaryResult.status === 'fulfilled') {
          const allPicks = summaryResult.value;

          let userPicks: ApiDraftPick[];
          if (walletAddress) {
            userPicks = allPicks.filter(
              (p) => p.ownerAddress?.toLowerCase() === walletAddress.toLowerCase()
            );
            // If no user picks found (maybe different wallet format), show all
            if (userPicks.length === 0) userPicks = allPicks;
          } else {
            userPicks = allPicks;
          }

          const mapped: RevealPlayer[] = userPicks.map((p) => ({
            playerId: p.playerId,
            displayName: p.displayName,
            team: p.team,
            position: p.position,
            pickNum: p.pickNum ?? 0,
            round: p.round ?? 0,
            projectedPoints: typeof (p as Record<string, unknown>).projectedPoints === 'number'
              ? (p as Record<string, unknown>).projectedPoints as number
              : undefined,
          }));

          // Sort by pick number
          mapped.sort((a, b) => a.pickNum - b.pickNum);
          setPlayers(mapped);
        } else {
          setError('Failed to load draft results.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load draft results.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [draftId, walletAddress]);

  // Spin handler — calls backend RNG
  const handleSpin = useCallback(async (): Promise<SpinResult | null> => {
    try {
      const res = await fetch('/api/rng/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spinId: `${draftId}-${walletAddress}-${Date.now()}`,
          clientSeed: walletAddress || `anon-${Date.now()}`,
          prizes: BBB4_SLICES.map((s) => s.label),
          weights: BBB4_SLICES.map((s) => s.weight ?? 1),
        }),
      });

      if (!res.ok) {
        // Fallback: deterministic client-side pick (still uses SpinWheel animation)
        const fallbackIndex = Math.floor(Math.random() * BBB4_SLICES.length);
        return {
          winningIndex: fallbackIndex,
          prize: BBB4_SLICES[fallbackIndex].label,
        };
      }

      const data = await res.json();
      return {
        winningIndex: data.winningSlot ?? 0,
        eventId: data.event?.id,
        commitment: data.event?.commitment,
        serverSeed: data.event?.serverSeed,
        prize: data.prize ?? BBB4_SLICES[data.winningSlot ?? 0]?.label ?? 'Prize',
      };
    } catch {
      // Fallback for offline/error
      const fallbackIndex = Math.floor(Math.random() * BBB4_SLICES.length);
      return {
        winningIndex: fallbackIndex,
        prize: BBB4_SLICES[fallbackIndex].label,
      };
    }
  }, [draftId, walletAddress]);

  const handleSpinComplete = useCallback((_result: SpinResult) => {
    setSpinComplete(true);
  }, []);

  if (phase === 'reveal') {
    return (
      <div className="relative">
        <TeamReveal
          draftId={draftId || 'unknown'}
          players={players}
          draftLevel={draftLevel}
          walletAddress={walletAddress}
          isLoading={isLoading}
          error={error}
        />

        {/* Spin the Wheel CTA — appears after team is loaded */}
        {!isLoading && players.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2, duration: 0.6 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              animate={{
                boxShadow: [
                  '0 0 20px rgba(243,226,22,0.3)',
                  '0 0 40px rgba(243,226,22,0.5)',
                  '0 0 20px rgba(243,226,22,0.3)',
                ],
              }}
              transition={{ repeat: Infinity, duration: 2 }}
              onClick={() => setPhase('spin')}
              className="px-8 py-4 bg-banana text-black font-bold text-base rounded-2xl shadow-xl"
            >
              🎰 Spin for Bonus Prizes!
            </motion.button>
          </motion.div>
        )}
      </div>
    );
  }

  // Spin phase
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4 py-8">
      <AnimatePresence mode="wait">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md flex flex-col items-center gap-6"
        >
          {/* Header */}
          <div className="text-center">
            <motion.h2
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-2xl font-bold text-white"
            >
              Banana Wheel
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-white/50 text-sm mt-1"
            >
              Every draft earns a spin — win bonus draft passes!
            </motion.p>
          </div>

          {/* Wheel */}
          <SpinWheel
            slices={BBB4_SLICES}
            onSpin={handleSpin}
            onComplete={handleSpinComplete}
            spinsAvailable={1}
            size={320}
            showVerification={true}
          />

          {/* Post-spin actions */}
          {spinComplete && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex flex-col sm:flex-row gap-3 w-full max-w-xs"
            >
              <a
                href="/buy-drafts"
                className="flex-1 py-3 rounded-xl bg-banana text-black font-bold text-sm text-center hover:bg-banana/90 transition-colors"
              >
                🎟️ Buy More Drafts
              </a>
              <a
                href="/standings"
                className="flex-1 py-3 rounded-xl bg-bg-tertiary text-text-primary font-bold text-sm text-center hover:bg-bg-tertiary/80 transition-colors"
              >
                📊 Standings
              </a>
            </motion.div>
          )}

          {/* Back to reveal */}
          <button
            onClick={() => setPhase('reveal')}
            className="text-white/30 hover:text-white/60 text-xs transition-colors"
          >
            ← Back to team reveal
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default function DraftRevealPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-bounce">🍌</div>
            <p className="text-white/50 animate-pulse">Loading your team...</p>
          </div>
        </div>
      }
    >
      <DraftRevealContent />
    </Suspense>
  );
}
