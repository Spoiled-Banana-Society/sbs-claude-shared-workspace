'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getPurchaseFlow, resetPurchaseFlow } from '@/lib/purchaseFlow';
import { useEnterDraft } from '@/hooks/useEnterDraft';
import { EntryFlowModal } from '@/components/modals/EntryFlowModal';
import { JoiningLobbyOverlay } from '@/components/drafting/JoiningLobbyOverlay';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false }
);

/**
 * /buy-drafts — the draft-pass hub. What it surfaces depends on how you got here:
 *   • Default (e.g. tapping the pass ticket in the header): if you ALREADY hold
 *     a pass, go straight to the fast/slow picker and into a draft. Only if you
 *     have 0 passes does it open the buy/mint screen.
 *   • `?buy=1` (the explicit "Buy Draft(s)" CTAs): always the buy/mint screen.
 */
export default function BuyDraftsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading, user, setShowLoginModal } = useAuth();
  const { joiningLobby, enterDraftWithPassType } = useEnterDraft();
  const [mode, setMode] = useState<'none' | 'buy' | 'entry'>('none');

  const passes = (user?.draftPasses || 0) + (user?.freeDrafts || 0);

  useEffect(() => {
    if (isLoading) return;
    if (!isLoggedIn) { setShowLoginModal(true); return; }
    const forceBuy =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('buy') === '1';
    if (!forceBuy && passes > 0) {
      // Has a pass → pick fast/slow and draft, don't push them to buy more.
      setMode('entry');
    } else {
      // Buying: clear any stale post-mint "Join a Draft" state so we land on
      // the actual buy/mint screen (not a leftover join prompt).
      if (getPurchaseFlow().phase !== 'purchase') resetPurchaseFlow();
      setMode('buy');
    }
  }, [isLoading, isLoggedIn, passes, setShowLoginModal]);

  // Closing returns the user to where they came from — not a bare hub screen.
  const leave = useCallback(() => {
    setMode('none');
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }, [router]);

  const handleEntryComplete = (passType: 'paid' | 'free', speed: 'fast' | 'slow') => {
    void enterDraftWithPassType(passType, speed);
  };

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Fallback hero — only if no flow is open (e.g. logged-out user dismissed
          the login prompt). The logged-in flows open immediately. */}
      {mode === 'none' && !isLoading && (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="text-center space-y-6">
            <h1 className="text-4xl font-bold text-text-primary">Buy Draft Passes</h1>
            <p className="text-text-muted">Get passes to enter any draft contest</p>
            <button
              onClick={() => {
                if (!isLoggedIn) { setShowLoginModal(true); return; }
                if (getPurchaseFlow().phase !== 'purchase') resetPurchaseFlow();
                setMode('buy');
              }}
              className="px-8 py-4 bg-banana text-black font-bold text-xl rounded-2xl hover:brightness-110 transition-all shadow-lg shadow-banana/20"
            >
              Buy Draft Passes
            </button>
          </div>
        </div>
      )}

      {mode === 'buy' && (
        <BuyPassesModal
          isOpen={true}
          onClose={leave}
          onPurchaseComplete={() => {}}
        />
      )}

      <EntryFlowModal
        isOpen={mode === 'entry'}
        onClose={leave}
        onComplete={handleEntryComplete}
        paidPasses={user?.draftPasses || 0}
        freePasses={user?.freeDrafts || 0}
        isSubmitting={joiningLobby}
      />

      <JoiningLobbyOverlay show={joiningLobby} />
    </div>
  );
}
