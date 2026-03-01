'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/hooks/useAuth';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false }
);
import { isStagingMode } from '@/lib/staging';

export default function BuyDraftsPage() {
  const { isLoggedIn, setShowLoginModal } = useAuth();
  const [showModal, setShowModal] = useState(true);
  const staging = typeof window !== 'undefined' && isStagingMode();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold text-text-primary">Buy Draft Passes</h1>
        <p className="text-text-muted">Get passes to enter any draft contest</p>
        
        <button
          onClick={() => {
            if (!isLoggedIn) { setShowLoginModal(true); return; }
            setShowModal(true);
          }}
          className="px-8 py-4 bg-banana text-black font-bold text-xl rounded-2xl hover:brightness-110 transition-all shadow-lg shadow-banana/20"
        >
          Buy Draft Passes
        </button>

        {staging && (
          <div className="mt-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs">
              🧪 Staging Mode — Free mints available
            </span>
          </div>
        )}
      </div>

      <BuyPassesModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onPurchaseComplete={() => {}}
      />
    </div>
  );
}
