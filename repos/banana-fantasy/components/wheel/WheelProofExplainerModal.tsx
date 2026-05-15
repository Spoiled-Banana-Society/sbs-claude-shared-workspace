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
            Chainlink VRF randomizes all 10,000 outcomes before anyone clicks. End-to-end auditable.
          </p>
        </div>

        <div className="px-8 pb-6 overflow-y-auto space-y-5">
          <Step
            num="1"
            title="Chainlink VRF randomizes 10,000 spins"
            body="A decentralized oracle picks the random outcomes — SBS never sees or chooses the randomness."
          />
          <Step
            num="2"
            title="The full list locks on Base mainnet"
            body="A cryptographic fingerprint of all 10,000 outcomes is committed on-chain before anyone spins. Outcomes can't be changed after."
          />
          <Step
            num="3"
            title="Every spin includes a proof"
            body="Each spin returns a personal receipt — your browser verifies it in milliseconds. That's the green Verified ✓ badge."
          />
          <Step
            num="4"
            title="Public receipts every 100 spins"
            body="A public batch drops on /wheel-batches every 100 spins. Anyone can audit any spin, no trust required."
          />
        </div>

        <div className="px-8 py-5 border-t border-white/[0.07] shrink-0">
          <p className="text-white/75 text-[13.5px] leading-relaxed">
            <span className="text-emerald-400 font-semibold">SBS can&apos;t change an outcome after you spin.</span>{' '}
            You don&apos;t have to trust us — the math proves it.
          </p>
          {contractAddress && (
            <a
              href={`https://basescan.org/address/${contractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-3 text-white/40 hover:text-white text-[11px] font-mono"
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
