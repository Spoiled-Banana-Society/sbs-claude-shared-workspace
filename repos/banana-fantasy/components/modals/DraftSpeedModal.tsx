'use client';

import React from 'react';

interface DraftSpeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSpeed: (speed: 'fast' | 'slow') => void;
  draftPasses: number;
}

export function DraftSpeedModal({ isOpen, onClose, onSelectSpeed, draftPasses }: DraftSpeedModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">Choose Draft Speed</h2>
          <p className="text-white/50 text-sm">
            You have <span className="text-yellow-400 font-semibold">{draftPasses}</span> pass{draftPasses !== 1 ? 'es' : ''}
          </p>
        </div>

        {/* Speed Options */}
        <div className="space-y-4">
          {/* Fast Draft */}
          <button
            onClick={() => onSelectSpeed('fast')}
            className="w-full group relative overflow-hidden rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-5 min-h-[5.5rem] flex flex-col justify-center text-left transition-all duration-300 hover:border-yellow-500/60 hover:bg-yellow-500/10"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Fast Draft</h3>
                <p className="text-yellow-400 text-sm font-medium">30 seconds per pick</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-yellow-400 transition-colors">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </button>

          {/* Slow Draft */}
          <button
            onClick={() => onSelectSpeed('slow')}
            className="w-full group relative overflow-hidden rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-5 min-h-[5.5rem] flex flex-col justify-center text-left transition-all duration-300 hover:border-blue-500/60 hover:bg-blue-500/10"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Slow Draft</h3>
                <p className="text-blue-400 text-sm font-medium">8 hours per pick</p>
                <p className="text-white/65 text-xs mt-1">Clock pauses daily 10pm–5am PT · you can still make picks</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-blue-400 transition-colors">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </button>
        </div>

        {/* Footer note */}
        <p className="text-white/30 text-xs text-center mt-6">
          1 pass will be used to enter
        </p>
      </div>
    </div>
  );
}
