'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ActiveDraftsList } from '@/components/drafting/ActiveDraftsList';
import LiveDraftActivityLine from '@/components/drafting/LiveDraftActivityLine';
import NextLobbyLine from '@/components/drafting/NextLobbyLine';
import { BatchProofBanner } from '@/components/drafting/BatchProofBanner';
// CompletedDraftsList moved to Standings page
import { PromosSidebar } from '@/components/drafting/PromosSidebar';
import { PromoCarousel } from '@/components/home/PromoCarousel';
import { Tooltip } from '@/components/ui/Tooltip';
import { PromoModal } from '@/components/modals/PromoModal';
import { EntryFlowModal } from '@/components/modals/EntryFlowModal';
import { AddFundsModal } from '@/components/modals/AddFundsModal';
import { FirstPurchaseClaimModal, type ClaimVariant } from '@/components/modals/FirstPurchaseClaimModal';
import { BuyPassesBalanceModal } from '@/components/modals/BuyPassesBalanceModal';
import { DEPOSITS_ENABLED } from '@/lib/deposits';
import { API_CONFIG } from '@/lib/api/config';
import { JoiningLobbyOverlay } from '@/components/drafting/JoiningLobbyOverlay';
import { ContestDetailsModal } from '@/components/modals/ContestDetailsModal';
import { DraftInfoModal } from '@/components/modals/DraftInfoModal';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false },
);
// useHistory moved to Standings page
import { logger } from '@/lib/logger';
import { formatCountdown, formatRelativeTime, useDraftingPageState } from '@/hooks/useDraftingPageState';
import { useDraftAlertsConfigured } from '@/hooks/useDraftAlertsConfigured';

const INFO_TOPICS: Record<string, { title: string; items: { q: string; a: string }[] }> = {
  '10-players': {
    title: '10 Players',
    items: [
      { q: 'Is this like a traditional league?', a: 'No — this is a tournament contest. You draft against 9 other players and top finishers advance through playoffs for the grand prize pool. Enter as many drafts as you want — more teams, more paths to the playoffs.' },
      { q: 'How does a draft lobby work?', a: 'You join a draft room that fills up to 10 players. Once full, the draft starts immediately — no scheduled times, no waiting.' },
      { q: 'What happens when 10 players join?', a: 'A 60-second countdown starts and your draft type is revealed slot machine style — Jackpot, HOF, the ultra-rare JackHOF (both on one draft), or Pro. Then you draft!' },
    ],
  },
  'snake-draft': {
    title: 'Snake Draft',
    items: [
      { q: 'What is a snake draft?', a: 'Pick order reverses each round. If you pick 1st in round 1, you pick 10th in round 2, then 1st again in round 3. This keeps things fair for everyone.' },
      { q: 'Fast or slow — what\'s the difference?', a: 'You choose your speed before each draft. Fast drafts give you 30 seconds per pick — the whole draft takes about 15-20 minutes. Slow drafts give you 8 hours per pick, perfect if you want to draft over a few days.' },
      { q: 'How many rounds?', a: '15 rounds. You draft a full roster: 1 QB, 2 RB, 3 WR, 1 TE, 2 FLEX, 1 K, 1 DEF, plus bench spots.' },
    ],
  },
  'team-positions': {
    title: 'Team Positions',
    items: [
      { q: 'What are Team Positions?', a: 'Instead of drafting individual players like Patrick Mahomes, you draft Team Positions like "KC QB". Each week, you automatically get the points from the highest-scoring player at that position for that team.' },
      { q: 'How does this protect against injuries?', a: 'In traditional fantasy, one injury can destroy your season. With Team Positions, if a starter gets hurt, you automatically get points from whoever replaces them. Your team stays competitive all season regardless of injuries.' },
    ],
  },
  'best-ball': {
    title: 'Best Ball',
    items: [
      { q: 'What is Best Ball?', a: 'Best Ball is a set-it-and-forget-it format. After you draft your team, the platform automatically starts your highest-scoring players each week. No lineup management, no waivers, no trades — just draft and watch.' },
      { q: 'How does scoring work?', a: 'Each week, your best players at each position are automatically selected based on their actual performance. Your weekly score is the sum of your best performers according to your roster requirements.' },
      { q: 'Can I trade or drop players?', a: 'No trades or waivers in Best Ball — that\'s the beauty of it! However, you can sell your entire team on our marketplace at any time if you want out.' },
    ],
  },
  pro: {
    title: 'Pro Draft',
    items: [
      { q: 'What is a Pro Draft?', a: 'Pro is the standard draft type, making up 94% of all drafts. Compete against 9 other players for your share of the prize pool.' },
      { q: 'How do I win?', a: 'Top 2 in your 10-person league make it to the playoffs to compete for the grand prize pool. The better you finish, the further you go.' },
      { q: 'How is the distribution guaranteed?', a: 'A Jackpot is always hiding within the next 100 drafts, and every rolling 100-draft window carries 5 HOF — each window resets the moment its guarantee hits, so the specials never dry up. It\'s provably random but the guarantees are locked. On top of this, players can also win Jackpot, HOF, and JackHOF entries on the Banana Wheel.' },
    ],
  },
  hof: {
    title: 'Hall of Fame',
    items: [
      { q: 'What is a Hall of Fame Draft?', a: 'HOF Drafts are premium draft rooms making up 5% of all drafts. Your team competes for a separate bonus prize pool on top of the regular tournament prizes.' },
      { q: 'How do I get into a HOF Draft?', a: 'Two ways. 1) The reveal: every paid draft has a shot — when your room fills to 10, the slot machine reveals your type, and 5 HOF are guaranteed in every rolling 100-draft window. 2) The Banana Wheel: land on HOF and you win a guaranteed seat in a HOF draft (from the Wheel), free.' },
      { q: 'What happens when I win a HOF on the Banana Wheel?', a: 'You\'re seated in a HOF draft (from the Wheel) instantly — you\'ll see it in your lobby right away. The draft starts automatically the moment 10 wheel winners have joined. It\'s a slow draft with 8 hours per pick (the clock pauses overnight), so there\'s plenty of time to make every pick.' },
      { q: 'Can I leave or sell a wheel-won HOF seat?', a: 'Your seat is locked — there\'s no leaving a Wheel draft. Before the draft fills you can sell the pass on the SBS Marketplace and the buyer takes your seat — it\'s the only draft pass that can ever be sold. After the draft wraps you can sell your team too. The only time you can\'t sell is while the draft is live.' },
      { q: 'Do wheel-won HOF drafts count toward promos?', a: 'No. Wheel-won drafts are free drafts and never earn promos — no free spin for a Slot 10, and they don\'t count toward the 4-drafts-in-a-day promo.' },
    ],
  },
  jackpot: {
    title: 'Jackpot',
    items: [
      { q: 'What is a Jackpot Draft?', a: 'Jackpot Drafts are the rarest and most valuable draft type — only 1% of all drafts. If you win your league in a Jackpot draft, you skip straight to the finals, bypassing two weeks of playoffs.' },
      { q: 'How do I get into a Jackpot Draft?', a: 'Two ways. 1) The reveal: every paid draft has a shot — when your room fills to 10, the slot machine reveals your type, and a Jackpot is always within 100 drafts of the last one. 2) The Banana Wheel: land on Jackpot and you win a guaranteed seat in a Jackpot draft (from the Wheel), free.' },
      { q: 'What happens when I win a Jackpot on the Banana Wheel?', a: 'You\'re seated in a Jackpot draft (from the Wheel) instantly — you\'ll see it in your lobby right away. The draft starts automatically the moment 10 wheel winners have joined. It\'s a slow draft with 8 hours per pick (the clock pauses overnight), so there\'s plenty of time to make every pick.' },
      { q: 'Can I leave or sell a wheel-won Jackpot seat?', a: 'Your seat is locked — there\'s no leaving a Wheel draft. Before the draft fills you can sell the pass on the SBS Marketplace and the buyer takes your seat — it\'s the only draft pass that can ever be sold. After the draft wraps you can sell your team too. The only time you can\'t sell is while the draft is live.' },
      { q: 'Do wheel-won Jackpot drafts count toward promos?', a: 'No. Wheel-won drafts are free drafts and never earn promos — no free spin for a Slot 10, and they don\'t count toward the 4-drafts-in-a-day promo.' },
      { q: 'What exactly happens if I win?', a: 'Win your 10-person Jackpot league during the regular season (Weeks 1-14) and you advance directly to the Week 17 finals, skipping the Week 15 and Week 16 playoff rounds entirely.' },
    ],
  },

  jackhof: {
    title: 'JackHOF',
    items: [
      { q: 'What is a JackHOF Draft?', a: 'The rarest draft in SBS — the Jackpot and a HOF landing on the SAME draft (~1 in 800). A JackHOF league carries BOTH perks: win it and you skip straight to the finals AND compete in the HOF bonus track.' },
      { q: 'How do I get into a JackHOF Draft?', a: 'Two ways. 1) The reveal: the Jackpot and HOF positions are drawn independently — when they collide on one draft, the slot machine reveals JackHOF. 2) The Banana Wheel: the 0.1% JackHOF wedge wins you a guaranteed seat in a JackHOF draft (from the Wheel), free.' },
      { q: 'What exactly happens if I win?', a: 'Everything. You advance directly to the Week 17 finals (the Jackpot perk) and your team also enters the separate HOF playoff track for bonus prizes (the HOF perk). Your draft token gets the exclusive red-and-gold JackHOF border.' },
    ],
  },
};

export default function DraftingPage() {
  const router = useRouter();
  const {
    contest,
    promosQuery,
    promos,
    promoCount,
    isLoading,
    user,
    activeDrafts,
    regularDrafts,
    specialDrafts,
    creatingQueueDraft,
    exitingDraft,
    showBuyPasses,
    selectedPromo,
    claimedPromos,
    claimSuccess,
    promoIndex,
    showEntryFlow,
    joiningLobby,
    joinError,
    clearJoinError,
    showContestDetails,
    infoTopic,
    handleEnterDraft,
    handleEntryComplete,
    showAddFunds,
    setShowAddFunds,
    depositBuying,
    depositBuyError,
    clearDepositBuyError,
    handleDraftClick,
    handleClaim,
    confirmExitDraft,
    getLiveState,
    setExitingDraft,
    setShowBuyPasses,
    showBuyFromBalance,
    setShowBuyFromBalance,
    handleBuyFromBalance,
    setSelectedPromo,
    setPromoIndex,
    setShowEntryFlow,
    setShowContestDetails,
    setInfoTopic,
  } = useDraftingPageState();
  const { configured: draftAlertsConfigured } = useDraftAlertsConfigured();

  const [showDraftInfo, setShowDraftInfo] = React.useState(false);
  const [fpClaim, setFpClaim] = React.useState<{ variant: ClaimVariant; depositUsd?: number } | null>(null);
  const topic = infoTopic ? INFO_TOPICS[infoTopic] : null;
  // Render localStorage-cached drafts instantly. Only show the empty-state
  // hero once we're sure the user has nothing — both auth done and the live
  // API has returned. Otherwise a refresh would flash the welcome screen
  // before the API confirms what's actually active.
  const showEmptyHero = !isLoading && activeDrafts.length === 0;
  const showLoadingSkeleton = isLoading && activeDrafts.length === 0;

  return (
    <>
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      {claimSuccess.show && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-banana text-black px-6 py-3 rounded-xl font-semibold shadow-lg animate-bounce">
          +{claimSuccess.count} Spin{claimSuccess.count > 1 ? 's' : ''} Claimed!
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 mb-8">
        <div className="flex items-baseline gap-3">
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Drafts</h1>
            <button
              onClick={() => setShowDraftInfo(true)}
              aria-label="How drafts work, contest details & FAQ"
              className="self-center -translate-y-[3px] text-white/30 hover:text-white/60 transition-colors"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          </div>
          {/* Rankings = pre-draft tool, kept as a quiet text link beside the
              title. */}
          <button
            onClick={() => router.push('/rankings')}
            aria-label="Pre-rank players and set auto-draft limits"
            className="text-sm font-medium text-white/45 hover:text-banana transition-colors"
          >
            Rankings
          </button>
          {/* Draft Alerts — same quiet link, right of Rankings. Disappears once
              the user has set alerts up (any toggle change), since they then
              know where it lives (Boris 2026-06-15). Real-time via the focus
              re-check in useDraftAlertsConfigured. */}
          {draftAlertsConfigured !== true && (
            <button
              onClick={() => router.push('/notifications/settings')}
              aria-label="Set up draft alerts — get notified when your draft starts and when it's your pick"
              className="text-sm font-medium text-white/45 hover:text-banana transition-colors"
            >
              Draft Alerts
            </button>
          )}
        </div>
        {activeDrafts.length > 0 && !user?.draftBlocked && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleEnterDraft}
              className="w-32 py-2 text-sm font-semibold bg-banana text-black border-2 border-banana rounded-full hover:brightness-110 hover:scale-105 transition-all"
            >
              Enter
            </button>
            {/* Buy CTA only exists in the pre-deposit world — with the
                bankroll live, Enter covers pass / balance / add-funds. */}
            {!DEPOSITS_ENABLED && (
              <button
                onClick={() => router.push('/buy-drafts?buy=1')}
                className="w-32 py-2 text-sm font-semibold border-2 border-banana text-banana rounded-full hover:bg-banana hover:text-black hover:scale-105 transition-all"
              >
                Buy
              </button>
            )}
          </div>
        )}
      </div>

      {/* "Keep waiting" nudge — how many fast drafts are going + the furthest
          round. Renders nothing when the flag is off or nothing's live. */}
      <LiveDraftActivityLine className="-mt-4 mb-6" />

      {/* How full the lobby you'd land in is, before you press Enter. Renders
          nothing when neither lane has a partially-filled lobby. */}
      <NextLobbyLine className="-mt-2 mb-6" />

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          {true ? (
            <>
              <ActiveDraftsList
                regularDrafts={regularDrafts}
                specialDrafts={specialDrafts}
                creatingQueueDraft={creatingQueueDraft}
                getLiveState={getLiveState}
                onDraftClick={handleDraftClick}
                onExitDraft={setExitingDraft}
                formatRelativeTime={formatRelativeTime}
                formatCountdown={formatCountdown}
              />

              {showLoadingSkeleton && (
                <div className="space-y-3 pt-2" aria-label="Loading your drafts">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="h-20 rounded-xl bg-white/[0.04] border border-white/5 animate-pulse"
                    />
                  ))}
                </div>
              )}

              {showEmptyHero && (
                <div className="space-y-4">
                  <div className="text-center pt-10 pb-4">
                    <div className="flex items-center justify-center gap-2.5">
                      <h2 className="text-3xl font-bold text-white tracking-tight">Banana Best Ball IV</h2>
                      <Tooltip content="Contest Details">
                        <button
                          onClick={() => setShowContestDetails(true)}
                          className="text-white/25 hover:text-white/50 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="16" x2="12" y2="12" />
                            <line x1="12" y1="8" x2="12.01" y2="8" />
                          </svg>
                        </button>
                      </Tooltip>
                    </div>
                    <p className="text-[15px] sm:text-[19px] mt-3">
                      <span className="font-extrabold text-banana">$100,000</span>
                      <span className="text-white/30 font-medium"> GTD Prize Pool</span>
                      <span className="text-white/15 mx-1.5">&middot;</span>
                      <span className="font-bold text-white/70">$25,000</span>
                      <span className="text-white/30 font-medium"> 1st Place</span>
                    </p>
                    {user?.draftBlocked ? (
                      <p className="mt-6 text-center text-sm text-white/45">Drafting is disabled on this account. You can still view your teams.</p>
                    ) : (
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <button
                        onClick={handleEnterDraft}
                        className="w-36 py-3.5 bg-banana text-black border-2 border-banana font-bold text-[15px] rounded-full hover:brightness-110 active:scale-[0.98] transition-all"
                      >
                        Enter
                      </button>
                      {!DEPOSITS_ENABLED && (
                        <button
                          onClick={() => router.push('/buy-drafts?buy=1')}
                          className="w-36 py-3.5 border-2 border-banana text-banana font-bold text-[15px] rounded-full hover:bg-banana hover:text-black active:scale-[0.98] transition-all"
                        >
                          Buy
                        </button>
                      )}
                    </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-[13px] font-semibold text-white/40 uppercase tracking-[0.12em] mb-3 px-1">How it works</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => setInfoTopic('10-players')} className="rounded-2xl p-4 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left cursor-pointer">
                        <h4 className="text-white text-[14px] font-semibold tracking-tight">10 Players</h4>
                        <p className="text-white/50 text-[12px] mt-1 leading-[1.6]">Join a lobby, draft starts instantly when full</p>
                      </button>
                      <button onClick={() => setInfoTopic('snake-draft')} className="rounded-2xl p-4 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left cursor-pointer">
                        <h4 className="text-white text-[14px] font-semibold tracking-tight">Snake Draft</h4>
                        <p className="text-white/50 text-[12px] mt-1 leading-[1.6]">Fast (30s) or slow (8hr) picks — your choice</p>
                      </button>
                      <button onClick={() => setInfoTopic('team-positions')} className="rounded-2xl p-4 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left cursor-pointer">
                        <h4 className="text-white text-[14px] font-semibold tracking-tight">Team Positions</h4>
                        <p className="text-white/50 text-[12px] mt-1 leading-[1.6]">Draft <span className="text-white/50 font-medium">DAL WR1</span> and each week you get the highest-scoring Dallas wide receiver. CeeDee scores 22? You get 22. Pickens drops 30? You get 30 — always the top performer.</p>
                      </button>
                      <button onClick={() => setInfoTopic('best-ball')} className="rounded-2xl p-4 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left cursor-pointer">
                        <h4 className="text-white text-[14px] font-semibold tracking-tight">Best Ball</h4>
                        <p className="text-white/50 text-[12px] mt-1 leading-[1.6]">No managing needed. Draft once, best scorers auto-selected weekly. No lineups, waivers, or trades.</p>
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[13px] font-semibold text-white/40 uppercase tracking-[0.12em] mb-3 px-1">Draft Types</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setInfoTopic('pro')}
                        className="rounded-2xl p-4 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
                        style={{ background: 'linear-gradient(160deg, rgba(168,85,247,0.06) 0%, transparent 60%)' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-pro text-[14px] font-semibold tracking-tight">Pro</h4>
                          <span className="text-white/15">&middot;</span>
                          <span className="text-[15px] font-bold tracking-tight text-white/70">94%</span>
                        </div>
                        <p className="text-white/50 text-[12px] leading-[1.6]">Standard draft. Compete for the $100,000 GTD Prize Pool.</p>
                      </button>
                      <button
                        onClick={() => setInfoTopic('hof')}
                        className="rounded-2xl p-4 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
                        style={{ background: 'linear-gradient(160deg, rgba(212,175,55,0.06) 0%, transparent 60%)' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-hof text-[14px] font-semibold tracking-tight">Hall of Fame</h4>
                          <span className="text-white/15">&middot;</span>
                          <span className="text-[15px] font-bold tracking-tight text-white/70">5%</span>
                        </div>
                        <p className="text-white/50 text-[12px] leading-[1.6]">Bonus prize pool on top of standard rewards.</p>
                      </button>
                      <button
                        onClick={() => setInfoTopic('jackpot')}
                        className="rounded-2xl p-4 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
                        style={{ background: 'linear-gradient(160deg, rgba(239,68,68,0.06) 0%, transparent 60%)' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-jackpot text-[14px] font-semibold tracking-tight">Jackpot</h4>
                          <span className="text-white/15">&middot;</span>
                          <span className="text-[15px] font-bold tracking-tight text-white/70">1%</span>
                        </div>
                        <p className="text-white/50 text-[12px] leading-[1.6]">Win your league and skip straight to the finals.</p>
                      </button>
                      <button
                        onClick={() => setInfoTopic('jackhof')}
                        className="rounded-2xl p-4 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
                        style={{ background: 'linear-gradient(160deg, rgba(239,68,68,0.06) 0%, rgba(212,175,55,0.06) 60%, transparent 90%)' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-[14px] font-semibold tracking-tight"><span className="text-jackpot">Jack</span><span className="text-hof">HOF</span></h4>
                          <span className="text-white/15">&middot;</span>
                          <span className="text-[15px] font-bold tracking-tight text-white/70">.13%</span>
                        </div>
                        <p className="text-white/50 text-[12px] leading-[1.6]">Jackpot + HOF on one draft. Both perks.</p>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* Mobile-only: promos live in the desktop sidebar (hidden < lg).
              On phones, use the SAME square promo carousel as the Spin page.
              The VRF/proof seal moved into the draft-info modal's VRF tab
              (Boris 2026-06-15), so promos own the spacing now — pushed well
              down when there's an active draft so the lobby stays the focus. */}
          {(promosQuery.promos?.length ?? 0) > 0 && (
            <div className={`lg:hidden ${activeDrafts.length > 0 ? 'mt-32' : 'mt-9'}`}>
              <PromoCarousel
                heading="Promos"
                promos={promosQuery.promos ?? []}
                claimPromo={promosQuery.claimPromo}
                onVerifyTweet={promosQuery.verifyTweetEngagement}
                onGenerateReferralCode={promosQuery.generateReferralCode}
              />
            </div>
          )}
        </div>

        <aside className="w-56 shrink-0 hidden lg:flex flex-col gap-4 mt-14">
          <PromosSidebar
            promos={promos}
            promoIndex={promoIndex}
            promoCount={promoCount}
            loading={isLoading || promosQuery.isLoading || (!!user && promosQuery.promos === undefined)}
            claimedPromos={claimedPromos}
            onSelectPromo={setSelectedPromo}
            onClaim={handleClaim}
            onSelectIndex={setPromoIndex}
            onPrev={() => {
              if (promoCount === 0) return;
              setPromoIndex((promoIndex - 1 + promoCount) % promoCount);
            }}
            onNext={() => {
              if (promoCount === 0) return;
              setPromoIndex((promoIndex + 1) % promoCount);
            }}
          />
          <BatchProofBanner />
        </aside>
      </div>

      {/* Buy Passes Modal — only mount when open to prevent useFundWallet crash */}
      {showBuyPasses && (
        <BuyPassesModal
          isOpen={true}
          onClose={() => setShowBuyPasses(false)}
        />
      )}

      {exitingDraft && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setExitingDraft(null)}
        >
          <div
            className="bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 max-w-sm w-full cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-2">Leave Draft?</h3>
            <p className="text-white/60 mb-6">
              Are you sure you want to leave <span className="text-white font-medium">{exitingDraft.contestName}</span>? Your draft pass will be returned.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setExitingDraft(null)}
                className="flex-1 px-4 py-3 bg-transparent border border-white/50 text-white font-medium rounded-xl hover:bg-white/10 hover:scale-105 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void confirmExitDraft();
                }}
                className="flex-1 px-4 py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-400 transition-colors"
              >
                Leave Draft
              </button>
            </div>
          </div>
        </div>
      )}

      <EntryFlowModal
        isOpen={showEntryFlow}
        onClose={() => { clearDepositBuyError(); setShowEntryFlow(false); }}
        onComplete={(passType, speed) => void handleEntryComplete(passType, speed)}
        paidPasses={user?.draftPasses || 0}
        freePasses={user?.freeDrafts || 0}
        isSubmitting={depositBuying}
        depositsEnabled={DEPOSITS_ENABLED}
        balanceUsd={user?.usdcBalance ?? 0}
        balanceError={depositBuyError}
        onAddFunds={() => { clearDepositBuyError(); setShowEntryFlow(false); setShowAddFunds(true); }}
        onBuyMore={() => {
          clearDepositBuyError();
          setShowEntryFlow(false);
          if (DEPOSITS_ENABLED) setShowBuyFromBalance(true); else setShowBuyPasses(true);
        }}
      />

      {/* Buy passes from balance — no card/USDC pickers, just how many. */}
      <BuyPassesBalanceModal
        isOpen={showBuyFromBalance}
        onClose={() => { clearDepositBuyError(); setShowBuyFromBalance(false); }}
        onBuy={(qty) => void handleBuyFromBalance(qty)}
        balanceUsd={user?.usdcBalance ?? 0}
        busy={depositBuying}
        error={depositBuyError}
        onAddFunds={() => { clearDepositBuyError(); setShowBuyFromBalance(false); setShowAddFunds(true); }}
      />

      {/* Add Funds — mount only while open (useFundWallet crash rule) */}
      {showAddFunds && (
        <AddFundsModal
          isOpen={true}
          onClose={() => setShowAddFunds(false)}
          onFunded={(amountUsd) => {
            // Same post-deposit promo pitch as the header/homepage Add Funds
            // flows — this page used to skip it entirely (deposits made from
            // the draft-room entry flow got no popup at all).
            const fpOpen = user && user.firstPurchaseVariant !== 'done' && user.firstPurchaseBonusGranted !== true;
            const kickoffOpen = API_CONFIG.promos.buyBonus.enabled && Date.now() < API_CONFIG.promos.buyBonus.endsAtMs;
            if (fpOpen || kickoffOpen) {
              setShowAddFunds(false);
              setFpClaim({
                variant: fpOpen ? (user?.firstPurchaseVariant === 'returning' ? 'returning' : 'new') : 'kickoff',
                depositUsd: amountUsd,
              });
            }
          }}
        />
      )}
      {fpClaim && (
        <FirstPurchaseClaimModal
          isOpen={true}
          onClose={() => setFpClaim(null)}
          variant={fpClaim.variant}
          depositUsd={fpClaim.depositUsd}
        />
      )}

      <JoiningLobbyOverlay show={joiningLobby} error={joinError} onDismiss={clearJoinError} />

      {topic && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setInfoTopic(null)}
        >
          <div
            className="bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold text-white">{topic.title}</h3>
              <button onClick={() => setInfoTopic(null)} className="text-white/30 hover:text-white/60 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              {topic.items.map((item, i) => (
                <div key={i}>
                  <h4 className="text-white text-[14px] font-semibold">{item.q}</h4>
                  <p className="text-white/50 text-[13px] mt-1.5 leading-[1.7]">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {contest && (
        <ContestDetailsModal
          isOpen={showContestDetails}
          onClose={() => setShowContestDetails(false)}
          contest={contest}
          onEnter={() => {
            setShowContestDetails(false);
            handleEnterDraft();
          }}
        />
      )}

      <DraftInfoModal isOpen={showDraftInfo} onClose={() => setShowDraftInfo(false)} contest={contest ?? null} />

      <PromoModal
        isOpen={!!selectedPromo}
        onClose={() => setSelectedPromo(null)}
        promo={selectedPromo}
        onClaim={(promo) => {
          logger.debug('Claiming promo:', promo.id);
          setSelectedPromo(null);
          void handleClaim(promo);
        }}
        isPromoClaimed={selectedPromo ? claimedPromos.has(selectedPromo.id) : false}
        onVerifyTweet={promosQuery.verifyTweetEngagement}
        onGenerateReferralCode={promosQuery.generateReferralCode}
      />
    </div>
    </>
  );
}
