'use client';

import React from 'react';
import Link from 'next/link';
import { useBatchProofReady } from '@/hooks/useBatchProofReady';

interface LobbyProofBadgeProps {
  /** 1-indexed batch number this draft falls into. */
  batchNumber: number;
  /** Draft id used to link to the per-draft proof receipt. */
  draftId: string;
}

const BASESCAN_TX = (h: string) => `https://basescan.org/tx/${h.startsWith('0x') ? h : '0x' + h}`;

/**
 * LobbyProofBadge — small inline element shown alongside the lobby
 * countdown so the verification story is consistent with the
 * BatchProofBanner on /drafting and the /proof/[draftId] page.
 *
 * Visually compact: one line + one link. Renders three states:
 *
 *   - awaiting (status='requested'): "🎲 Randomizing via Chainlink VRF…"
 *   - sealed (status='fulfilled'):   "🔒 Type sealed by Chainlink VRF + salt commit"
 *   - revealed (status='revealed'):  "✓ Verified · Chainlink VRF + salt commit"
 *
 * For pre-launch batches and unknown states we render nothing (silent
 * fallback — the existing UI is unchanged for legacy batches).
 */
export function LobbyProofBadge({ batchNumber, draftId }: LobbyProofBadgeProps) {
  const { status, variant, commitTxHashVrf, vrfRequestTxHash, revealSaltTxHash } =
    useBatchProofReady(batchNumber);

  if (!status || status === 'pre-launch') return null;

  const isMerkle = variant === 'vrf-commit-merkle';
  const isVRFCommit = variant === 'vrf-commit';
  const isVRF = variant === 'vrf' || isVRFCommit || isMerkle;
  if (!isVRF && !(variant === 'commit-reveal' && (status === 'committed' || status === 'revealed'))) return null;

  const requestTx = commitTxHashVrf || vrfRequestTxHash;

  let label: string;
  let labelColor: string;
  let icon: string;

  if (isMerkle && (status === 'merkleCommitted' || status === 'revealed')) {
    label = 'Verified · Chainlink VRF';
    labelColor = 'text-emerald-300';
    icon = '✓';
  } else if (status === 'revealed') {
    label = isVRFCommit
      ? 'Verified · Chainlink VRF + salt commit'
      : isVRF
      ? 'Verified · Chainlink VRF v2.5'
      : 'Verified by Chainlink VRF';
    labelColor = 'text-emerald-300';
    icon = '✓';
  } else if (status === 'fulfilled' || (variant === 'commit-reveal' && status === 'committed')) {
    label = isVRFCommit
      ? 'Type sealed · Chainlink VRF + salt commit'
      : isVRF
      ? 'Type locked · Chainlink VRF v2.5'
      : 'Type sealed · commit/reveal';
    labelColor = 'text-blue-200';
    icon = '🔒';
  } else {
    // requested / pending
    label = isVRFCommit || isMerkle
      ? 'Randomizing · Chainlink VRF'
      : 'Randomizing batch · Chainlink VRF';
    labelColor = 'text-amber-200';
    icon = '🎲';
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap text-[11px]">
      <span className={`inline-flex items-center gap-1.5 ${labelColor}`}>
        <span aria-hidden>{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span className="text-white/30">·</span>
      {requestTx && (
        <a
          href={BASESCAN_TX(requestTx)}
          target="_blank"
          rel="noreferrer"
          className="text-blue-300 hover:text-blue-200 underline"
        >
          {isVRFCommit ? 'commit + VRF tx' : 'VRF tx'} ↗
        </a>
      )}
      {revealSaltTxHash && (
        <>
          <span className="text-white/30">·</span>
          <a
            href={BASESCAN_TX(revealSaltTxHash)}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-300 hover:text-emerald-200 underline"
          >
            salt reveal ↗
          </a>
        </>
      )}
      <span className="text-white/30">·</span>
      <Link href={`/proof/${draftId}`} className="text-white/60 hover:text-white/90 underline">
        full proof
      </Link>
    </div>
  );
}
