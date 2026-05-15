'use client';

import { useEffect } from 'react';

interface WheelProofExplainerModalProps {
  open: boolean;
  onClose: () => void;
  contractAddress?: string | null;
}

/**
 * TLDR explainer modal for the wheel verification system. Triggered by
 * the "i" icon on WheelProofBanner. Walks a user through the
 * randomize-then-commit-then-spin-then-verify flow in 5 numbered steps
 * with a key promise at the bottom. Links to the full FAQ for the
 * technically curious.
 */
export function WheelProofExplainerModal({ open, onClose, contractAddress }: WheelProofExplainerModalProps) {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      style={{ animation: 'fadeIn 0.25s ease-out' }}
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full rounded-[28px] p-[1px] max-h-[90vh] overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, rgba(255,255,255,0.15) 0%, rgba(34,197,94,0.2) 50%, rgba(251,191,36,0.2) 100%)',
          animation: 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative bg-[#1c1c1e] rounded-[27px] flex flex-col"
          style={{
            maxHeight: '90vh',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
          }}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 z-10 text-[#86868b] hover:text-white transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="px-8 pt-8 pb-2 shrink-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold uppercase tracking-wider mb-3">
              Provably Fair
            </div>
            <h2 className="text-[24px] font-semibold text-white tracking-tight leading-tight">
              How your spins are verified
            </h2>
            <p className="text-white/55 text-[13px] mt-1.5">
              SBS literally cannot change an outcome after you spin. Here&apos;s how:
            </p>
          </div>

          <div className="px-8 py-4 overflow-y-auto space-y-4">
            <Step
              num="1"
              title="Chainlink VRF picks the random number"
              body="At the start of a round, we ask Chainlink — a decentralized oracle, not us — for a verifiable random number. SBS never picks it. The randomness is published on-chain and bound to a cryptographic proof."
            />
            <Step
              num="2"
              title="All 10,000 outcomes get pre-computed"
              body="We combine that random number with a secret salt and pre-generate every outcome for the next 10,000 spins, respecting the wheel's probabilities (so jackpots stay rare). The whole list is locked in before anyone spins."
            />
            <Step
              num="3"
              title="The list gets fingerprinted on-chain"
              body="A single 32-byte cryptographic fingerprint (a Merkle root) summarizes all 10,000 outcomes and gets committed to Base mainnet. From this moment, the outcomes are mathematically immutable. We can't change them. You can't see them either — they're hidden behind the salt."
            />
            <Step
              num="4"
              title="When you spin, you get a personal receipt"
              body="The server hands back your outcome plus a tiny cryptographic proof your specific outcome was in the original committed list. Your browser verifies the proof against the on-chain fingerprint in milliseconds. That's the green Verified ✓ badge — you don't have to trust us, the math proves it."
            />
            <Step
              num="5"
              title="Every 100 spins, a public receipt drops"
              body="A public batch of 100 spins appears on /wheel-batches — anyone can audit. After 10,000 spins, the secret salt is published on-chain and anyone can re-derive every outcome from scratch and confirm they all match the original fingerprint."
            />

            <div className="bg-emerald-500/[0.08] border border-emerald-500/30 rounded-2xl p-4 mt-2">
              <div className="text-emerald-300 text-[12px] font-semibold mb-1">Bottom line</div>
              <p className="text-white/80 text-[13px] leading-relaxed">
                The outcome of every spin you take was locked in <em>before</em> you clicked, and you carry a cryptographic receipt proving it. We can&apos;t cheat. You don&apos;t have to trust us.
              </p>
            </div>
          </div>

          <div className="px-8 py-5 border-t border-white/10 flex items-center justify-between shrink-0">
            <a
              href="/how-it-works#wheel-fairness"
              className="text-banana hover:underline text-[13px] font-semibold"
            >
              Read the full FAQ →
            </a>
            {contractAddress && (
              <a
                href={`https://basescan.org/address/${contractAddress}`}
                target="_blank"
                rel="noreferrer"
                className="text-white/55 hover:text-white text-[12px] font-mono"
              >
                {contractAddress.slice(0, 8)}…{contractAddress.slice(-4)}
              </a>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.96) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </div>
  );
}

function Step({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/70 text-[12px] font-semibold">
        {num}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-white text-[14px] font-semibold mb-0.5 leading-tight">{title}</h3>
        <p className="text-white/55 text-[12.5px] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
