'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface WheelProofExplainerModalProps {
  open: boolean;
  onClose: () => void;
  contractAddress?: string | null;
}

/**
 * TLDR explainer modal. Triggered by the "i" icon on WheelProofBanner.
 * Rendered via React portal to document.body so the parent's backdrop-blur
 * stacking context doesn't clip it.
 */
export function WheelProofExplainerModal({ open, onClose, contractAddress }: WheelProofExplainerModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const node = (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
      style={{ animation: 'fadeIn 0.25s ease-out' }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[440px] w-full rounded-[28px] max-h-[88vh] overflow-hidden"
        style={{
          background: '#1c1c1e',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 25px 60px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
          animation: 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 text-white/40 hover:text-white transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="px-8 pt-9 pb-6 shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-400 mb-3">
            Provably Fair
          </div>
          <h2 className="text-[26px] font-semibold text-white tracking-tight leading-tight">
            How your spins are verified
          </h2>
          <p className="text-white/55 text-[14px] mt-2 leading-snug">
            Outcomes AND who gets them are both locked on-chain. Chainlink VRF picks the outcomes before any spin, and every wallet assignment is publicly committed as spins happen.
          </p>
        </div>

        <div className="px-8 pb-6 overflow-y-auto space-y-5">
          <Step
            num="1"
            title="Chainlink VRF generated 10,000 outcomes"
            body="A decentralized oracle supplied the randomness. SBS never saw or chose it."
          />
          <Step
            num="2"
            title="The full list was committed to Base mainnet"
            body="A cryptographic fingerprint of all 10,000 outcomes was published on-chain before any spin happened. Outcomes are immutable after commit."
          />
          <Step
            num="3"
            title="Wallet assignments committed every 100 spins"
            body="Every 100 spins, the wallet→spinIndex assignments are bundled into a Merkle root and committed to Base mainnet. This creates a permanent, public record of which wallet received which outcome — anyone can verify the order is honest, with no swapping or skipping possible after the fact."
          />
          <Step
            num="4"
            title="Every spin returns its own proof"
            body="Each spin response includes two Merkle proofs — one tying its outcome to the on-chain outcomes root, one tying your wallet to the on-chain assignments root. Verified in your browser in milliseconds."
          />
          <Step
            num="5"
            title="Every spin appears in the public feed"
            body="The live feed at /wheel-batches shows every spin and every batch commit as it happens, with verifiable proof links for each. Anyone can audit any outcome AND any assignment independently."
          />
        </div>

        <div className="px-8 py-5 border-t border-white/[0.07] shrink-0">
          <p className="text-white/80 text-[13.5px] leading-relaxed">
            <span className="text-emerald-400 font-semibold">Trustless by design.</span>{' '}
            Outcomes AND wallet assignments are both cryptographically immutable. Nothing about who got what can be quietly changed after the fact.
          </p>
          <a
            href="/wheel-batches"
            className="inline-block mt-3 text-banana hover:underline text-[12px] font-medium"
          >
            See on-chain proof →
          </a>
          {contractAddress && (
            <a
              href={`https://basescan.org/address/${contractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="block mt-2 text-white/40 hover:text-white text-[11px] font-mono"
            >
              Contract: {contractAddress.slice(0, 8)}…{contractAddress.slice(-4)}
            </a>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.96) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
}

function Step({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/65 text-[12px] font-semibold">
        {num}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="text-white text-[14.5px] font-semibold mb-1 leading-tight tracking-tight">{title}</h3>
        <p className="text-white/55 text-[13px] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
