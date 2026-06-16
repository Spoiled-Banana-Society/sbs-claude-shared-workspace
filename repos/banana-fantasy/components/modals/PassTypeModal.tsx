'use client';

import React from 'react';
import { Modal } from '../ui/Modal';

interface PassTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: 'paid' | 'free') => void;
  paidPasses: number;
  freePasses: number;
}

export function PassTypeModal({
  isOpen,
  onClose,
  onSelect,
  paidPasses,
  freePasses,
}: PassTypeModalProps) {
  const hasPaid = paidPasses > 0;
  const hasFree = freePasses > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="space-y-5">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-xl font-bold text-text-primary">Which Draft Pass?</h2>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {/* Paid Passes Option */}
          <button
            onClick={() => hasPaid && onSelect('paid')}
            disabled={!hasPaid}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              hasPaid
                ? 'border-banana/30 bg-banana/5 hover:border-banana hover:bg-banana/10 hover:scale-[1.02] cursor-pointer'
                : 'border-bg-elevated bg-bg-tertiary opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className={`font-semibold ${hasPaid ? 'text-text-primary' : 'text-text-muted'}`}>
                  Draft Pass
                </p>
                <p className="text-text-muted text-sm">Purchased</p>
              </div>
              <p className={`text-3xl font-bold ${hasPaid ? 'text-banana' : 'text-text-muted'}`}>
                {paidPasses}
              </p>
            </div>
          </button>

          {/* Free Passes Option */}
          <button
            onClick={() => hasFree && onSelect('free')}
            disabled={!hasFree}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              hasFree
                ? 'border-green-500/30 bg-green-500/5 hover:border-green-500 hover:bg-green-500/10 hover:scale-[1.02] cursor-pointer'
                : 'border-bg-elevated bg-bg-tertiary opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className={`font-semibold ${hasFree ? 'text-text-primary' : 'text-text-muted'}`}>
                  Free Draft Pass
                </p>
                <p className="text-text-muted text-sm">Promos</p>
              </div>
              <p className={`text-3xl font-bold ${hasFree ? 'text-green-500' : 'text-text-muted'}`}>
                {freePasses}
              </p>
            </div>
          </button>
        </div>

        {/* Cancel link */}
        <button
          onClick={onClose}
          className="w-full text-center text-text-muted text-sm hover:text-text-secondary transition-colors py-2"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
