'use client';

import React, { useState } from 'react';
import { SelfCashOutModal } from '@/components/modals/SelfCashOutModal';

/**
 * Copy-review preview of the Coinbase cash-out tutorial module.
 *
 * Renders SelfCashOutModal in previewMode (skips the KYC/jurisdiction preflight
 * and any real withdrawal) so the tutorial copy can be seen and iterated without
 * a web2 login or an on-chain balance. Static copy only — nothing here can move
 * funds. Use ?amount=NN to change the displayed balance.
 */
export default function CashoutPreviewPage() {
  const [open, setOpen] = useState(true);
  const amount =
    typeof window !== 'undefined'
      ? Number(new URLSearchParams(window.location.search).get('amount')) || 50
      : 50;

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="px-6 py-3 rounded-full bg-banana text-black font-semibold text-sm"
        >
          Open cash-out module
        </button>
      )}
      <SelfCashOutModal
        isOpen={open}
        onClose={() => setOpen(false)}
        balanceUsdc={amount}
        isEmbeddedWallet={false}
        previewMode
      />
    </div>
  );
}
