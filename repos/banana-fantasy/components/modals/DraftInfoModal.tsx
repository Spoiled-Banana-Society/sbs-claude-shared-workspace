'use client';

/**
 * Draft info modal — opened from the ⓘ next to the "Drafts" heading.
 * Tabs: How it Works (incl. draft types), Contest details, FAQ, Provably Fair.
 * Renders the shared ContestInfoTabs so it stays identical to the contest-card
 * popup (ContestDetailsModal).
 */

import { ContestInfoTabs } from './ContestInfoTabs';
import type { Contest } from '@/types';

export function DraftInfoModal({ isOpen, onClose, contest }: { isOpen: boolean; onClose: () => void; contest: Contest | null }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg my-8 rounded-3xl border border-white/[0.08] bg-[#0e0f14] shadow-2xl shadow-black/50" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-0">
          <div className="flex items-center justify-between">
            <h2 className="text-white text-[18px] font-bold tracking-tight">{contest?.name ?? 'Banana Best Ball IV'}</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>
        <div className="px-5 py-5 max-h-[70vh] overflow-y-auto">
          <ContestInfoTabs contest={contest} />
        </div>
      </div>
    </div>
  );
}
