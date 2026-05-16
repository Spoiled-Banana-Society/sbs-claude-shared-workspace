'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatedEllipsis } from '@/components/ui/AnimatedEllipsis';
import { DraftProofExplainerModal } from '@/components/drafting/DraftProofExplainerModal';

/**
 * BatchProofBanner — card-style trust panel on /drafting and in the
 * draft room. Mirrors the wheel's `WheelProofBanner` shape: small
 * card with headline, sub, progress indicator, action links, and (i)
 * icon that opens the explainer modal. Copy is past-tense for the
 * Merkle variant — randomization already happened, every draft
 * verifies as its slot reveals.
 */

type ProofStatus =
  | 'pending'
  | 'committed'
  | 'revealed'
  | 'requested'
  | 'fulfilled'
  | 'merkleCommitted'
  | 'pre-launch';

type ProofVariant = 'commit-reveal' | 'vrf' | 'vrf-commit' | 'vrf-commit-merkle';

interface BatchSummary {
  batchNumber: number;
  status: ProofStatus;
  variant?: ProofVariant;
}

interface CurrentBatchInfo {
  currentBatchNumber: number;
  filledLeaguesCount?: number;
  positionInBatch?: number;
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
    const load = async () => {
      try {
        const r = await fetch('/api/batches/current', { cache: 'no-store' });
        if (!r.ok) return;
        const body = (await r.json()) as CurrentBatchInfo;
        if (!cancelled) setInfo(body);
      } catch {
        /* silent — banner is optional */
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
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

  if (!info) return null;

  const variant: ProofVariant | null = proof
    ? (proof.variant === 'vrf' ? 'vrf'
       : proof.variant === 'vrf-commit-merkle' ? 'vrf-commit-merkle'
       : proof.variant === 'vrf-commit' ? 'vrf-commit'
       : 'commit-reveal')
    : null;

  // Show the merkle UX whenever a merkle contract is deployed AND we're
  // either already on a merkle batch OR about to roll into one (current
  // batch was pre-launch/end-of-legacy). Past-tense copy reflects that
  // the randomization for the next 10k drafts has already happened.
  const merkleActive = !!merkleContractAddress;

  const isPrelaunch = proof?.status === 'pre-launch';
  const isAwaiting = variant && (
    proof?.status === 'pending' ||
    (variant === 'vrf' && proof?.status === 'requested') ||
    (variant === 'vrf-commit' && proof?.status === 'requested') ||
    (variant === 'vrf-commit-merkle' && (proof?.status === 'requested' || proof?.status === 'fulfilled'))
  );

  // Merkle-style card. Used whenever the merkle contract is configured —
  // signals to users that the new system is live regardless of which
  // specific batch they're currently looking at.
  if (merkleActive) {
    return (
      <div
        className="rounded-2xl p-4 backdrop-blur-md"
        style={{
          background: 'rgba(20, 20, 20, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="text-[14px] font-semibold text-white tracking-tight truncate">
              Verified Fair
            </h3>
          </div>
          <button
            onClick={() => setExplainerOpen(true)}
            aria-label="How draft verification works"
            className="shrink-0 w-5 h-5 rounded-full border border-white/20 text-white/55 hover:text-white hover:border-white/40 transition-colors flex items-center justify-center text-[11px] font-semibold italic"
            title="How does this verification work?"
          >
            i
          </button>
        </div>
        <p className="text-white/55 text-[12px] mb-3 leading-snug">
          Draft types randomized by Chainlink VRF. Each draft is instantly verifiable.
        </p>

        <Link href="/proof-feed" className="text-banana hover:underline font-medium text-[11px]">
          Live feed →
        </Link>

        <DraftProofExplainerModal
          open={explainerOpen}
          onClose={() => setExplainerOpen(false)}
          contractAddress={merkleContractAddress}
        />
      </div>
    );
  }

  // Legacy chip fallback — kept for envs where the merkle contract isn't
  // deployed yet (e.g. prod before cutover).
  if (!proof) return null;

  const batchStart = (info.currentBatchNumber - 1) * 100 + 1;
  let icon: string;
  let copy: React.ReactNode;
  let proofLink: string | null = `/proof/2025-fast-draft-${batchStart}`;
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
      </div>
    </div>
  );
}
