'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatedEllipsis } from '@/components/ui/AnimatedEllipsis';
import { DraftProofExplainerModal } from '@/components/drafting/DraftProofExplainerModal';

/**
 * BatchProofBanner — small inline status chip on /drafting indicating
 * the current batch's randomization state.
 *
 * Deliberately compact: one line of low-contrast text + a "view proof"
 * link. Drafting is the focal point of the page; this just lets users
 * notice "oh — there's an on-chain proof" without ever pulling attention
 * away from Enter Draft / draft cards.
 */

type ProofStatus =
  | 'pending'
  | 'committed'
  | 'revealed'
  | 'requested'
  | 'fulfilled'
  | 'pre-launch';

type ProofVariant = 'commit-reveal' | 'vrf' | 'vrf-commit' | 'vrf-commit-merkle';

interface BatchSummary {
  batchNumber: number;
  status: ProofStatus;
  variant?: ProofVariant;
}

interface CurrentBatchInfo {
  currentBatchNumber: number;
}

export function BatchProofBanner() {
  const [info, setInfo] = useState<CurrentBatchInfo | null>(null);
  const [proof, setProof] = useState<BatchSummary | null>(null);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [merkleContractAddress, setMerkleContractAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/batch-proof-merkle-contract');
        if (!r.ok) return;
        const body = (await r.json()) as { contractAddress: string | null };
        if (!cancelled) setMerkleContractAddress(body.contractAddress);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/batches/current');
        if (!r.ok) return;
        const body = (await r.json()) as CurrentBatchInfo;
        if (!cancelled) setInfo(body);
      } catch {
        /* silent — banner is optional */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!info) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/batches/${info.currentBatchNumber}/proof`);
        if (!r.ok) return;
        const body = (await r.json()) as BatchSummary;
        if (!cancelled) setProof(body);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [info]);

  if (!info || !proof) return null;

  const variant: ProofVariant =
    proof.variant === 'vrf' ? 'vrf'
    : proof.variant === 'vrf-commit-merkle' ? 'vrf-commit-merkle'
    : proof.variant === 'vrf-commit' ? 'vrf-commit'
    : 'commit-reveal';

  const isMerkle = variant === 'vrf-commit-merkle';
  const isVRFCommit = variant === 'vrf-commit';
  const isVRF = variant === 'vrf';

  const isPrelaunch = proof.status === 'pre-launch';
  const isAwaiting =
    proof.status === 'pending' ||
    (isVRF && proof.status === 'requested') ||
    (isVRFCommit && proof.status === 'requested') ||
    (isMerkle && (proof.status === 'requested' || proof.status === 'fulfilled'));

  const batchStart = (info.currentBatchNumber - 1) * 100 + 1;
  const sampleDraftId = `2025-fast-draft-${batchStart}`;

  // Single-line copy + a single inline link. Low contrast on purpose.
  let icon: string;
  let copy: React.ReactNode;
  let proofLink: string | null = `/proof/${sampleDraftId}`;

  if (isPrelaunch) {
    icon = '·';
    copy = <>Chainlink VRF verification starts next batch.</>;
    proofLink = null;
  } else if (isAwaiting) {
    icon = '🎲';
    copy = (
      <>
        Randomizing Batch #{info.currentBatchNumber} with Chainlink VRF
        <AnimatedEllipsis />
      </>
    );
  } else if (isMerkle) {
    // Merkle variant: every draft instantly verified at slot reveal.
    icon = '✓';
    copy = <>Every draft in Batch #{info.currentBatchNumber} verified by Chainlink VRF</>;
  } else {
    icon = '✓';
    copy = <>Batch #{info.currentBatchNumber} done randomizing · verified by Chainlink VRF</>;
  }

  return (
    <div className="mb-3">
      <div className="inline-flex items-center gap-1.5 flex-wrap text-[11px] text-white/55 px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.03]">
        <span aria-hidden>{icon}</span>
        <span>{copy}</span>
        {proofLink && (
          <>
            <span className="text-white/25">·</span>
            <Link href={proofLink} className="text-white/70 hover:text-white underline underline-offset-2">
              view proof
            </Link>
          </>
        )}
        {isMerkle && (
          <>
            <span className="text-white/25">·</span>
            <button
              onClick={() => setExplainerOpen(true)}
              aria-label="How draft verification works"
              className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/25 text-white/55 hover:text-white hover:border-white/45 transition-colors text-[9px] font-semibold italic leading-none"
              title="How does this verification work?"
            >
              i
            </button>
          </>
        )}
      </div>
      <DraftProofExplainerModal
        open={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        contractAddress={merkleContractAddress}
      />
    </div>
  );
}
