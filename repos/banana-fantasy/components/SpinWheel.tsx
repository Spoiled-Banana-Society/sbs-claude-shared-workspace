'use client';

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import confetti from 'canvas-confetti';

// --- Types ---

export interface WheelSlice {
  id: string;
  label: string;
  color: string;
  /** Display emoji for result screen */
  emoji?: string;
  /** Weight for visual segment sizing (doesn't determine outcome — RNG does) */
  weight?: number;
}

export interface SpinResult {
  /** Index of winning slice */
  winningIndex: number;
  /** RNG event ID for verification */
  eventId?: string;
  /** Commitment hash (shown pre-spin) */
  commitment?: string;
  /** Server seed (shown post-reveal) */
  serverSeed?: string;
  /** Human-readable prize description */
  prize: string;
}

interface SpinWheelProps {
  /** Wheel slices (segments) */
  slices: WheelSlice[];
  /** Called when user taps spin — should call backend RNG and return result */
  onSpin: () => Promise<SpinResult | null>;
  /** Called after spin animation completes */
  onComplete?: (result: SpinResult) => void;
  /** Number of spins available (0 = disabled) */
  spinsAvailable?: number;
  /** Wheel diameter in px (default 320) */
  size?: number;
  /** Show provably fair verification link */
  showVerification?: boolean;
  /** Custom CTA text */
  spinButtonText?: string;
  /** Whether to disable the spin button */
  disabled?: boolean;
}

// --- Confetti helpers ---

const SBS_COLORS = ['#F3E216', '#fbbf24', '#fcd34d', '#22c55e', '#a78bfa', '#ef4444'];

function fireWinConfetti(isSpecial: boolean) {
  const duration = isSpecial ? 4000 : 2000;
  const end = Date.now() + duration;

  // Big initial burst
  confetti({
    particleCount: isSpecial ? 150 : 60,
    spread: isSpecial ? 140 : 90,
    origin: { y: 0.5 },
    colors: SBS_COLORS,
    scalar: 1.3,
    ticks: 250,
  });

  const frame = () => {
    confetti({
      particleCount: isSpecial ? 6 : 2,
      angle: 60 + Math.random() * 60,
      spread: 50 + Math.random() * 40,
      origin: { x: Math.random(), y: Math.random() * 0.4 },
      colors: SBS_COLORS,
      scalar: isSpecial ? 1.1 : 0.8,
      ticks: 150,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// --- SVG Wheel rendering ---

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function labelPosition(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const mid = (startAngle + endAngle) / 2;
  return polarToCartesian(cx, cy, r * 0.65, mid);
}

// --- Component ---

export function SpinWheel({
  slices,
  onSpin,
  onComplete,
  spinsAvailable = 1,
  size = 320,
  showVerification = true,
  spinButtonText,
  disabled = false,
}: SpinWheelProps) {
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [verifyExpanded, setVerifyExpanded] = useState(false);

  const rotation = useMotionValue(0);
  const currentRotation = useRef(0);
  const hasSpun = useRef(false);

  // Glow effect based on rotation speed
  const glowOpacity = useTransform(rotation, (_v) => {
    // Higher glow when spinning fast
    return spinning ? 0.6 : 0.2;
  });

  const segmentAngle = 360 / slices.length;
  const half = size / 2;
  const radius = half - 4;

  const handleSpin = useCallback(async () => {
    if (spinning || disabled || spinsAvailable <= 0) return;

    setSpinning(true);
    setShowResult(false);
    setResult(null);
    setVerifyExpanded(false);
    hasSpun.current = true;

    // Start spinning IMMEDIATELY at a constant speed the instant the user
    // taps, BEFORE/while the backend RNG request is in flight. Previously we
    // awaited the network call first, so on mobile the wheel sat frozen for
    // ~5s before moving. We decelerate onto the real winning segment once the
    // result lands.
    const FREE_SPIN_DEG_PER_SEC = 360 / 0.7; // ~0.7s per revolution
    const FREE_SPIN_MAX_SEC = 30; // safety cap — the result almost always lands first
    const freeSpin = animate(
      rotation,
      currentRotation.current + FREE_SPIN_DEG_PER_SEC * FREE_SPIN_MAX_SEC,
      { duration: FREE_SPIN_MAX_SEC, ease: 'linear' },
    );

    let spinResult: SpinResult | null = null;
    try {
      // Backend RNG result — runs in parallel with the free spin above.
      spinResult = await onSpin();
    } catch {
      freeSpin.stop();
      currentRotation.current = rotation.get();
      setSpinning(false);
      return;
    }
    if (!spinResult) {
      freeSpin.stop();
      currentRotation.current = rotation.get();
      setSpinning(false);
      return;
    }

    // Stop the free spin and decelerate from wherever we currently are onto
    // the winning segment.
    freeSpin.stop();
    const now = rotation.get();

    // Wheel rotates clockwise; segment i's center sits at `targetOffset`
    // measured clockwise from the top pointer in the wheel's own coords, so
    // the final rotation (mod 360) must be (360 - targetOffset) to land that
    // segment under the pointer.
    const targetOffset = spinResult.winningIndex * segmentAngle + segmentAngle / 2;
    const desiredMod = (((360 - targetOffset) % 360) + 360) % 360;
    const extraSpins = (3 + Math.random() * 2) * 360; // a few decel revolutions
    const minTarget = now + extraSpins;
    const targetRotation = minTarget + ((((desiredMod - (minTarget % 360)) % 360) + 360) % 360);

    try {
      await animate(rotation, targetRotation, {
        duration: 3 + Math.random() * 1.5,
        ease: [0.2, 0.8, 0.3, 1], // Custom cubic-bezier for realistic deceleration
        onComplete: () => {
          currentRotation.current = targetRotation;
        },
      });
    } catch {
      currentRotation.current = rotation.get();
      setSpinning(false);
      return;
    }

    // Show result
    setResult(spinResult);
    setShowResult(true);
    setSpinning(false);

    // Fire confetti
    const slice = slices[spinResult.winningIndex];
    const isSpecial = slice?.id === 'jackpot' || slice?.id === 'hof' ||
      (typeof slice?.weight === 'number' && slice.weight <= 0.02);
    fireWinConfetti(isSpecial);

    onComplete?.(spinResult);
  }, [spinning, disabled, spinsAvailable, onSpin, onComplete, slices, segmentAngle, rotation]);

  const winningSlice = result ? slices[result.winningIndex] : null;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Wheel container */}
      <div className="relative" style={{ width: size, height: size }}>
        {/* Outer glow ring */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow: `0 0 30px rgba(243, 226, 22, ${spinning ? 0.5 : 0.15}), 0 0 60px rgba(243, 226, 22, ${spinning ? 0.3 : 0.05})`,
            opacity: glowOpacity,
          }}
          animate={{ opacity: spinning ? 0.8 : 0.3 }}
          transition={{ duration: 0.5 }}
        />

        {/* Pointer (top center) */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-20">
          <div className="w-0 h-0 border-l-[12px] border-r-[12px] border-t-[20px] border-l-transparent border-r-transparent border-t-banana drop-shadow-lg" />
        </div>

        {/* SVG Wheel */}
        <motion.div
          style={{ rotate: rotation }}
          className="w-full h-full"
        >
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="drop-shadow-2xl"
          >
            {/* Wheel border */}
            <circle cx={half} cy={half} r={radius + 2} fill="none" stroke="#F3E216" strokeWidth="3" opacity="0.4" />

            {/* Segments */}
            {slices.map((slice, i) => {
              const startAngle = i * segmentAngle;
              const endAngle = startAngle + segmentAngle;
              const path = describeArc(half, half, radius, startAngle, endAngle);
              const labelPos = labelPosition(half, half, radius, startAngle, endAngle);

              return (
                <g key={slice.id}>
                  <path d={path} fill={slice.color} stroke="#1a1a2e" strokeWidth="1.5" />
                  {/* Segment divider highlight */}
                  <path d={path} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                  {/* Label */}
                  <text
                    x={labelPos.x}
                    y={labelPos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize={Math.max(9, Math.min(13, 160 / slices.length))}
                    fontWeight="bold"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}
                  >
                    {slice.emoji && (
                      <tspan x={labelPos.x} dy="-0.5em" fontSize={Math.max(12, Math.min(18, 200 / slices.length))}>
                        {slice.emoji}
                      </tspan>
                    )}
                    <tspan x={labelPos.x} dy={slice.emoji ? '1.3em' : '0'}>
                      {slice.label}
                    </tspan>
                  </text>
                </g>
              );
            })}

            {/* Center hub */}
            <circle cx={half} cy={half} r={size * 0.1} fill="#1a1a2e" stroke="#F3E216" strokeWidth="2" />
            <text
              x={half}
              y={half}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#F3E216"
              fontSize="14"
              fontWeight="bold"
            >
              🍌
            </text>
          </svg>
        </motion.div>

        {/* Pulsing ring when ready to spin */}
        {!spinning && spinsAvailable > 0 && !showResult && (
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-banana/40"
            animate={{ scale: [1, 1.05, 1], opacity: [0.4, 0.8, 0.4] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          />
        )}
      </div>

      {/* Spin button */}
      {!showResult && (
        <motion.button
          whileHover={!spinning && !disabled ? { scale: 1.05 } : {}}
          whileTap={!spinning && !disabled ? { scale: 0.95 } : {}}
          onClick={handleSpin}
          disabled={spinning || disabled || spinsAvailable <= 0}
          className={`
            px-8 py-3.5 rounded-2xl font-bold text-base transition-all
            ${spinning
              ? 'bg-bg-tertiary text-text-muted cursor-wait'
              : spinsAvailable <= 0 || disabled
                ? 'bg-bg-tertiary text-text-muted cursor-not-allowed opacity-50'
                : 'bg-banana text-black hover:bg-banana/90 shadow-lg shadow-banana/20'
            }
          `}
        >
          {spinning ? (
            <span className="flex items-center gap-2">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                className="inline-block"
              >
                🍌
              </motion.span>
              Spinning...
            </span>
          ) : spinsAvailable <= 0 ? (
            'No Spins Left'
          ) : (
            spinButtonText || `🎰 Spin the Wheel${spinsAvailable > 1 ? ` (${spinsAvailable})` : ''}`
          )}
        </motion.button>
      )}

      {/* Result display */}
      <AnimatePresence>
        {showResult && result && winningSlice && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="w-full max-w-sm"
          >
            {/* Prize card */}
            <div
              className="rounded-2xl p-6 text-center space-y-3 border"
              style={{
                backgroundColor: `${winningSlice.color}15`,
                borderColor: `${winningSlice.color}40`,
              }}
            >
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 250, damping: 15, delay: 0.2 }}
                className="text-5xl"
              >
                {winningSlice.emoji || '🎉'}
              </motion.div>
              <motion.h3
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-xl font-bold text-text-primary"
              >
                {result.prize}
              </motion.h3>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-sm text-text-secondary"
              >
                {winningSlice.label}
              </motion.p>

              {/* Provably Fair badge */}
              {showVerification && result.eventId && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 }}
                  className="pt-3 border-t border-bg-tertiary"
                >
                  <button
                    onClick={() => setVerifyExpanded(!verifyExpanded)}
                    className="flex items-center gap-1.5 mx-auto text-xs text-text-muted hover:text-banana transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    Provably Fair
                    <motion.span
                      animate={{ rotate: verifyExpanded ? 180 : 0 }}
                      className="inline-block"
                    >
                      ▾
                    </motion.span>
                  </button>

                  <AnimatePresence>
                    {verifyExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden mt-3 text-left space-y-2"
                      >
                        <div className="bg-bg-primary rounded-xl p-3 space-y-1.5">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-text-muted">Event ID</span>
                            <span className="text-text-primary font-mono truncate ml-2 max-w-[180px]">{result.eventId}</span>
                          </div>
                          {result.commitment && (
                            <div className="flex justify-between text-[11px]">
                              <span className="text-text-muted">Commitment</span>
                              <span className="text-text-primary font-mono truncate ml-2 max-w-[180px]">{result.commitment.slice(0, 16)}...</span>
                            </div>
                          )}
                          {result.serverSeed && (
                            <div className="flex justify-between text-[11px]">
                              <span className="text-text-muted">Server Seed</span>
                              <span className="text-text-primary font-mono truncate ml-2 max-w-[180px]">{result.serverSeed.slice(0, 16)}...</span>
                            </div>
                          )}
                          <a
                            href={`/api/rng/verify/${result.eventId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-center text-[11px] text-banana hover:underline mt-2"
                          >
                            Verify on-chain →
                          </a>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Default BBB4 wheel slices (re-export convenience) ---

export const BBB4_SLICES: WheelSlice[] = [
  { id: 'draft-1-a', label: '1 Draft', color: '#94a3b8', emoji: '🎟️', weight: 0.155 },
  { id: 'draft-5-a', label: '5 Drafts', color: '#22c55e', emoji: '🍀', weight: 0.0125 },
  { id: 'draft-1-b', label: '1 Draft', color: '#64748b', emoji: '🎟️', weight: 0.155 },
  { id: 'jackpot', label: 'Jackpot', color: '#ef4444', emoji: '🎰', weight: 0.01 },
  { id: 'draft-1-c', label: '1 Draft', color: '#94a3b8', emoji: '🎟️', weight: 0.155 },
  { id: 'draft-10', label: '10 Drafts', color: '#a78bfa', emoji: '🔥', weight: 0.01 },
  { id: 'draft-1-d', label: '1 Draft', color: '#64748b', emoji: '🎟️', weight: 0.155 },
  { id: 'hof', label: 'HOF', color: '#d4af37', emoji: '🏆', weight: 0.02 },
  { id: 'draft-1-e', label: '1 Draft', color: '#94a3b8', emoji: '🎟️', weight: 0.155 },
  { id: 'draft-5-b', label: '5 Drafts', color: '#22c55e', emoji: '🍀', weight: 0.0125 },
  { id: 'draft-1-f', label: '1 Draft', color: '#64748b', emoji: '🎟️', weight: 0.155 },
  { id: 'draft-20', label: '20 Drafts', color: '#f59e0b', emoji: '🍌', weight: 0.005 },
];
