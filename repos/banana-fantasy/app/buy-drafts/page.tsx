'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false }
);

export default function BuyDraftsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading, setShowLoginModal } = useAuth();
  const [showModal, setShowModal] = useState(false);

  // /buy-drafts is a passthrough that exists only to surface the buy modal.
  // Open it immediately; never show a standalone landing screen behind it.
  useEffect(() => {
    if (isLoading) return;
    if (isLoggedIn) {
      setShowModal(true);
    } else {
      setShowLoginModal(true);
    }
  }, [isLoading, isLoggedIn, setShowLoginModal]);

  // Closing the modal should return the user to the page they came from —
  // not strand them on a bare buy-drafts screen. Fall back to home when
  // there's no in-app history (deep link / fresh tab).
  const leave = useCallback(() => {
    setShowModal(false);
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Fallback action — only visible if the modal is closed (e.g. a logged-out
          user dismissed the login prompt). The logged-in flow opens the modal
          immediately, so this hero never flashes behind it. */}
      {!showModal && !isLoading && (
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
          </div>
        </div>
      )}

      <BuyPassesModal
        isOpen={showModal}
        onClose={leave}
        onPurchaseComplete={() => {}}
      />
    </div>
  );
}
