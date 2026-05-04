'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ContestCard } from '@/components/home/ContestCard';
import { PromoCarousel } from '@/components/home/PromoCarousel';
import { AddToHomeScreenCard } from '@/components/home/AddToHomeScreenCard';
import { usePWAInstallPromo } from '@/hooks/usePWAInstallPromo';
import { ContestDetailsModal } from '@/components/modals/ContestDetailsModal';
import { EntryFlowModal } from '@/components/modals/EntryFlowModal';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false }
);
import { useAuth } from '@/hooks/useAuth';
import { useModalStack } from '@/hooks/useModalStack';
import { useContests } from '@/hooks/useContests';
import { usePromos } from '@/hooks/usePromos';
import { usePromoReminders } from '@/hooks/usePromoReminders';
import { isStagingMode as _isStagingMode } from '@/lib/staging';
import { SkeletonContestCard } from '@/components/ui/Skeleton';
import { consumePromoDraftType, peekPromoDraftType } from '@/lib/promoDraftType';
import * as draftStore from '@/lib/draftStore';

function StagingMintButton({
  userId,
  onMinted,
}: {
  userId: string;
  onMinted: (data?: { draftPasses?: number | null }) => void;
}) {
  const [minting, setMinting] = React.useState(false);
  const [qty, setQty] = React.useState(3);
  const [result, setResult] = React.useState<string | null>(null);

  const handleMint = async () => {
    setMinting(true);
    setResult(null);
    try {
      const res = await fetch('/api/purchases/staging-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, quantity: qty }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(`Minted ${qty} — passes ready`);
        onMinted({ draftPasses: typeof data.draftPasses === 'number' ? data.draftPasses : null });
      } else {
        setResult(`Error: ${data.error || 'Unknown'}`);
      }
    } catch (err) {
      setResult(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-2">
      <span className="text-orange-400 text-xs font-bold whitespace-nowrap">STAGING MINT</span>
      <select
        value={qty}
        onChange={(e) => setQty(Number(e.target.value))}
        className="bg-black/50 border border-white/20 rounded-lg px-2 py-1 text-white text-sm"
      >
        {[1, 3, 5, 7, 10].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <button
        onClick={handleMint}
        disabled={minting}
        className="px-4 py-1.5 bg-orange-500 text-black text-xs font-bold rounded-lg hover:brightness-110 disabled:opacity-50 transition-all"
      >
        {minting ? 'Minting...' : 'Mint'}
      </button>
      {result && <span className="text-xs text-white/70">{result}</span>}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { isLoggedIn, user, setShowLoginModal, updateUser, refreshBalance } = useAuth();
  const [isJoiningDraft] = React.useState(false);
  const contestsQuery = useContests();
  const promosQuery = usePromos({ userId: user?.id });
  const pwaPromo = usePWAInstallPromo();
  usePromoReminders(promosQuery.promos);

  // Build combined promos including PWA install promo
  const allPromos = React.useMemo(() => {
    const base = promosQuery.promos || [];
    // Only show PWA promo if active or user has entered (to show draw state)
    if (!pwaPromo.loading && (pwaPromo.promoActive || pwaPromo.hasEntered || pwaPromo.raffleResult)) {
      const pwaPromoObj: import('@/types').Promo = {
        id: 'pwa-install-promo',
        type: 'add-to-home-screen',
        title: pwaPromo.raffleResult?.status === 'drawn'
          ? 'Raffle Complete'
          : !pwaPromo.promoActive
            ? 'Raffle Draw Coming'
            : 'Install App → FREE SPINS',
        description: pwaPromo.raffleResult?.status === 'drawn'
          ? `Winner: ${pwaPromo.raffleResult.winnerWallet?.slice(0, 6)}...${pwaPromo.raffleResult.winnerWallet?.slice(-4)}`
          : !pwaPromo.promoActive
            ? `${pwaPromo.entryCount} entered — draw starting soon`
            : `${pwaPromo.entryCount} entered`,
        ctaText: pwaPromo.hasEntered ? 'Entered' : 'Install',
        ctaLink: '#',
        backgroundColor: '#1a1a2e',
        isNew: pwaPromo.promoActive,
        timerEndTime: pwaPromo.promoActive ? pwaPromo.promoEnd : pwaPromo.drawTime,
        claimable: false,
        modalContent: {
          title: 'Install SBS App → Win Free Spins',
          explanation: 'Add SBS to your home screen and open it from there — you\'re automatically entered into the raffle. 1 random winner gets 5 free spins! Winner drawn live on site after the timer ends.',
        },
      };
      return [pwaPromoObj, ...base];
    }
    return base;
  }, [promosQuery.promos, pwaPromo]);

  const selectedContest = contestsQuery.data?.[0];
  const modals = useModalStack();

  const buildDraftRoomUrl = React.useCallback((draftId: string, contestName: string, speed: 'fast' | 'slow') => {
    const params = new URLSearchParams({
      id: draftId,
      name: contestName,
      speed,
    });

    // Add live mode params only in staging mode
    if (user?.walletAddress && _isStagingMode()) {
      params.set('mode', 'live');
      params.set('wallet', user.walletAddress);
    }

    if (typeof window !== 'undefined') {
      const current = new URLSearchParams(window.location.search);
      if (current.get('staging') === 'true') params.set('staging', 'true');
      const apiUrl = current.get('apiUrl');
      const wsUrl = current.get('wsUrl');
      if (apiUrl) params.set('apiUrl', apiUrl);
      if (wsUrl) params.set('wsUrl', wsUrl);
    }

    return `/draft-room?${params.toString()}`;
  }, [user?.walletAddress]);


  const handleEnter = () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    const paidPasses = user?.draftPasses || 0;
    const freePasses = user?.freeDrafts || 0;
    const totalPasses = paidPasses + freePasses;

    if (totalPasses <= 0) {
      modals.push('buy-passes');
      return;
    }

    modals.push('entry-flow');
  };

  const handleEntryComplete = async (passType: 'paid' | 'free', speed: 'fast' | 'slow') => {
    modals.closeAll();

    if (!user?.walletAddress) return;

    const paidPasses = user?.draftPasses || 0;
    const freePasses = user?.freeDrafts || 0;

    if (passType === 'paid' && paidPasses <= 0) {
      alert('No paid draft passes available.');
      return;
    }
    if (passType === 'free' && freePasses <= 0) {
      alert('No free draft passes available.');
      return;
    }

    // Optimistic local decrement so the header ticks down on click.
    // Rolled back below if the backend rejects.
    if (passType === 'paid') {
      updateUser({ draftPasses: Math.max(0, paidPasses - 1) });
    } else {
      updateUser({ freeDrafts: Math.max(0, freePasses - 1) });
    }

    // Backend gate: Firestore is the authoritative source. A stale UI
    // could otherwise let a user join a draft they shouldn't. We await
    // the decrement and abort if it fails — no navigation, balance
    // re-syncs from Firestore truth.
    let decremented = false;
    try {
      const res = await fetch('/api/owner/use-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id || user.walletAddress, passType }),
      });
      const body = await res.json().catch(() => ({}));
      decremented = res.ok && !!body?.decremented;
    } catch {
      updateUser({ draftPasses: paidPasses, freeDrafts: freePasses });
      alert('Network error. Please try again.');
      return;
    }

    if (!decremented) {
      updateUser({ draftPasses: paidPasses, freeDrafts: freePasses });
      void refreshBalance();
      alert('No draft passes available. Your balance has been refreshed.');
      return;
    }

    // Consume promo draft type if queued (only after the gate succeeds —
    // we don't want to burn a queued promo on a failed join).
    const forcedDraftType = peekPromoDraftType();
    if (forcedDraftType) {
      consumePromoDraftType(forcedDraftType);
    }

    if (_isStagingMode()) {
      const params = new URLSearchParams({
        speed,
        mode: 'live',
        wallet: user.walletAddress,
        passType,
      });
      if (forcedDraftType) params.set('promoType', forcedDraftType);
      router.push(`/draft-room?${params.toString()}`);
    } else {
      const localDraftId = `local-${Date.now()}`;
      const localContestName = `League #${Math.floor(Math.random() * 9000) + 1000}`;
      draftStore.addDraft({
        id: localDraftId,
        contestName: localContestName,
        status: 'filling',
        type: null,
        draftSpeed: speed,
        players: 1,
        maxPlayers: 10,
        joinedAt: Date.now(),
        phase: 'filling',
        liveWalletAddress: user.walletAddress,
      });
      router.push(buildDraftRoomUrl(localDraftId, localContestName, speed));
    }
  };

  const handlePurchaseComplete = () => {
    // Don't close BuyPassesModal — let it handle pick-speed → join → redirect internally
  };

  const handleDetails = () => {
    modals.push('contest-details');
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 pt-16 flex flex-col min-h-[calc(100vh-64px)]">
      {/* Get the App banner */}
      <AddToHomeScreenCard />

      {/* Special Draft Banner removed — special drafts now show on /drafting page */}

      {/* Featured Contest */}
      <section className="mb-6">
        {contestsQuery.isValidating && !selectedContest ? (
          <SkeletonContestCard />
        ) : selectedContest ? (
          <ContestCard
            contest={selectedContest}
            draftCount={isLoggedIn ? (user?.draftPasses || 0) + (user?.freeDrafts || 0) : 0}
            onEnter={handleEnter}
            onDetails={handleDetails}
          />
        ) : (
          <SkeletonContestCard />
        )}
      </section>

      {/* Staging Mint Button */}
      {_isStagingMode() && user?.id && (
        <section className="mb-4 flex justify-center">
          <StagingMintButton userId={user.id} onMinted={(data) => {
            // Apply the new draftPasses count from the mint response immediately —
            // skips SSE / refreshBalance roundtrip latency that occasionally
            // delayed the header tick by several seconds.
            if (typeof data?.draftPasses === 'number') {
              updateUser({ draftPasses: data.draftPasses });
            }
            promosQuery.refreshPromos();
            void refreshBalance();
            // Safety net: if the response was missing draftPasses (e.g. the
            // server-side Firestore write hit a transient error and the
            // fallback re-read returned null), pull the value once more after
            // 2s. By then the reconciler / SSE will have caught up.
            setTimeout(() => { void refreshBalance(); }, 2000);
          }} />
        </section>
      )}

      {/* Promo Carousel */}
      <section className="mb-4">
        <PromoCarousel promos={allPromos} claimPromo={promosQuery.claimPromo} onVerifyTweet={promosQuery.verifyTweetEngagement} onGenerateReferralCode={promosQuery.generateReferralCode} />
      </section>

      {/* Contest Details Modal */}
      {selectedContest && (
        <ContestDetailsModal
          isOpen={modals.isOpen('contest-details')}
          onClose={() => modals.pop()}
          contest={selectedContest}
          onEnter={() => {
            modals.pop();
            handleEnter();
          }}
        />
      )}

      {/* Entry Flow Modal (Pass Type + Speed in one) */}
      <EntryFlowModal
        isOpen={modals.isOpen('entry-flow')}
        onClose={() => modals.closeAll()}
        onComplete={handleEntryComplete}
        paidPasses={user?.draftPasses || 0}
        freePasses={user?.freeDrafts || 0}
        isSubmitting={isJoiningDraft}
      />

      {/* Buy Passes Modal — only mount when open to prevent useFundWallet crash */}
      {modals.isOpen('buy-passes') && (
        <BuyPassesModal
          isOpen={true}
          onClose={() => modals.closeAll()}
          onPurchaseComplete={handlePurchaseComplete}
        />
      )}

    </div>
  );
}
