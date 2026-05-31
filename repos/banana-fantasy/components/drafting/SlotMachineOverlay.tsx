'use client';

import React, { useEffect, useRef } from 'react';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { startSlotSpin, playReelStop, playSlotReveal } from '@/lib/slotSounds';
import { DRAFT_TYPES } from '@/lib/draftRoomConstants';
import type { DraftType } from '@/lib/draftRoomConstants';
import { useRng, type RngSeedData } from '@/hooks/useRng';
import { useLeagueNumberForSlot } from '@/hooks/useLeagueNumberForSlot';

interface SlotMachineOverlayProps {
  allReelItems: DraftType[][];
  reelOffsets: number[];
  draftType: DraftType | null;
  phase: string;
  mainCountdown: number;
  slotAnimationDone: boolean;
  formatTime: (seconds: number) => string;
  onClose: () => void;
  rngSeedData?: RngSeedData | null;
  autoVerifyRng?: boolean;
  /** When provided, the VerifiedBadge next to the result becomes a link
   *  to /proof/[draftId] for the full Chainlink VRF + salt-commit
   *  receipt. */
  draftId?: string;
}

export function SlotMachineOverlay({
  allReelItems,
  reelOffsets,
  draftType,
  phase,
  mainCountdown,
  slotAnimationDone,
  formatTime,
  onClose,
  rngSeedData,
  autoVerifyRng = true,
  draftId,
}: SlotMachineOverlayProps) {
  const itemHeight = 130;
  const landingIndex = (allReelItems[0]?.length || 50) - 8;
  const targetOffset = landingIndex * itemHeight;
  const isReelStopped = (reelIndex: number) => reelOffsets[reelIndex] >= targetOffset - 1;
  const { verifySpin, isVerified, isVerifying } = useRng();
  // Resolve slot id → live global league number so the badge always
  // links to the correct draft's proof page (not a stale -1 cached
  // league number). Falls back to the slot id while resolving — the
  // /proof page itself can also resolve, so the link works either way.
  const liveLeagueNumber = useLeagueNumberForSlot(draftId);
  const badgeDraftId = liveLeagueNumber != null ? String(liveLeagueNumber) : draftId;

  useEffect(() => {
    if (!autoVerifyRng || !rngSeedData || !slotAnimationDone) return;
    void verifySpin(rngSeedData);
  }, [autoVerifyRng, rngSeedData, slotAnimationDone, verifySpin]);

  // ── Slot-machine SOUND (procedural Web Audio; no fetch → Rule #0 safe) ──
  const spinStopRef = useRef<null | (() => void)>(null);
  const prevStoppedRef = useRef<boolean[]>([false, false, false]);
  const revealedRef = useRef(false);
  // If the overlay mounts already-done (re-entry after the animation finished),
  // suppress the reveal sound so it doesn't replay every time it's reopened.
  const wasDoneOnMountRef = useRef(slotAnimationDone);

  // Spin whir runs only during the actual 'spinning' phase.
  useEffect(() => {
    if (phase === 'spinning') {
      if (!spinStopRef.current) spinStopRef.current = startSlotSpin();
    } else if (spinStopRef.current) {
      spinStopRef.current();
      spinStopRef.current = null;
    }
  }, [phase]);
  // Always stop the whir on unmount.
  useEffect(() => () => { spinStopRef.current?.(); spinStopRef.current = null; }, []);

  // A satisfying CHUNK as each reel locks (only while spinning).
  useEffect(() => {
    if (phase !== 'spinning') return;
    const stopped = [0, 1, 2].map((i) => reelOffsets[i] >= targetOffset - 1);
    for (let i = 0; i < 3; i++) {
      if (stopped[i] && !prevStoppedRef.current[i]) playReelStop(i);
    }
    prevStoppedRef.current = stopped;
  }, [reelOffsets, targetOffset, phase]);

  // The reveal payoff — once, when the animation actually finishes (not on
  // re-entry where it's already done).
  useEffect(() => {
    if (slotAnimationDone && draftType && !revealedRef.current && !wasDoneOnMountRef.current) {
      revealedRef.current = true;
      playSlotReveal(draftType);
    }
  }, [slotAnimationDone, draftType]);

  const handleCloseSlotMachine = () => {
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center pt-8 sm:pt-16 bg-black/80 backdrop-blur-sm overflow-hidden"
      onClick={handleCloseSlotMachine}
    >
      {slotAnimationDone && (
        <button
          onClick={handleCloseSlotMachine}
          className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group"
        >
          <svg className="w-6 h-6 text-white/60 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      <div className="text-center">
        <div className="mb-4 sm:mb-8">
          <p className="text-white/50 text-sm sm:text-base mb-1 sm:mb-2 uppercase tracking-widest">Draft starting in</p>
          <div className="text-5xl sm:text-7xl font-black tabular-nums text-white" style={{ textShadow: '0 0 40px rgba(255,255,255,0.3)' }}>
            {formatTime(mainCountdown)}
          </div>
        </div>

        {/* Slot Machine — scale-wrapped so the fixed 572×458 reel block fits
            on phones without clipping. Children all scale together so the
            itemHeight (130px) → targetOffset math stays consistent. The
            negative bottom margin reclaims the empty layout space left
            behind by the transform (transform paints smaller but doesn't
            shrink the layout box).
            Inline transform instead of Tailwind's scale-[0.6] because this
            project's Tailwind build emits the arbitrary-value scale class
            without a transform: declaration, so the class sets the CSS
            vars but never paints — the previous deploy silently no-op'd. */}
        <div
          className="mb-[-180px] sm:mb-0 sm:!transform-none"
          style={{ transform: 'scale(0.6)', transformOrigin: 'top' }}
        >
        <div
          className="relative rounded-2xl overflow-hidden mx-auto"
          style={{
            background: '#000',
            padding: '2px',
            boxShadow: '0 25px 50px rgba(0,0,0,0.8)',
            width: 'fit-content',
          }}
        >
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, #1c1c1e 0%, #0a0a0a 100%)',
              padding: '16px',
            }}
          >
            <div
              className="relative rounded-xl overflow-hidden"
              style={{ background: '#000', padding: '16px' }}
            >
              <div className="flex gap-3">
                {[0, 1, 2].map((reelIndex) => (
                  <div
                    key={reelIndex}
                    className="relative rounded-xl overflow-hidden"
                    style={{
                      width: '160px',
                      height: '390px',
                      background: 'linear-gradient(180deg, #a78bfa 0%, #8b5cf6 50%, #7c3aed 100%)',
                    }}
                  >
                    <div
                      className="absolute inset-0 flex flex-col"
                      style={{ transform: `translateY(${195 - 65 - reelOffsets[reelIndex]}px)` }}
                    >
                      {(allReelItems[reelIndex] || []).map((type, i) => (
                        <div key={i} className="w-full h-[130px] flex flex-col items-center justify-center flex-shrink-0 relative px-3">
                          <div className="absolute top-0 inset-x-3 h-[1px] bg-white/30 rounded-full" />
                          {type === 'jackpot' ? (
                            <span className="text-[24px] font-black italic uppercase" style={{ color: '#e62222', textShadow: '2px 2px 0 #1a1a1a' }}>JACKPOT</span>
                          ) : type === 'hof' ? (
                            <span className="text-[36px] font-black" style={{ color: '#f5c400', textShadow: '2px 2px 0 #705a00' }}>HOF</span>
                          ) : (
                            <span className="text-5xl">🍌</span>
                          )}
                          <div className="absolute bottom-0 inset-x-3 h-[1px] bg-black/30 rounded-full" />
                        </div>
                      ))}
                    </div>
                    {isReelStopped(reelIndex) && (
                      <div
                        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[130px] pointer-events-none z-20"
                        style={{
                          background: 'rgba(255,255,255,0.15)',
                          borderTop: '2px solid rgba(255,255,255,0.5)',
                          borderBottom: '2px solid rgba(255,255,255,0.5)'
                        }}
                      />
                    )}
                    <div className="absolute inset-x-0 top-0 h-12 pointer-events-none z-10" style={{ background: 'linear-gradient(180deg, #a78bfa 0%, transparent 100%)' }} />
                    <div className="absolute inset-x-0 bottom-0 h-10 pointer-events-none z-10" style={{ background: 'linear-gradient(0deg, #7c3aed 0%, transparent 100%)' }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>

        {/* Result text */}
        {phase === 'result' && draftType && slotAnimationDone && (
          <div className="mt-4 animate-result-appear">
            {draftType === 'jackpot' ? (
              <>
                <div className="flex items-center justify-center gap-3 mb-4">
                  <div className="text-5xl font-black" style={{ color: DRAFT_TYPES[draftType].color, textShadow: `0 0 30px ${DRAFT_TYPES[draftType].color}` }}>
                    JACKPOT!
                  </div>
                  <VerifiedBadge type="draft-type" draftType="jackpot" size="md" draftId={badgeDraftId} />
                </div>
                <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 mb-4 max-w-sm mx-auto text-left">
                  <p className="text-red-300 font-bold text-lg mb-3">Skip to the Finals</p>
                  <p className="text-white/70 text-sm">Win this league and go <span className="text-red-300 font-semibold">straight to the finals</span>, skipping two weeks of playoffs.</p>
                  <p className="text-white/40 text-xs mt-3">1 in 100 drafts are Jackpots</p>
                </div>
              </>
            ) : draftType === 'hof' ? (
              <>
                <div className="flex items-center justify-center gap-3 mb-4">
                  <div className="text-5xl font-black" style={{ color: DRAFT_TYPES[draftType].color, textShadow: `0 0 30px ${DRAFT_TYPES[draftType].color}` }}>
                    HALL OF FAME
                  </div>
                  <VerifiedBadge type="draft-type" draftType="hof" size="md" draftId={badgeDraftId} />
                </div>
                <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-xl p-4 mb-4 max-w-sm mx-auto text-left">
                  <p className="text-yellow-300 font-bold text-lg mb-3">Bonus Prizes</p>
                  <p className="text-white/70 text-sm">Compete for <span className="text-yellow-300 font-semibold">additional prizes</span> on top of regular weekly and season-long rewards.</p>
                  <p className="text-white/40 text-xs mt-3">5 in 100 drafts are HOF</p>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center gap-2 mb-2">
                <p className="text-white/70 text-2xl font-bold">Pro Draft</p>
                <VerifiedBadge type="draft-type" draftType="pro" size="md" draftId={badgeDraftId} />
              </div>
            )}
            {/* Always-on trust signal — the VerifiedBadge above is small
                and easy to miss. This line is the explicit Chainlink VRF
                callout so users know the result wasn't picked by SBS.
                Click the Verified pill above for the full Merkle proof. */}
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-emerald-300/90 bg-emerald-500/[0.06] border border-emerald-400/20 rounded-full px-3 py-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Verified by Chainlink VRF · click Verified above for proof</span>
            </div>
            {rngSeedData && (
              <div className="mt-2 text-xs text-white/60">
                {isVerifying ? 'Verifying fairness...' : isVerified ? 'Provably fair: verified' : 'Provably fair: pending'}
              </div>
            )}
            <p className="text-white/40 text-sm mt-2">Click anywhere or press X to close</p>
          </div>
        )}
      </div>
    </div>
  );
}
