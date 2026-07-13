'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────────────────

export interface RevealPlayer {
  playerId: string;
  displayName: string;
  team: string;
  position: string;
  pickNum: number;
  round: number;
  projectedPoints?: number;
}

interface TeamRevealProps {
  draftId: string;
  players: RevealPlayer[];
  draftLevel?: string;
  walletAddress?: string;
  isLoading?: boolean;
  error?: string | null;
}

// ─── Position Colors ─────────────────────────────────────────────────────

const POSITION_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  QB: { bg: 'from-red-600/20 to-red-900/20', border: 'border-red-500/40', text: 'text-red-400', glow: 'rgba(239,68,68,0.3)' },
  RB: { bg: 'from-blue-600/20 to-blue-900/20', border: 'border-blue-500/40', text: 'text-blue-400', glow: 'rgba(59,130,246,0.3)' },
  WR: { bg: 'from-green-600/20 to-green-900/20', border: 'border-green-500/40', text: 'text-green-400', glow: 'rgba(34,197,94,0.3)' },
  TE: { bg: 'from-orange-600/20 to-orange-900/20', border: 'border-orange-500/40', text: 'text-orange-400', glow: 'rgba(249,115,22,0.3)' },
  DST: { bg: 'from-purple-600/20 to-purple-900/20', border: 'border-purple-500/40', text: 'text-purple-400', glow: 'rgba(168,85,247,0.3)' },
  K: { bg: 'from-yellow-600/20 to-yellow-900/20', border: 'border-yellow-500/40', text: 'text-yellow-400', glow: 'rgba(234,179,8,0.3)' },
};

function getPositionStyle(pos: string) {
  const key = pos.toUpperCase().replace(/[0-9]/g, '');
  return POSITION_COLORS[key] || POSITION_COLORS.WR;
}

// ─── Grade Calculator ────────────────────────────────────────────────────

function calculateGrade(players: RevealPlayer[]): { grade: string; color: string; message: string } {
  // Simple grade based on projected points and pick efficiency
  const totalProjected = players.reduce((sum, p) => sum + (p.projectedPoints || 0), 0);
  const avgPick = players.reduce((sum, p) => sum + p.pickNum, 0) / (players.length || 1);

  // Approximate grading (will be more accurate with real projection data)
  const positionsCovered = new Set(players.map(p => p.position.replace(/[0-9]/g, ''))).size;
  const diversityBonus = positionsCovered >= 4 ? 1 : 0;

  let score = 0;
  if (totalProjected > 0) {
    // Real projections available
    score = totalProjected > 200 ? 5 : totalProjected > 160 ? 4 : totalProjected > 120 ? 3 : totalProjected > 80 ? 2 : 1;
  } else {
    // No projections — grade on draft position diversity
    score = diversityBonus + (avgPick < 5 ? 3 : avgPick < 8 ? 2 : 1);
  }

  if (score >= 5) return { grade: 'A+', color: 'text-green-400', message: 'Elite draft! Championship caliber.' };
  if (score >= 4) return { grade: 'A', color: 'text-green-400', message: 'Strong roster with high upside.' };
  if (score >= 3) return { grade: 'B+', color: 'text-blue-400', message: 'Solid foundation. Watch the waiver wire.' };
  if (score >= 2) return { grade: 'B', color: 'text-blue-400', message: 'Good depth. Needs a breakout star.' };
  return { grade: 'C+', color: 'text-yellow-400', message: 'Sleeper picks could surprise everyone.' };
}

// ─── Strengths Analysis ──────────────────────────────────────────────────

function analyzeStrengths(players: RevealPlayer[]): string[] {
  const strengths: string[] = [];
  const positions = players.map(p => p.position.replace(/[0-9]/g, ''));
  const posCount: Record<string, number> = {};
  positions.forEach(p => { posCount[p] = (posCount[p] || 0) + 1; });

  if (posCount['WR'] && posCount['WR'] >= 3) strengths.push('🎯 Deep at WR');
  if (posCount['RB'] && posCount['RB'] >= 2) strengths.push('🏃 Strong RB corps');
  if (posCount['QB']) strengths.push('🎯 QB secured');
  if (posCount['TE']) strengths.push('💪 TE advantage');
  if (posCount['DST']) strengths.push('🛡️ Defense locked in');

  const earlyPicks = players.filter(p => p.pickNum <= 3);
  if (earlyPicks.length >= 2) strengths.push('⚡ Premium picks used well');

  if (strengths.length === 0) strengths.push('🍌 Balanced roster');

  return strengths.slice(0, 4);
}

// ─── Component ───────────────────────────────────────────────────────────

export function TeamReveal({ draftId, players, draftLevel, walletAddress: _walletAddress, isLoading, error }: TeamRevealProps) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [allRevealed, setAllRevealed] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const gradeInfo = useMemo(() => calculateGrade(players), [players]);
  const strengths = useMemo(() => analyzeStrengths(players), [players]);
  const totalProjected = useMemo(() => players.reduce((s, p) => s + (p.projectedPoints || 0), 0), [players]);

  // Staggered reveal sequence
  useEffect(() => {
    if (players.length === 0 || isLoading) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    players.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setRevealedCount(i + 1);
      }, 800 + i * 600)); // 0.6s between each reveal
    });

    // All revealed
    timers.push(setTimeout(() => {
      setAllRevealed(true);
      // Confetti burst
      confetti({
        particleCount: 80,
        spread: 100,
        origin: { y: 0.6 },
        colors: ['#F3E216', '#fbbf24', '#22c55e', '#3b82f6', '#a78bfa'],
      });
    }, 800 + players.length * 600 + 300));

    // Show summary
    timers.push(setTimeout(() => {
      setShowSummary(true);
    }, 800 + players.length * 600 + 1200));

    return () => timers.forEach(clearTimeout);
  }, [players, isLoading]);

  // Skip animation
  const skipToEnd = () => {
    setRevealedCount(players.length);
    setAllRevealed(true);
    setShowSummary(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-bounce">🍌</div>
          <p className="text-white/50 animate-pulse">Loading your team...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">😔</div>
          <h2 className="text-white text-xl font-bold mb-2">Couldn&apos;t load your team</h2>
          <p className="text-white/50 mb-6 text-sm">{error}</p>
          <Link href="/my-teams" className="px-5 py-2.5 bg-[#F3E216] text-black font-semibold rounded-lg">
            View Standings
          </Link>
        </div>
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-white text-xl font-bold mb-2">No Draft Results</h2>
          <p className="text-white/50 mb-6 text-sm">This draft hasn&apos;t completed yet or no picks were found.</p>
          <Link href="/drafting" className="px-5 py-2.5 bg-[#F3E216] text-black font-semibold rounded-lg">
            Back to Drafts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 sm:px-8 py-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <p className="text-[#F3E216] text-sm font-semibold tracking-widest uppercase mb-2">
            {draftLevel || 'Pro'} Draft Complete
          </p>
          <h1 className="text-white text-3xl sm:text-4xl font-bold mb-1">Your Team</h1>
          <p className="text-white/40 text-sm">Draft {draftId}</p>

          {/* Skip button during animation */}
          {!allRevealed && (
            <button
              onClick={skipToEnd}
              className="mt-4 text-white/30 text-xs hover:text-white/60 transition-colors"
            >
              Skip animation →
            </button>
          )}
        </motion.div>

        {/* Player Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {players.map((player, index) => {
            const isRevealed = index < revealedCount;
            const posStyle = getPositionStyle(player.position);

            return (
              <div key={player.playerId || index} className="perspective-1000">
                <AnimatePresence mode="wait">
                  {!isRevealed ? (
                    /* Card Back */
                    <motion.div
                      key="back"
                      initial={{ rotateY: 0 }}
                      className={`relative h-[160px] rounded-xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 flex items-center justify-center overflow-hidden`}
                    >
                      <div className="text-4xl opacity-20">🍌</div>
                      <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/[0.03]" />
                      {/* Shimmer effect */}
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                        animate={{ x: ['-100%', '200%'] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      />
                    </motion.div>
                  ) : (
                    /* Card Front */
                    <motion.div
                      key="front"
                      initial={{ rotateY: -90, opacity: 0 }}
                      animate={{ rotateY: 0, opacity: 1 }}
                      transition={{
                        type: 'spring',
                        stiffness: 200,
                        damping: 20,
                        duration: 0.6,
                      }}
                      className={`relative h-[160px] rounded-xl bg-gradient-to-br ${posStyle.bg} border ${posStyle.border} overflow-hidden`}
                      style={{ boxShadow: `0 4px 20px ${posStyle.glow}` }}
                    >
                      {/* Content */}
                      <div className="relative z-10 h-full p-4 flex flex-col justify-between">
                        {/* Top row: position + pick */}
                        <div className="flex items-start justify-between">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${posStyle.text} bg-black/30`}>
                            {player.position}
                          </span>
                          <span className="text-white/30 text-xs">
                            Pick #{player.pickNum}
                          </span>
                        </div>

                        {/* Player info */}
                        <div>
                          <h3 className="text-white font-bold text-lg leading-tight mb-0.5">
                            {player.displayName}
                          </h3>
                          <p className="text-white/50 text-sm">{player.team}</p>
                        </div>

                        {/* Bottom: projected points */}
                        <div className="flex items-end justify-between">
                          <div>
                            {player.projectedPoints ? (
                              <p className="text-white/70 text-xs">
                                <span className="text-white font-semibold">{player.projectedPoints.toFixed(1)}</span> proj pts
                              </p>
                            ) : (
                              <p className="text-white/30 text-xs">Rd {player.round}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Subtle diagonal stripe */}
                      <div className="absolute -right-8 -top-8 w-24 h-24 rotate-45 bg-white/[0.03]" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Team Summary */}
        <AnimatePresence>
          {showSummary && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            >
              {/* Grade Card */}
              <div className="bg-white/5 rounded-2xl border border-white/10 p-6 sm:p-8 mb-6">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  {/* Grade circle */}
                  <div className="flex-shrink-0">
                    <div className="w-24 h-24 rounded-full bg-white/5 border-2 border-white/10 flex items-center justify-center">
                      <span className={`text-4xl font-black ${gradeInfo.color}`}>
                        {gradeInfo.grade}
                      </span>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="text-center sm:text-left flex-1">
                    <h2 className="text-white text-xl font-bold mb-1">Draft Grade</h2>
                    <p className="text-white/50 text-sm mb-3">{gradeInfo.message}</p>

                    {totalProjected > 0 && (
                      <p className="text-white/70 text-sm">
                        Total Projected: <span className="text-white font-semibold">{totalProjected.toFixed(1)} pts</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Strengths */}
                <div className="mt-6 pt-5 border-t border-white/10">
                  <p className="text-white/40 text-xs font-semibold tracking-wide uppercase mb-3">Roster Strengths</p>
                  <div className="flex flex-wrap gap-2">
                    {strengths.map((s, i) => (
                      <span key={i} className="bg-white/5 text-white/70 text-sm px-3 py-1.5 rounded-lg">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href="/my-teams"
                  className="px-6 py-3 bg-[#F3E216] text-black font-semibold rounded-xl hover:bg-yellow-400 transition-colors text-center"
                >
                  View Standings
                </Link>
                <Link
                  href="/banana-wheel"
                  className="px-6 py-3 bg-white/10 text-white font-medium rounded-xl hover:bg-white/20 transition-colors text-center"
                >
                  🍌 Spin the Wheel
                </Link>
                <Link
                  href="/drafting"
                  className="px-6 py-3 bg-white/10 text-white font-medium rounded-xl hover:bg-white/20 transition-colors text-center"
                >
                  Draft Again
                </Link>
              </div>

              {/* Share button */}
              <div className="mt-6 text-center">
                <button
                  onClick={() => {
                    const text = `Just drafted my team on @SBSFantasy! 🍌\n\n${players.map(p => `${p.position}: ${p.displayName} (${p.team})`).join('\n')}\n\nDraft Grade: ${gradeInfo.grade}\n\n#SBS #FantasyFootball`;
                    if (navigator.share) {
                      navigator.share({ title: 'My SBS Draft Team', text }).catch(() => {});
                    } else {
                      navigator.clipboard.writeText(text).then(() => {
                        alert('Team copied to clipboard!');
                      }).catch(() => {});
                    }
                  }}
                  className="text-white/40 hover:text-white/70 text-sm transition-colors"
                >
                  📤 Share My Team
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* CSS for 3D perspective */}
      <style jsx global>{`
        .perspective-1000 {
          perspective: 1000px;
        }
      `}</style>
    </div>
  );
}
