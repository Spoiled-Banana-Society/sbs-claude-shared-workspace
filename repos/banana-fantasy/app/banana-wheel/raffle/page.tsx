'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import type { RaffleResult } from '@/hooks/usePWAInstallPromo';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Deterministic color from wallet address */
function walletColor(wallet: string): string {
  let hash = 0;
  for (let i = 0; i < wallet.length; i++) {
    hash = wallet.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function useCountdown(endTime: string) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!endTime) return;
    const tick = () => {
      const diff = new Date(endTime).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('NOW');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return remaining;
}

// ── Reel Item ────────────────────────────────────────────────────────────

function ReelItem({ wallet, highlighted }: { wallet: string; highlighted?: boolean }) {
  const color = walletColor(wallet);
  return (
    <div className={`flex items-center gap-3 px-4 transition-all duration-500 ${highlighted ? 'scale-110' : ''}`}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
        style={{
          background: `linear-gradient(135deg, ${color}, ${color}88)`,
          boxShadow: highlighted ? `0 0 20px ${color}80` : 'none',
        }}
      >
        {wallet.slice(2, 4).toUpperCase()}
      </div>
      <span className={`font-mono text-sm ${highlighted ? 'text-banana font-bold' : 'text-white/70'}`}>
        {truncateWallet(wallet)}
      </span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

type Phase = 'loading' | 'waiting' | 'countdown' | 'spinning' | 'landing' | 'revealed';

export default function RafflePage() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [result, setResult] = useState<RaffleResult | null>(null);
  const [reelOffset, setReelOffset] = useState(0);
  const [winnerWallet, setWinnerWallet] = useState('');
  const [isCurrentUserWinner, setIsCurrentUserWinner] = useState(false);
  const animationRef = useRef<number | null>(null);
  const hasTriggeredDraw = useRef(false);

  const fireConfetti = useCallback(() => {
    // Big burst
    confetti({
      particleCount: 120,
      spread: 120,
      origin: { y: 0.5 },
      colors: ['#F3E216', '#fbbf24', '#fcd34d', '#22c55e', '#ffffff'],
    });
    // Delayed second burst
    setTimeout(() => {
      confetti({
        particleCount: 60,
        spread: 80,
        origin: { y: 0.6, x: 0.3 },
        colors: ['#F3E216', '#fbbf24', '#fcd34d'],
      });
      confetti({
        particleCount: 60,
        spread: 80,
        origin: { y: 0.6, x: 0.7 },
        colors: ['#F3E216', '#fbbf24', '#fcd34d'],
      });
    }, 600);
  }, []);

  // Fetch raffle data
  const fetchResult = useCallback(async () => {
    try {
      const params = user?.id ? `?promoId=pwa-install-promo&userId=${encodeURIComponent(user.id)}` : '?promoId=pwa-install-promo';
      const res = await fetch(`/api/promos/pwa-raffle-result${params}`);
      if (!res.ok) return null;
      return await res.json() as RaffleResult;
    } catch (err) {
      reportClientError({
        source: LOG_SOURCES.wheel.RAFFLE_FETCH_TIMEOUT,
        message: err instanceof Error ? err.message : String(err),
        route: 'banana-wheel/raffle',
        context: { userId: user?.id, promoId: 'pwa-install-promo' },
        stack: err instanceof Error ? err.stack : undefined,
      });
      return null;
    }
  }, [user?.id]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      const data = await fetchResult();
      if (!data) {
        setPhase('loading');
        return;
      }
      setResult(data);

      if (data.status === 'waiting') {
        setPhase('waiting');
      } else if (data.status === 'drawn') {
        // If drawn, show result directly (user arrived after draw)
        setWinnerWallet(data.winnerWallet ?? '');
        setIsCurrentUserWinner(data.isCurrentUserWinner ?? false);
        setPhase('revealed');
      } else if (data.status === 'no_entries') {
        setPhase('revealed');
      }
    };
    load();
  }, [fetchResult]);

  // Poll when waiting — check if draw time has been reached
  useEffect(() => {
    if (phase !== 'waiting' || !result?.drawTime) return;

    const check = () => {
      const now = Date.now();
      const draw = new Date(result.drawTime).getTime();
      if (now >= draw && !hasTriggeredDraw.current) {
        hasTriggeredDraw.current = true;
        triggerDraw();
      }
    };

    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result?.drawTime]);

  // Trigger the draw animation
  const triggerDraw = async () => {
    setPhase('spinning');

    // Fetch result (this triggers the actual server-side draw)
    const data = await fetchResult();
    if (!data || data.status !== 'drawn' || !data.winnerWallet) {
      setResult(data);
      setPhase('revealed');
      return;
    }

    setResult(data);
    setWinnerWallet(data.winnerWallet);
    setIsCurrentUserWinner(data.isCurrentUserWinner ?? false);

    // Build the reel — loop entrants to make a long strip, place winner near the end
    const entrants = data.entrants ?? [];
    if (entrants.length === 0) {
      setPhase('revealed');
      return;
    }

    // Reel animation
    const itemHeight = 70;
    const totalItems = Math.max(entrants.length * 3, 40); // At least 40 items to scroll through
    let currentOffset = 0;
    let speed = 45;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;

      // Decelerate after 2.5 seconds
      if (elapsed > 2500) {
        speed = Math.max(3, speed * 0.97);
      }

      currentOffset += speed;
      const totalHeight = totalItems * itemHeight;
      if (currentOffset > totalHeight) currentOffset -= totalHeight;

      setReelOffset(currentOffset);

      if (speed > 3) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Landing phase
        setPhase('landing');
        setTimeout(() => {
          setPhase('revealed');
          if (data.isCurrentUserWinner) {
            fireConfetti();
          }
        }, 800);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  };

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const countdown = useCountdown(result?.drawTime ?? '');
  const entrants = result?.entrants ?? [];

  // Build reel items (looped for scrolling)
  const reelItems: string[] = [];
  if (entrants.length > 0) {
    const loops = Math.max(3, Math.ceil(40 / entrants.length));
    for (let i = 0; i < loops; i++) {
      reelItems.push(...entrants);
    }
  }

  return (
    <div className="min-h-screen bg-[#000000] flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Background glow */}
      <div
        className="absolute inset-0 opacity-30 transition-all duration-1000"
        style={{
          background: phase === 'revealed' && isCurrentUserWinner
            ? 'radial-gradient(ellipse at center, rgba(251, 191, 36, 0.3) 0%, transparent 70%)'
            : phase === 'revealed'
              ? 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.05) 0%, transparent 70%)'
              : 'radial-gradient(ellipse at center, rgba(251, 191, 36, 0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md mx-auto text-center">
        {/* Header */}
        <div className="mb-8">
          <p className="text-white/40 text-xs font-medium uppercase tracking-[0.2em] mb-3">
            PWA Install Raffle
          </p>
          <h1 className="text-white text-2xl font-bold tracking-tight">
            {phase === 'revealed' && result?.status === 'no_entries'
              ? 'No Entries'
              : phase === 'revealed'
                ? 'Winner Drawn'
                : 'Win 5 Free Spins'}
          </h1>
          {result && result.entrantCount > 0 && (
            <p className="text-white/30 text-sm mt-2">{result.entrantCount} participants</p>
          )}
        </div>

        {/* Loading */}
        {phase === 'loading' && (
          <div className="flex justify-center py-20">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2.5 h-2.5 bg-banana/40 rounded-full animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        )}

        {/* Waiting — countdown + entrant list */}
        {phase === 'waiting' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            {/* Countdown */}
            <div className="mb-8">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Draw starts in</p>
              <div className="text-banana font-mono font-bold text-4xl tabular-nums">
                {countdown === 'NOW' ? (
                  <span className="animate-pulse">Drawing...</span>
                ) : countdown}
              </div>
            </div>

            {/* Entrant list */}
            {entrants.length > 0 && (
              <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.08] p-4 max-h-[300px] overflow-y-auto">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Participants</p>
                <div className="space-y-2">
                  {entrants.map((wallet, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                        style={{ background: `linear-gradient(135deg, ${walletColor(wallet)}, ${walletColor(wallet)}88)` }}
                      >
                        {wallet.slice(2, 4).toUpperCase()}
                      </div>
                      <span className="font-mono text-xs text-white/50">{truncateWallet(wallet)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Spinning / Landing — reel animation */}
        {(phase === 'spinning' || phase === 'landing') && (
          <div className="relative mb-8">
            {/* Glow */}
            <div
              className="absolute -inset-8 rounded-[40px] blur-3xl transition-all duration-1000"
              style={{
                backgroundColor: phase === 'landing' ? 'rgba(251, 191, 36, 0.3)' : 'rgba(255, 255, 255, 0.03)',
                opacity: phase === 'landing' ? 0.6 : 0.3,
              }}
            />

            {/* Glass container */}
            <div className="relative bg-white/[0.03] backdrop-blur-xl rounded-[32px] p-6 border border-white/[0.08] shadow-2xl">
              <div className="relative h-[350px] overflow-hidden rounded-2xl">
                {/* Top fade */}
                <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black to-transparent z-10" />
                {/* Bottom fade */}
                <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black to-transparent z-10" />
                {/* Center highlight */}
                <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[70px] border-y border-banana/30 z-20 pointer-events-none bg-banana/[0.03]" />

                {/* Scrolling reel */}
                <div
                  className="absolute w-full"
                  style={{ transform: `translateY(-${reelOffset % (reelItems.length * 70)}px)` }}
                >
                  {reelItems.map((wallet, idx) => (
                    <div key={idx} className="h-[70px] flex items-center">
                      <ReelItem wallet={wallet} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Pulsing dots during spin */}
            {phase === 'spinning' && (
              <div className="flex justify-center mt-6 gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 bg-white/40 rounded-full animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Revealed */}
        <AnimatePresence>
          {phase === 'revealed' && result?.status === 'drawn' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            >
              {/* Winner card */}
              <div className={`rounded-2xl p-6 mb-6 ${
                isCurrentUserWinner
                  ? 'bg-banana/10 border-2 border-banana/40'
                  : 'bg-white/[0.03] border border-white/[0.08]'
              }`}>
                {isCurrentUserWinner ? (
                  <>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
                      className="text-5xl mb-4"
                    >
                      🎉
                    </motion.div>
                    <h2 className="text-banana text-2xl font-bold mb-2">YOU WON!</h2>
                    <p className="text-white/60 text-sm">5 free spins have been added to your account</p>
                  </>
                ) : (
                  <>
                    <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Winner</p>
                    <ReelItem wallet={winnerWallet} highlighted />
                    <p className="text-white/30 text-xs mt-4">
                      {result.entrantCount} people entered — thanks for participating!
                    </p>
                  </>
                )}
              </div>

              {/* Proof of fairness */}
              {result.seed && (
                <details className="text-left mb-6">
                  <summary className="text-white/20 text-[11px] cursor-pointer hover:text-white/40 transition-colors">
                    Provably fair — view seed
                  </summary>
                  <div className="mt-2 p-3 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <p className="text-white/30 text-[10px] font-mono break-all">{result.seed}</p>
                    <p className="text-white/20 text-[10px] mt-1">
                      Winner index = floor(seededRandomFloat(seed) * {result.entrantCount})
                    </p>
                  </div>
                </details>
              )}

              {/* CTA */}
              {isCurrentUserWinner ? (
                <Link
                  href="/banana-wheel"
                  className="inline-block px-10 py-4 bg-banana text-black font-bold rounded-full text-sm hover:bg-banana/90 transition-colors shadow-lg shadow-banana/20"
                >
                  Spin the Wheel
                </Link>
              ) : (
                <Link
                  href="/"
                  className="inline-block px-10 py-4 bg-white/[0.06] text-white/70 font-semibold rounded-full text-sm hover:bg-white/[0.1] transition-colors"
                >
                  Back to Home
                </Link>
              )}
            </motion.div>
          )}

          {phase === 'revealed' && result?.status === 'no_entries' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="text-white/40 text-sm mb-6">No one entered the raffle this time.</p>
              <Link
                href="/"
                className="inline-block px-10 py-4 bg-white/[0.06] text-white/70 font-semibold rounded-full text-sm hover:bg-white/[0.1] transition-colors"
              >
                Back to Home
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
