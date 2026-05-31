'use client';

import React, { useState, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { wheelSegments, WHEEL_SEGMENT_ANGLE, type WheelSegment } from '@/lib/wheelConfig';
import type { WheelSpinOutcome } from '@/hooks/useWheelData';
import { startSpinSound, playWinSound, getWinTier } from '@/lib/wheelSounds';
import { ShareWinButton } from '@/components/share/ShareWinButton';
import { buildWheelShareCopy } from '@/lib/shareUtils';
import { verifySpinProof } from '@/lib/wheelMerkleClient';

interface BananaWheelProps {
  spinsAvailable: number;
  onSpin: () => Promise<WheelSpinOutcome | null>;
  onSpinComplete?: (outcome: WheelSpinOutcome, segment: WheelSegment | null) => void;
  onSpecialDraftWin?: (type: 'jackpot' | 'hof') => void;
}

function fireCelebration(segment: WheelSegment) {
  const isSpecial = segment.prizeType === 'custom' || (typeof segment.prizeValue === 'number' && segment.prizeValue >= 10);
  const duration = isSpecial ? 4000 : 2000;
  const end = Date.now() + duration;

  // SBS yellow + banana colors
  const colors = ['#F3E216', '#fbbf24', '#fcd34d', '#22c55e', '#a78bfa'];

  const frame = () => {
    confetti({
      particleCount: isSpecial ? 8 : 3,
      angle: 60 + Math.random() * 60,
      spread: 55 + Math.random() * 30,
      origin: { x: Math.random(), y: Math.random() * 0.3 },
      colors,
      scalar: isSpecial ? 1.2 : 0.9,
      drift: isSpecial ? 0.5 : 0,
      ticks: 200,
    });

    if (Date.now() < end) requestAnimationFrame(frame);
  };

  // Initial big burst
  confetti({
    particleCount: isSpecial ? 120 : 50,
    spread: isSpecial ? 120 : 80,
    origin: { y: 0.6 },
    colors,
    scalar: 1.3,
  });

  // Continued celebration
  requestAnimationFrame(frame);

  // Banana emojis for special wins
  if (isSpecial) {
    confetti({
      particleCount: 30,
      spread: 160,
      origin: { y: 0.5 },
      shapes: ['circle'],
      colors: ['#F3E216', '#fbbf24'],
      scalar: 2,
      ticks: 300,
    });
  }
}

function getPrizeEmoji(segment: WheelSegment): string {
  if (segment.id === 'jackpot') return '🎰';
  if (segment.id === 'hof') return '🏆';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 20) return '🍌';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 10) return '🔥';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 5) return '⭐';
  return '🎉';
}

function getPrizeMessage(segment: WheelSegment): string {
  if (segment.id === 'jackpot') return 'You hit the JACKPOT! 🎰';
  if (segment.id === 'hof') return 'Hall of Fame entry unlocked!';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 20) return 'Massive win! 🍌';
  if (typeof segment.prizeValue === 'number' && segment.prizeValue >= 10) return 'Big win!';
  return 'Added to your balance';
}

// The "big four" that get the over-the-top outro (screen shake + prize rain):
// Jackpot, HOF, 10 drafts, 20 drafts.
function isBigWin(segment: WheelSegment): boolean {
  return segment.id === 'jackpot' || segment.id === 'hof'
    || (typeof segment.prizeValue === 'number' && segment.prizeValue >= 10);
}

// The very top tier gets a harder shake + heavier rain.
function isHugeWin(segment: WheelSegment): boolean {
  return segment.id === 'jackpot' || (typeof segment.prizeValue === 'number' && segment.prizeValue >= 20);
}

// Rain the prize itself down the screen — banana for big draft hauls, 🎰 for
// jackpot, 🏆 for HOF, etc. (uses the same emoji as the result card).
function rainPrizes(segment: WheelSegment) {
  const emoji = getPrizeEmoji(segment);
  let shapes: ReturnType<typeof confetti.shapeFromText>[] | undefined;
  try {
    shapes = [confetti.shapeFromText({ text: emoji, scalar: 4 })];
  } catch {
    shapes = undefined; // older confetti without emoji shapes — fall back to default
  }
  const huge = isHugeWin(segment);
  // Keep raining for as long as the music celebrates (big-four outro is long).
  const end = Date.now() + (huge ? 5200 : 3600);
  const tick = () => {
    confetti({
      particleCount: huge ? 12 : 7,
      startVelocity: 0,            // no launch — just let them fall
      gravity: huge ? 0.9 : 0.7,
      ticks: 320,
      spread: 0,
      origin: { x: Math.random(), y: -0.12 }, // drop in from above the top edge
      scalar: huge ? 4 : 3,
      ...(shapes ? { shapes } : {}),
    });
    if (Date.now() < end) setTimeout(tick, huge ? 90 : 130);
  };
  tick();
}

const PENDING_SPIN_KEY = 'banana-wheel-pending-spin';
// Deceleration ("landing") duration once the RNG result is known — the
// wheel eases from its current free-spin position onto the winning segment.
// Exported so the page-level spin handler can freeze the global balance
// state for the same window (keeps the header's "draft passes / wheel
// spins" count from updating mid-spin, which would spoil the reveal).
// Landing (deceleration) duration. The landing is tuned for VELOCITY
// CONTINUITY: it starts at exactly the free-spin speed and eases out to a
// stop, so the wheel spins cleanly through and slows once — never slowing
// mid-spin and re-accelerating. See the landing math in spin().
export const SPIN_DURATION_MS = 2000;

// Free-spin (pre-result) phase: the wheel starts spinning at a constant
// speed the instant the user taps, while the RNG request is in flight, so
// it never sits frozen waiting on the network. Linear so we can estimate
// its live angle when the result lands and decelerate forward onto it.
const FREE_SPIN_MS = 8000;   // safety cap; the result almost always lands first
const FREE_SPIN_TURNS = 20;  // ~2.5 rev/s — fast and energetic
// Free-spin angular speed (deg/ms) — the landing matches this at hand-off.
const FREE_SPIN_DEG_PER_MS = (360 * FREE_SPIN_TURNS) / FREE_SPIN_MS;
// Landing easing ≈ ease-out-quad (initial slope 2, smooth stop). With the
// landing distance set to FREE_SPEED * DURATION / 2, the wheel leaves the
// free spin at the same speed and decelerates at a constant rate to rest.
const LANDING_EASING = 'cubic-bezier(0.25, 0.5, 0.5, 1)';

interface PendingSpin {
  outcome: WheelSpinOutcome;
  segmentId: string | null;
  startedAt: number;
  rotation: number;
}

export function BananaWheel({ spinsAvailable, onSpin, onSpinComplete, onSpecialDraftWin: _onSpecialDraftWin }: BananaWheelProps) {
  const [isSpinning, setIsSpinning] = useState(false);
  // 'free' = constant-speed spin while waiting on RNG; 'landing' = decel onto
  // the result; 'idle' = stopped (no transition). Drives the CSS transition.
  const [spinPhase, setSpinPhase] = useState<'idle' | 'free' | 'landing'>('idle');
  const freeSpinStartRef = useRef(0);
  const freeSpinStartRotationRef = useRef(0);
  const [rotation, setRotation] = useState(0);
  const [wonSegment, setWonSegment] = useState<WheelSegment | null>(null);
  const [wonSpinId, setWonSpinId] = useState<string | null>(null);
  const [wonProofStatus, setWonProofStatus] = useState<'unverified' | 'verified' | 'failed'>('unverified');
  const [wonProofMeta, setWonProofMeta] = useState<{ periodNumber: number; spinIndex: number; root: string } | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const resumedRef = useRef(false);

  const segmentAngle = WHEEL_SEGMENT_ANGLE;

  // On mount: check for a pending/completed spin that was interrupted
  React.useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    try {
      const raw = localStorage.getItem(PENDING_SPIN_KEY);
      if (!raw) return;
      const pending: PendingSpin = JSON.parse(raw);
      const elapsed = Date.now() - pending.startedAt;
      const segment = pending.segmentId ? wheelSegments.find(s => s.id === pending.segmentId) ?? null : null;

      if (elapsed < SPIN_DURATION_MS) {
        // Spin still in progress — resume the landing animation
        setSpinPhase('landing');
        setRotation(pending.rotation);
        setIsSpinning(true);
        const remaining = SPIN_DURATION_MS - elapsed;
        setTimeout(() => {
          setSpinPhase('idle');
          setIsSpinning(false);
          setWonSegment(segment);
          setWonSpinId(pending.outcome.spinId);
          setShowResult(true);
          localStorage.removeItem(PENDING_SPIN_KEY);
          if (segment) {
            fireCelebration(segment);
            playWinSound(getWinTier(segment));
            if (isBigWin(segment)) rainPrizes(segment);
          }
          if (onSpinComplete) onSpinComplete(pending.outcome, segment);
        }, remaining);
      } else {
        // Spin already finished — show result immediately
        setRotation(pending.rotation);
        setWonSegment(segment);
        setWonSpinId(pending.outcome.spinId);
        setShowResult(true);
        localStorage.removeItem(PENDING_SPIN_KEY);
        if (segment) {
          fireCelebration(segment);
        }
        if (onSpinComplete) onSpinComplete(pending.outcome, segment);
      }
    } catch { /* ignore corrupt localStorage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissResult = useCallback(() => {
    setWonSegment(null);
    setShowResult(false);
    localStorage.removeItem(PENDING_SPIN_KEY);
  }, []);

  // Estimate the wheel's live angle mid-free-spin (the free spin is linear,
  // so this matches the actual CSS-interpolated position).
  const estimateCurrentRotation = useCallback(() => {
    const elapsed = Math.min(Date.now() - freeSpinStartRef.current, FREE_SPIN_MS);
    return freeSpinStartRotationRef.current + (elapsed / FREE_SPIN_MS) * 360 * FREE_SPIN_TURNS;
  }, []);

  const spin = async () => {
    if (spinsAvailable <= 0 || isSpinning) return;

    setIsSpinning(true);
    setWonSegment(null);
    setSpinError(null);

    // Start spinning IMMEDIATELY at a constant speed, before/while the RNG
    // request is in flight, so the wheel moves the instant you tap instead of
    // freezing until the network responds.
    freeSpinStartRef.current = Date.now();
    freeSpinStartRotationRef.current = rotation;
    setSpinPhase('free');
    setRotation(rotation + 360 * FREE_SPIN_TURNS);

    // Music starts the INSTANT the wheel starts moving and loops for as long as
    // the spin takes. Previously it only fired after the RNG request resolved,
    // so it came in seconds late (after the free-spin was already underway).
    const stopSpinSound = startSpinSound();

    let outcome: WheelSpinOutcome | null = null;
    try {
      outcome = await onSpin();
    } catch (err) {
      console.error('[BananaWheel] spin error:', err);
      const msg = err instanceof Error ? err.message : 'Spin failed';
      setSpinError(msg);
    }

    if (!outcome) {
      stopSpinSound();
      // Stop where we currently are (no jump) and reset.
      setSpinPhase('idle');
      setRotation(estimateCurrentRotation());
      setIsSpinning(false);
      return;
    }

    // Decelerate from the live free-spin position onto the winning segment.
    // CSS transitions hand off from the current computed transform, so this
    // continues forward without a jump. For a CLEAN spin (no mid-slowdown +
    // re-accelerate), the landing distance is chosen so the ease-out leaves
    // the free spin at the SAME speed: with ease-out-quad (initial slope 2),
    // continuity means distance ≈ freeSpeed * duration / 2. We then snap the
    // whole-turn count to land exactly on the target angle.
    const current = estimateCurrentRotation();
    let angleToTarget = outcome.angle - (((current % 360) + 360) % 360);
    if (angleToTarget <= 0) angleToTarget += 360; // 0..360 forward to the target
    const idealDistance = (FREE_SPIN_DEG_PER_MS * SPIN_DURATION_MS) / 2;
    const fullRotations = Math.max(2, Math.round((idealDistance - angleToTarget) / 360));
    const deltaRotation = angleToTarget + 360 * fullRotations;

    const newRotation = current + deltaRotation;
    setSpinPhase('landing');
    setRotation(newRotation);

    const segment = wheelSegments.find((seg) => seg.id === outcome?.result) ?? null;

    // Persist spin state so it survives navigation
    try {
      const pending: PendingSpin = {
        outcome,
        segmentId: segment?.id ?? null,
        startedAt: Date.now(),
        rotation: newRotation,
      };
      localStorage.setItem(PENDING_SPIN_KEY, JSON.stringify(pending));
    } catch { /* ignore */ }

    // Verify the Merkle proof now (before the result modal shows) so the
    // "Verified ✓" badge can render alongside the prize. Pure crypto in
    // the browser, no network — runs in <1ms.
    if (outcome.proof) {
      const ok = verifySpinProof({
        spinIndex: outcome.proof.spinIndex,
        segmentId: outcome.result,
        proof: outcome.proof.path,
        root: outcome.proof.root,
      });
      setWonProofStatus(ok ? 'verified' : 'failed');
      setWonProofMeta({
        periodNumber: outcome.proof.periodNumber,
        spinIndex: outcome.proof.spinIndex,
        root: outcome.proof.root,
      });
    } else {
      setWonProofStatus('unverified');
      setWonProofMeta(null);
    }

    setTimeout(() => {
      setSpinPhase('idle');
      setIsSpinning(false);
      setWonSegment(segment);
      setWonSpinId(outcome.spinId);
      setShowResult(true);
      localStorage.removeItem(PENDING_SPIN_KEY);
      if (segment) {
        fireCelebration(segment);
        playWinSound(getWinTier(segment));
        // Big four (jackpot / HOF / 10 / 20): rain the prize down the screen.
        // The screen shake is applied to the result modal on mount below.
        if (isBigWin(segment)) rainPrizes(segment);
      }
      // Tier-aware outro: small wins fade quick, the big four keep the music
      // going crazy for several seconds.
      stopSpinSound(segment ? getWinTier(segment) : undefined);
      if (onSpinComplete) onSpinComplete(outcome, segment);
    }, SPIN_DURATION_MS);
  };

  return (
    <div className="flex flex-col items-center">
      {/* Wheel Container */}
      <div
        className={`group relative w-80 h-80 md:w-[28rem] md:h-[28rem] lg:w-[34rem] lg:h-[34rem] transition-transform duration-200 ${
          spinsAvailable > 0 && !isSpinning ? 'cursor-pointer hover:scale-[1.02]' : ''
        }`}
        onClick={spin}
      >
        {/* Pointer - Apple-style refined design */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 -mt-1">
          <div className="relative">
            <div
              className="w-0 h-0 border-l-[14px] border-r-[14px] border-t-[28px] border-l-transparent border-r-transparent border-t-[#fbbf24]"
              style={{
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
              }}
            />
            <div
              className="absolute top-[2px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[20px] border-l-transparent border-r-transparent border-t-[#fcd34d]"
            />
          </div>
        </div>


        {/* Wheel */}
        <div
          ref={wheelRef}
          className="w-full h-full rounded-full shadow-[0_4px_30px_rgba(0,0,0,0.4),inset_0_0_0_3px_rgba(255,255,255,0.1)] overflow-hidden"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinPhase === 'free'
              ? `transform ${FREE_SPIN_MS}ms linear`
              : spinPhase === 'landing'
                ? `transform ${SPIN_DURATION_MS}ms ${LANDING_EASING}`
                : 'none',
            background: 'linear-gradient(145deg, rgba(30,30,40,1) 0%, rgba(15,15,20,1) 100%)',
          }}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <defs>
              {/* Refined gradient for each segment */}
              {wheelSegments.map((segment, index) => (
                <linearGradient key={`grad-${index}`} id={`gradient-${index}`} x1="50%" y1="0%" x2="50%" y2="100%">
                  <stop offset="0%" stopColor={segment.color} stopOpacity="0.95" />
                  <stop offset="50%" stopColor={segment.color} stopOpacity="1" />
                  <stop offset="100%" stopColor={segment.color} stopOpacity="0.85" />
                </linearGradient>
              ))}
              {/* Subtle text shadow */}
              <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0.3" stdDeviation="0.2" floodColor="#000" floodOpacity="0.5"/>
              </filter>
              {/* Center gradient */}
              <radialGradient id="centerGradient">
                <stop offset="0%" stopColor="#2a2a3a" />
                <stop offset="100%" stopColor="#1a1a25" />
              </radialGradient>
              {/* Center highlight */}
              <radialGradient id="centerHighlight" cx="30%" cy="30%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
            </defs>

            {wheelSegments.map((segment, index) => {
              const startAngle = index * segmentAngle;
              const endAngle = (index + 1) * segmentAngle;
              const startRad = (startAngle - 90) * (Math.PI / 180);
              const endRad = (endAngle - 90) * (Math.PI / 180);

              const x1 = 50 + 50 * Math.cos(startRad);
              const y1 = 50 + 50 * Math.sin(startRad);
              const x2 = 50 + 50 * Math.cos(endRad);
              const y2 = 50 + 50 * Math.sin(endRad);

              const largeArcFlag = segmentAngle > 180 ? 1 : 0;

              const path = `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

              // Calculate text position - centered in the visible segment area
              const midAngle = (startAngle + endAngle) / 2 - 90;
              const midRad = midAngle * (Math.PI / 180);
              const textRadius = 33;
              const textX = 50 + textRadius * Math.cos(midRad);
              const textY = 50 + textRadius * Math.sin(midRad);

              // Smaller font for longer labels to fit better
              const fontSize = segment.label.length > 8 ? 2.6 : 3.2;

              return (
                <g key={index}>
                  <path
                    d={path}
                    fill={`url(#gradient-${index})`}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="0.3"
                  />
                  <text
                    x={textX}
                    y={textY}
                    fill="white"
                    fontSize={fontSize}
                    fontWeight="600"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${midAngle + 90}, ${textX}, ${textY})`}
                    filter="url(#textShadow)"
                    style={{
                      letterSpacing: '0.02em',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif'
                    }}
                  >
                    {segment.label}
                  </text>
                </g>
              );
            })}

            {/* Subtle inner ring */}
            <circle cx="50" cy="50" r="9" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />

            {/* Center circle with logo */}
            <circle cx="50" cy="50" r="7" fill="url(#centerGradient)" />
            <image
              href="/sbs-logo.png"
              x="44"
              y="44"
              width="12"
              height="12"
              preserveAspectRatio="xMidYMid meet"
            />
            <circle cx="50" cy="50" r="7" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
            <circle cx="50" cy="50" r="6.5" fill="none" stroke="rgba(251,191,36,0.5)" strokeWidth="0.8" />
          </svg>
        </div>

        {/* Outer ring - clean border */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: '3px solid rgba(251,191,36,0.8)',
          }}
        />

      </div>

      {/* Spin Count & Button - Apple-style */}
      <div className="mt-10 text-center">
        <p className="text-text-secondary mb-5 text-[15px] tracking-wide">
          <span className="text-banana font-semibold text-2xl">{spinsAvailable}</span>
          <span className="ml-2">spin{spinsAvailable !== 1 ? 's' : ''} available</span>
        </p>

        <button
          onClick={spin}
          disabled={spinsAvailable <= 0 || isSpinning}
          className={`
            relative px-20 py-4 text-xl font-semibold tracking-wide rounded-full
            transition-all duration-300 ease-out
            ${spinsAvailable <= 0 || isSpinning
              ? 'bg-[#2a2a35] text-[#666] cursor-not-allowed'
              : 'bg-gradient-to-b from-[#fbbf24] to-[#f59e0b] text-[#1a1a1f] shadow-[0_2px_8px_rgba(251,191,36,0.3)] hover:from-[#fcd34d] hover:to-[#fbbf24] hover:shadow-[0_4px_16px_rgba(251,191,36,0.4)] hover:scale-[1.02] active:scale-[0.98]'
            }
          `}
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif'
          }}
        >
          {isSpinning ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Spinning...
            </span>
          ) : 'Spin'}
        </button>

        {spinError && (
          <p className="mt-3 text-red-400 text-sm">{spinError}</p>
        )}

        {spinsAvailable <= 0 && !isSpinning && (
          <div className="mt-5 text-center text-[13px] text-text-muted">
            <p className="text-text-secondary mb-2 font-medium">Earn spins by:</p>
            <ul className="space-y-1">
              <li>Buying 10 draft passes → 1 free spin</li>
              <li>Completing Pick-10 milestones</li>
              <li>Referring friends who buy passes</li>
              <li>Engaging with SBS on X</li>
            </ul>
            <p className="mt-3 text-[12px] text-text-muted/70">See promos below for details.</p>
          </div>
        )}
      </div>

      {/* Prize Won Modal - Apple-style with confetti */}
      {wonSegment && showResult && !isSpinning && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50"
          style={{
            // Big wins jolt the whole screen as the prize card lands — the
            // hardest tier shakes bigger and twice as long.
            animation: isBigWin(wonSegment)
              ? `fadeIn 0.3s ease-out, ${isHugeWin(wonSegment) ? 'wheelShakeHard 1.1s' : 'wheelShake 0.7s'} cubic-bezier(0.36, 0.07, 0.19, 0.97) 0.05s`
              : 'fadeIn 0.3s ease-out',
          }}
          onClick={dismissResult}
        >
          <div
            className="relative overflow-hidden rounded-[28px] p-[1px]"
            style={{
              background: 'linear-gradient(145deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 50%, rgba(251,191,36,0.2) 100%)',
              animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="relative bg-[#1c1c1e] rounded-[27px] px-12 py-10 text-center min-w-[320px]"
              style={{
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif'
              }}
            >
              {/* Close X button */}
              <button
                onClick={dismissResult}
                className="absolute top-4 right-4 text-[#86868b] hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              {/* Animated glow behind emoji */}
              <div
                className="absolute top-8 left-1/2 -translate-x-1/2 w-28 h-28 rounded-full blur-3xl"
                style={{
                  backgroundColor: wonSegment.color,
                  opacity: 0.3,
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />

              <div
                className="relative text-6xl mb-6"
                style={{ animation: 'bounceIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
              >
                {getPrizeEmoji(wonSegment)}
              </div>

              <p className="text-[#32d74b] text-sm font-semibold tracking-wide uppercase mb-2">
                {wonSegment.id === 'jackpot' || wonSegment.id === 'hof' ? '🔥 LEGENDARY WIN!' : 'You Won!'}
              </p>

              <h3
                className="text-[28px] font-semibold text-white tracking-tight mb-3"
                style={{ animation: 'fadeIn 0.6s ease-out 0.2s both' }}
              >
                {wonSegment.label}
              </h3>

              <p
                className="text-[#86868b] text-sm mb-6"
                style={{ animation: 'fadeIn 0.6s ease-out 0.4s both' }}
              >
                {getPrizeMessage(wonSegment)}
              </p>

              {wonProofStatus === 'verified' && wonProofMeta && (
                <div
                  className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[12px] font-semibold"
                  style={{ animation: 'fadeIn 0.6s ease-out 0.5s both' }}
                  title={`Verified by Chainlink VRF · Round ${wonProofMeta.periodNumber} · spin #${wonProofMeta.spinIndex}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Verified by Chainlink VRF · spin #{wonProofMeta.spinIndex}
                </div>
              )}
              {wonProofStatus === 'failed' && (
                <div className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-300 text-[12px] font-semibold">
                  ⚠ Proof verification failed
                </div>
              )}

              {/* Info for Jackpot/HOF wins — auto-queued */}
              {(wonSegment.id === 'jackpot' || wonSegment.id === 'hof') && (
                <div className="bg-white/5 rounded-xl p-4 text-center space-y-2" style={{ animation: 'fadeIn 0.6s ease-out 0.6s both' }}>
                  <p className="text-white/70 text-sm font-medium">You&apos;ve been added to the {wonSegment.id === 'jackpot' ? 'Jackpot' : 'HOF'} draft queue!</p>
                  <p className="text-white/40 text-xs">
                    8-hour picks · Draft starts as soon as 10 winners fill the queue · We&apos;ll notify you!
                  </p>
                  <a href="/drafting" className="inline-block mt-2 text-banana text-xs font-semibold hover:underline">
                    View My Drafts →
                  </a>
                </div>
              )}

              {/* Share on X — every win gets a button; big wins earn credit toward a free spin */}
              {wonSpinId && (() => {
                const copy = buildWheelShareCopy(wonSegment.id);
                return (
                  <div className="mt-6" style={{ animation: 'fadeIn 0.6s ease-out 0.7s both' }}>
                    <ShareWinButton
                      shareType="wheel"
                      sourceId={wonSpinId}
                      prize={wonSegment.id}
                      tweetText={copy.text}
                      earnsCredit={copy.earnsCredit}
                    />
                  </div>
                );
              })()}

            </div>
          </div>
        </div>
      )}

      {/* Keyframe animations */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes bounceIn {
          from { opacity: 0; transform: scale(0.3); }
          50% { transform: scale(1.1); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes wheelShake {
          0%, 100% { transform: translate(0, 0) rotate(0); }
          15% { transform: translate(-7px, 4px) rotate(-0.8deg); }
          30% { transform: translate(6px, -5px) rotate(0.8deg); }
          45% { transform: translate(-6px, -3px) rotate(-0.6deg); }
          60% { transform: translate(5px, 4px) rotate(0.5deg); }
          75% { transform: translate(-3px, 2px) rotate(-0.3deg); }
          90% { transform: translate(2px, -1px) rotate(0.2deg); }
        }
        @keyframes wheelShakeHard {
          0%, 100% { transform: translate(0, 0) rotate(0); }
          6% { transform: translate(-18px, 10px) rotate(-1.8deg); }
          13% { transform: translate(17px, -12px) rotate(1.8deg); }
          20% { transform: translate(-19px, -8px) rotate(-1.6deg); }
          28% { transform: translate(16px, 11px) rotate(1.5deg); }
          38% { transform: translate(-14px, 7px) rotate(-1.2deg); }
          50% { transform: translate(13px, -8px) rotate(1deg); }
          62% { transform: translate(-10px, 6px) rotate(-0.8deg); }
          74% { transform: translate(8px, -5px) rotate(0.6deg); }
          86% { transform: translate(-4px, 3px) rotate(-0.3deg); }
        }
      `}</style>
    </div>
  );
}
