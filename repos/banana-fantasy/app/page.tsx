'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ContestCard } from '@/components/home/ContestCard';
import { PromoCarousel } from '@/components/home/PromoCarousel';
import { AddToHomeScreenCard } from '@/components/home/AddToHomeScreenCard';
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
import { isStagingMode as _isStagingMode } from '@/lib/staging';
import { SkeletonContestCard } from '@/components/ui/Skeleton';
import { consumePromoDraftType, peekPromoDraftType } from '@/lib/promoDraftType';
import * as draftStore from '@/lib/draftStore';

export default function HomePage() {
  const router = useRouter();
  const { isLoggedIn, user, setShowLoginModal, updateUser } = useAuth();
  const [isJoiningDraft] = React.useState(false);
  const contestsQuery = useContests();
  const promosQuery = usePromos({ userId: user?.id });

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

  const handleEntryComplete = (passType: 'paid' | 'free', speed: 'fast' | 'slow') => {
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

    // Deduct the selected pass type (optimistic)
    if (passType === 'paid') {
      updateUser({ draftPasses: Math.max(0, paidPasses - 1) });
    } else {
      updateUser({ freeDrafts: Math.max(0, freePasses - 1) });
    }

    // Consume promo draft type if queued
    const forcedDraftType = peekPromoDraftType();
    if (forcedDraftType) {
      consumePromoDraftType(forcedDraftType);
    }

    if (_isStagingMode()) {
      // Staging: navigate IMMEDIATELY — draft room handles joinDraft + fill-bots
      const params = new URLSearchParams({
        speed,
        mode: 'live',
        wallet: user.walletAddress,
      });
      if (forcedDraftType) params.set('promoType', forcedDraftType);
      router.push(`/draft-room?${params.toString()}`);
    } else {
      // Non-staging: use local draft with bots (no API call needed)
      const localDraftId = `local-${Date.now()}`;
      const localContestName = `BBB #${Math.floor(Math.random() * 9000) + 1000}`;
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
        fillingStartedAt: Date.now(),
        fillingInitialPlayers: 1,
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

      {/* Promo Carousel */}
      <section className="mb-4">
        <PromoCarousel promos={promosQuery.promos || []} />
      </section>

      <AddToHomeScreenCard />

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
