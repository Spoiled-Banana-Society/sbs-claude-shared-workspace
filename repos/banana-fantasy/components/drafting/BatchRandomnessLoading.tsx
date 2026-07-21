'use client';

import React from 'react';
import { AnimatedEllipsis } from '@/components/ui/AnimatedEllipsis';

interface BatchRandomnessLoadingProps {
  batchNumber: number;
  /** Seconds elapsed since we started waiting. Drives the live counter. */
  secondsElapsed: number;
  /** Best-known status from useBatchProofReady — mostly cosmetic. */
  status: 'requested' | 'pending' | 'fulfilled' | 'revealed' | 'merkleCommitted' | 'pre-launch' | string | null;
  /** Once the on-chain commit + VRF request tx exists, link to it. */
  commitTxHash?: string;
  /** Contract variant. 'vrf-commit-merkle' shifts copy from "the batch" to "the round" since the round covers 10k drafts. */
  variant?: 'commit-reveal' | 'vrf' | 'vrf-commit' | 'vrf-commit-merkle';
}

/**
 * BatchRandomnessLoading — full-screen overlay shown when a draft lobby
 * has filled (10/10) but the batch's randomness isn't yet derived.
 *
 * Only renders during the rare fast-fill case at a batch boundary, where
 * the first draft of a new batch hits the slot-machine reveal step before
 * Chainlink VRF has called back. The slot machine is gated on this
 * overlay so it can't spin to a wrong type.
 *
 * Typical wait: 10–60 seconds. Hard timeout after 2 minutes — the Go API
 * gives up on VRF for the boundary and lets the draft proceed without a
 * proof, which the rest of the UI handles gracefully (no Verified badge).
 */
export function BatchRandomnessLoading({
  batchNumber,
  secondsElapsed,
  status,
  commitTxHash,
  variant,
}: BatchRandomnessLoadingProps) {
  const isMerkle = variant === 'vrf-commit-merkle';
  // ~60s is our happy path; show that as a soft target. Past 60s we shift
  // copy to "any moment now" so users don't feel like the hard timeout
  // (~120s) is approaching.
  const expectedTotal = 60;
  const remaining = Math.max(0, expectedTotal - secondsElapsed);
  const overshoot = secondsElapsed > expectedTotal;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-blue-500/25 bg-[#0a0a14] p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-full bg-blue-500/[0.08] border border-blue-400/30 text-blue-200 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Chainlink VRF
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-full bg-emerald-500/[0.08] border border-emerald-400/30 text-emerald-200 uppercase tracking-wider">
            + Salt Commit
          </span>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">
          🎲 {isMerkle ? <>Randomizing the next 10,000 drafts<AnimatedEllipsis /></> : <>Randomizing Batch #{batchNumber}<AnimatedEllipsis /></>}
        </h2>

        <p className="text-sm text-white/70 leading-relaxed mb-4">
          {isMerkle ? (
            <>Every rolling window guarantees <span className="text-hof font-semibold">5 HOF</span> and{' '}
            <span className="text-red-400 font-semibold">a Jackpot within 100 drafts</span> — collide and it&apos;s a{' '}
            <span className="font-semibold"><span className="text-red-400">Jack</span><span className="text-hof">HOF</span></span>. All 10,000 upcoming outcomes are being
            randomized right now by <span className="text-blue-300 font-semibold">Chainlink VRF</span> and
            committed — once done, every draft reveals instantly with its own
            proof. This only happens once per 10,000 drafts.</>
          ) : (
            <>Every rolling window guarantees <span className="text-hof font-semibold">5 HOF</span> and{' '}
            <span className="text-red-400 font-semibold">a Jackpot within 100 drafts</span> — collide and it&apos;s a{' '}
            <span className="font-semibold"><span className="text-red-400">Jack</span><span className="text-hof">HOF</span></span>. Which slot is which type is being
            randomized right now by <span className="text-blue-300 font-semibold">Chainlink VRF</span>, the same
            oracle network Polymarket and Aave use. Once Chainlink delivers, your draft type reveals.</>
          )}
        </p>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">Time elapsed</div>
              <div className="text-2xl font-black tabular-nums text-white">
                {Math.floor(secondsElapsed / 60).toString().padStart(2, '0')}:
                {(secondsElapsed % 60).toString().padStart(2, '0')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">
                {overshoot ? 'Status' : 'Typical wait'}
              </div>
              <div className="text-sm text-white/80">
                {overshoot ? 'Any moment now…' : `~${remaining}s remaining`}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-[width] duration-1000 ease-out"
              style={{
                width: `${Math.min(100, (secondsElapsed / expectedTotal) * 100)}%`,
              }}
            />
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={status === 'requested' || status === 'fulfilled' || status === 'revealed' ? 'text-emerald-400' : 'text-white/30'}>
              {status === 'requested' || status === 'fulfilled' || status === 'revealed' ? '✓' : '○'}
            </span>
            <span className="text-white/70">
              Salt hash committed + VRF request submitted
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={status === 'fulfilled' || status === 'revealed' ? 'text-emerald-400' : 'text-white/30'}>
              {status === 'fulfilled' || status === 'revealed' ? '✓' : status === 'requested' ? '⏳' : '○'}
            </span>
            <span className="text-white/70">
              Chainlink coordinator delivers signed randomness
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white/30">○</span>
            <span className="text-white/70">
              Slot machine spins → your draft type reveals
            </span>
          </div>
        </div>

        {commitTxHash && (
          <div className="mt-4 pt-3 border-t border-white/5">
            <a
              href={`https://basescan.org/tx/${commitTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-blue-300 hover:text-blue-200 underline font-mono break-all"
            >
              View proof of commit + VRF request ↗
            </a>
          </div>
        )}

        <p className="mt-4 text-[11px] text-white/40 leading-relaxed">
          {isMerkle
            ? 'This only happens once per 10,000 drafts. Once randomness lands and the commit fires, every draft reveals instantly with its own proof.'
            : 'This only happens at the very start of a new 100-draft batch. Once randomness lands, the next 99 drafts in this batch reveal instantly.'}
        </p>
      </div>
    </div>
  );
}
