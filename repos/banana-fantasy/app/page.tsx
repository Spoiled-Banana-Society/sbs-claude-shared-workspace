'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { ContestCard } from '@/components/home/ContestCard';
import { PromoCarousel } from '@/components/home/PromoCarousel';
import { TopBanners } from '@/components/home/TopBanners';
import { ContestDetailsModal } from '@/components/modals/ContestDetailsModal';
import { EntryFlowModal } from '@/components/modals/EntryFlowModal';
import { JoiningLobbyOverlay } from '@/components/drafting/JoiningLobbyOverlay';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false }
);
import { useAuth } from '@/hooks/useAuth';
import { useModalStack } from '@/hooks/useModalStack';
import { useContests } from '@/hooks/useContests';
import { usePromos } from '@/hooks/usePromos';
import { SkeletonContestCard } from '@/components/ui/Skeleton';
import { useEnterDraft } from '@/hooks/useEnterDraft';
import { useDepositEntry } from '@/hooks/useDepositEntry';
import { DEPOSITS_ENABLED } from '@/lib/deposits';
import { AddFundsModal } from '@/components/modals/AddFundsModal';
import { BuyPassesBalanceModal } from '@/components/modals/BuyPassesBalanceModal';

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
        // No toasts (Boris 2026-07-10): promo milestones surface via the
        // server-created bell only.
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
  const { isLoggedIn, user, setShowLoginModal, updateUser, refreshBalance } = useAuth();
  const [isJoiningDraft] = React.useState(false);
  const [showAddFunds, setShowAddFunds] = React.useState(false);
  const contestsQuery = useContests();
  const promosQuery = usePromos({ userId: user?.id });
  // Client self-ping for new promos REMOVED 2026-07-03 (it double-belled on
  // top of launch broadcasts — the July 4th promo incident). `isNew` on a
  // promo is now a purely visual ribbon; announcements are broadcast-only.

  // Shared entry flow — identical to the /drafting "Enter draft" path. Shows the
  // branded "Joining lobby" overlay, joins BEFORE navigating, and seeds the room
  // URL with id/players/joinedAt so the lobby paints fully populated (no blank,
  // no count-pop-in). Single source of truth in useEnterDraft so the two entry
  // points can't drift and reintroduce the old home-page glitch.
  const { joiningLobby, joinError, clearJoinError, enterDraftWithPassType } = useEnterDraft();
  const { buying: depositBuying, buyError: depositBuyError, clearBuyError, buyPassWithBalance, buyPassesWithBalance } = useDepositEntry();

  const allPromos = promosQuery.promos || [];

  const selectedContest = contestsQuery.data?.[0];
  const modals = useModalStack();


  const handleEnter = () => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    // One chooser for everyone (Richard 2026-07-22): pass / free pass / buy.
    // It handles the zero-pass case itself — row 1 becomes the $25 buy-in, or
    // routes to Add Funds when the balance can't cover it.
    modals.push('entry-flow');
  };

  const handleEntryComplete = async (passType: 'paid' | 'free' | 'balance', speed: 'fast' | 'slow') => {
    if (passType === 'balance') {
      // Bought from balance inside the chooser (user holds a free pass but wants
      // a paid seat). Modal stays open until the charge lands so a failure is
      // visible; success falls through to the same shared entry flow.
      const ok = await buyPassWithBalance();
      if (!ok) return;
      modals.closeAll();
      void enterDraftWithPassType('paid', speed);
      return;
    }
    modals.closeAll();
    // Hand off to the single shared entry flow — pass gate, join-before-navigate,
    // overlay, promo-type, and URL seeding all live in useEnterDraft now.
    void enterDraftWithPassType(passType, speed);
  };

  const handleBuyFromBalance = async (qty: number) => {
    const ok = await buyPassesWithBalance(qty);
    if (!ok) return; // error stays visible in the sheet
    modals.closeAll();
  };

  const handlePurchaseComplete = () => {
    // Don't close BuyPassesModal — let it handle pick-speed → join → redirect internally
  };

  const handleDetails = () => {
    modals.push('contest-details');
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 pt-4 sm:pt-16 pb-28 lg:pb-8 flex flex-col min-h-[calc(100vh-64px)]">
      {/* Get-the-App + First-Purchase nudges, in one responsive row: side by
          side on desktop, stacked on mobile, centered when only one shows.
          Each ×-dismissible. The First-Purchase promo CARD in the carousel
          below is independent — it follows the promo rules, not this banner. */}
      <TopBanners />

      {/* Special Draft Banner removed — special drafts now show on /drafting page */}

      {/* Founder Draft banner removed (Boris 2026-06-20) — users get the founder
          notification instead. Component kept at components/home/FounderDraftBanner.tsx. */}

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

      {/* Staging Mint Button — staging only; never renders in prod */}
      {process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging' && user?.id && (
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
        onClose={() => { clearBuyError(); modals.closeAll(); }}
        onComplete={(passType, speed) => void handleEntryComplete(passType, speed)}
        paidPasses={user?.draftPasses || 0}
        freePasses={user?.freeDrafts || 0}
        isSubmitting={isJoiningDraft || depositBuying}
        depositsEnabled={DEPOSITS_ENABLED}
        balanceUsd={user?.usdcBalance ?? 0}
        balanceError={depositBuyError}
        onAddFunds={() => { clearBuyError(); modals.closeAll(); setShowAddFunds(true); }}
        onBuyMore={() => {
          clearBuyError();
          modals.closeAll();
          modals.push(DEPOSITS_ENABLED ? 'buy-from-balance' : 'buy-passes');
        }}
      />

      {/* Buy passes from balance — no card/USDC pickers, just how many. */}
      <BuyPassesBalanceModal
        isOpen={modals.isOpen('buy-from-balance')}
        onClose={() => { clearBuyError(); modals.closeAll(); }}
        onBuy={(qty) => void handleBuyFromBalance(qty)}
        balanceUsd={user?.usdcBalance ?? 0}
        busy={depositBuying}
        error={depositBuyError}
        onAddFunds={() => { clearBuyError(); modals.closeAll(); setShowAddFunds(true); }}
      />

      {/* Add Funds — mount only while open (useFundWallet crash rule) */}
      {showAddFunds && (
        <AddFundsModal isOpen={true} onClose={() => setShowAddFunds(false)} />
      )}

      {/* Buy Passes Modal — only mount when open to prevent useFundWallet crash */}
      {modals.isOpen('buy-passes') && (
        <BuyPassesModal
          isOpen={true}
          onClose={() => modals.closeAll()}
          onPurchaseComplete={handlePurchaseComplete}
        />
      )}

      {/* Branded "Joining lobby…" transition while the join call is in flight,
          covering the hand-off into the room (matches the /drafting flow). */}
      <JoiningLobbyOverlay show={joiningLobby} error={joinError} onDismiss={clearJoinError} />

    </div>
  );
}
