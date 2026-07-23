'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getPurchaseFlow, resetPurchaseFlow } from '@/lib/purchaseFlow';
import { useEnterDraft } from '@/hooks/useEnterDraft';
import { useDepositEntry } from '@/hooks/useDepositEntry';
import { EntryFlowModal } from '@/components/modals/EntryFlowModal';
import { DEPOSITS_ENABLED } from '@/lib/deposits';
import { AddFundsModal } from '@/components/modals/AddFundsModal';
import { JoiningLobbyOverlay } from '@/components/drafting/JoiningLobbyOverlay';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false }
);

/**
 * /buy-drafts — the draft-pass hub. What it surfaces depends on how you got here:
 *   • Default (e.g. tapping the pass ticket in the header): the shared chooser,
 *     which covers using a pass, buying a $25 seat, or buying passes outright.
 *   • `?buy=1` (the explicit "Buy Draft(s)" CTAs): always the buy/mint screen.
 */
export default function BuyDraftsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading, user, setShowLoginModal } = useAuth();
  const { joiningLobby, joinError, clearJoinError, enterDraftWithPassType } = useEnterDraft();
  const { buying: depositBuying, buyError: depositBuyError, clearBuyError, buyPassWithBalance } = useDepositEntry();
  const [mode, setMode] = useState<'none' | 'buy' | 'entry' | 'add-funds'>('none');

  useEffect(() => {
    if (isLoading) return;
    if (!isLoggedIn) { setShowLoginModal(true); return; }
    // Mid-flow guard: the deposit mint bumps the pass count, which re-runs
    // this effect — don't yank the user back while they're paying or buying.
    if (mode === 'add-funds' || mode === 'buy') return;
    const forceBuy =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('buy') === '1';
    if (!forceBuy) {
      // The chooser covers every case now (pass, free pass, $25 buy-in, or
      // buy passes outright), so it's the default landing for the hub.
      setMode('entry');
    } else {
      // Buying: clear any stale post-mint "Join a Draft" state so we land on
      // the actual buy/mint screen (not a leftover join prompt).
      if (getPurchaseFlow().phase !== 'purchase') resetPurchaseFlow();
      setMode('buy');
    }
  }, [isLoading, isLoggedIn, mode, setShowLoginModal]);

  // Closing returns the user to where they came from — not a bare hub screen.
  const leave = useCallback(() => {
    setMode('none');
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }, [router]);

  const handleEntryComplete = async (passType: 'paid' | 'free' | 'balance', speed: 'fast' | 'slow') => {
    if (passType === 'balance') {
      const ok = await buyPassWithBalance();
      if (!ok) return; // error stays visible in the modal
      void enterDraftWithPassType('paid', speed);
      return;
    }
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
              className="px-8 py-4 bg-banana text-black font-bold text-xl rounded-2xl hover:brightness-110 transition-all"
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
        onClose={() => { clearBuyError(); leave(); }}
        onComplete={(passType, speed) => void handleEntryComplete(passType, speed)}
        paidPasses={user?.draftPasses || 0}
        freePasses={user?.freeDrafts || 0}
        isSubmitting={joiningLobby || depositBuying}
        depositsEnabled={DEPOSITS_ENABLED}
        balanceUsd={user?.usdcBalance ?? 0}
        balanceError={depositBuyError}
        onAddFunds={() => { clearBuyError(); setMode('add-funds'); }}
        onBuyMore={() => {
          if (getPurchaseFlow().phase !== 'purchase') resetPurchaseFlow();
          setMode('buy');
        }}
      />

      {/* Add Funds — mount only while open (useFundWallet crash rule) */}
      {mode === 'add-funds' && (
        <AddFundsModal isOpen={true} onClose={() => setMode('entry')} />
      )}

      <JoiningLobbyOverlay show={joiningLobby} error={joinError} onDismiss={clearJoinError} />
    </div>
  );
}
