'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DraftProofExplainerContent } from './DraftProofExplainerContent';

interface DraftProofExplainerModalProps {
  open: boolean;
  onClose: () => void;
  contractAddress?: string | null;
}

/**
 * Drafts-side explainer modal (mirror of WheelProofExplainerModal).
 * Triggered by the "i" icon on BatchProofBanner. Walks users through
 * the round-based Merkle verification flow in 4 declarative steps.
 * Rendered via React portal so the parent banner's stacking context
 * doesn't clip it.
 */
export function DraftProofExplainerModal({ open, onClose, contractAddress }: DraftProofExplainerModalProps) {
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
        className="relative max-w-[460px] w-full rounded-[28px] max-h-[88vh] overflow-hidden"
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

        <div className="px-8 pt-9 pb-7 overflow-y-auto">
          <DraftProofExplainerContent contractAddress={contractAddress ?? null} showFeedLink />
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
