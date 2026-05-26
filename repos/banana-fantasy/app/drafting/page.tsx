'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ActiveDraftsList } from '@/components/drafting/ActiveDraftsList';
import { BatchProofBanner } from '@/components/drafting/BatchProofBanner';
// CompletedDraftsList moved to Standings page
import { PromosSidebar } from '@/components/drafting/PromosSidebar';
import { Tooltip } from '@/components/ui/Tooltip';
import { PromoModal } from '@/components/modals/PromoModal';
import { EntryFlowModal } from '@/components/modals/EntryFlowModal';
import { ContestDetailsModal } from '@/components/modals/ContestDetailsModal';

const BuyPassesModal = dynamic(
  () => import('@/components/modals/BuyPassesModal').then(m => m.BuyPassesModal),
  { ssr: false },
);
// useHistory moved to Standings page
import { logger } from '@/lib/logger';
import { formatCountdown, formatRelativeTime, useDraftingPageState } from '@/hooks/useDraftingPageState';

const INFO_TOPICS: Record<string, { title: string; items: { q: string; a: string }[] }> = {
  '10-players': {
    title: '10 Players',
    items: [
      { q: 'Is this like a traditional league?', a: 'No — this is a tournament contest. You draft against 9 other players and top finishers advance through playoffs for the grand prize pool. Enter as many drafts as you want — more teams, more paths to the playoffs.' },
      { q: 'How does a draft lobby work?', a: 'You join a draft room that fills up to 10 players. Once full, the draft starts immediately — no scheduled times, no waiting.' },
      { q: 'What happens when 10 players join?', a: 'A 60-second countdown starts and your draft type is revealed slot machine style — Jackpot (1%), HOF (5%), or Pro (94%). Then you draft!' },
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
      { q: 'How is the distribution guaranteed?', a: 'Every 100 paid drafts contains exactly 94 Pro, 5 HOF, and 1 Jackpot. The order is randomized but the distribution is guaranteed — it\'s not random odds. On top of this, players can also win extra Jackpot and HOF entries on the Banana Wheel.' },
    ],
  },
  hof: {
    title: 'Hall of Fame',
    items: [
      { q: 'What is a Hall of Fame Draft?', a: 'HOF Drafts are premium draft rooms making up 5% of all drafts. Your team competes for a separate bonus prize pool on top of the regular tournament prizes.' },
      { q: 'How do I get into a HOF Draft?', a: 'Every draft has a chance to become a HOF. When your draft room fills to 10 players, the slot machine reveals your draft type. You can also win guaranteed HOF entries on the Banana Wheel.' },
    ],
  },
  jackpot: {
    title: 'Jackpot',
    items: [
      { q: 'What is a Jackpot Draft?', a: 'Jackpot Drafts are the rarest and most valuable draft type — only 1% of all drafts. If you win your league in a Jackpot draft, you skip straight to the finals, bypassing two weeks of playoffs.' },
      { q: 'How do I get into a Jackpot Draft?', a: 'Every draft has a chance to become a Jackpot. When your draft room fills to 10 players, the slot machine reveals your draft type. You can also win guaranteed Jackpot entries on the Banana Wheel.' },
      { q: 'What exactly happens if I win?', a: 'Win your 10-person Jackpot league during the regular season (Weeks 1-14) and you advance directly to the Week 17 finals, skipping the Week 15 and Week 16 playoff rounds entirely.' },
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
    showContestDetails,
    infoTopic,
    handleEnterDraft,
    handleEntryComplete,
    handleDraftClick,
    handleClaim,
    confirmExitDraft,
    getLiveState,
    setExitingDraft,
    setShowBuyPasses,
    setSelectedPromo,
    setPromoIndex,
    setPromoAutoRotate,
    setShowEntryFlow,
    setShowContestDetails,
    setInfoTopic,
  } = useDraftingPageState();

  const topic = infoTopic ? INFO_TOPICS[infoTopic] : null;
  // Render localStorage-cached drafts instantly. Only show the empty-state
  // hero once we're sure the user has nothing — both auth done and the live
  // API has returned. Otherwise a refresh would flash the welcome screen
  // before the API confirms what's actually active.
  const showEmptyHero = !isLoading && activeDrafts.length === 0;
  const showLoadingSkeleton = isLoading && activeDrafts.length === 0;

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      {claimSuccess.show && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-banana text-black px-6 py-3 rounded-xl font-semibold shadow-lg animate-bounce">
          +{claimSuccess.count} Spin{claimSuccess.count > 1 ? 's' : ''} Claimed!
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-white">My Drafts</h1>
        </div>
        <div className="flex items-center gap-2">
          {activeDrafts.length > 0 && (
            <>
              <button
                onClick={handleEnterDraft}
                className="w-28 py-2 text-sm font-semibold border-2 border-banana text-banana rounded-lg hover:bg-banana hover:text-black hover:scale-105 transition-all"
              >
                New Draft
              </button>
              <button
                onClick={() => router.push('/buy-drafts')}
                className="w-28 py-2 text-sm font-semibold bg-banana text-black border-2 border-banana rounded-lg hover:scale-105 transition-all"
              >
                Buy Drafts
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-6" />

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
                    <p className="text-[15px] mt-3">
                      <span className="font-bold text-banana">$100K</span>
                      <span className="text-white/30 font-medium"> Prize Pool</span>
                      <span className="text-white/15 mx-1.5">&middot;</span>
                      <span className="font-semibold text-white/70">$25K</span>
                      <span className="text-white/30 font-medium"> 1st Place</span>
                    </p>
                    <div className="mt-6">
                      <button
                        onClick={handleEnterDraft}
                        className="px-10 py-3.5 bg-banana text-black font-bold text-[15px] rounded-full hover:brightness-110 active:scale-[0.98] transition-all"
                      >
                        Enter Draft
                      </button>
                    </div>
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
                        <p className="text-white/50 text-[12px] mt-1 leading-[1.6]">Draft <span className="text-white/50 font-medium">KC QB</span> or <span className="text-white/50 font-medium">DAL WR1</span> — not individual players. You get the top scorer at that position each week.</p>
                      </button>
                      <button onClick={() => setInfoTopic('best-ball')} className="rounded-2xl p-4 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left cursor-pointer">
                        <h4 className="text-white text-[14px] font-semibold tracking-tight">Best Ball</h4>
                        <p className="text-white/50 text-[12px] mt-1 leading-[1.6]">No managing needed. Draft once, best scorers auto-selected weekly. No lineups, waivers, or trades.</p>
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[13px] font-semibold text-white/40 uppercase tracking-[0.12em] mb-3 px-1">Draft Types</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => setInfoTopic('pro')}
                        className="rounded-2xl p-4 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
                        style={{ background: 'linear-gradient(160deg, rgba(168,85,247,0.06) 0%, transparent 60%)' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-white text-[14px] font-semibold tracking-tight">Pro</h4>
                          <span className="text-white/15">&middot;</span>
                          <span className="text-[15px] font-bold tracking-tight text-pro">94%</span>
                        </div>
                        <p className="text-white/50 text-[12px] leading-[1.6]">Standard draft. Compete for your share of the prize pool.</p>
                      </button>
                      <button
                        onClick={() => setInfoTopic('hof')}
                        className="rounded-2xl p-4 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
                        style={{ background: 'linear-gradient(160deg, rgba(212,175,55,0.06) 0%, transparent 60%)' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-white text-[14px] font-semibold tracking-tight">Hall of Fame</h4>
                          <span className="text-white/15">&middot;</span>
                          <span className="text-[15px] font-bold tracking-tight text-hof">5%</span>
                        </div>
                        <p className="text-white/50 text-[12px] leading-[1.6]">Bonus prize pool on top of standard rewards.</p>
                      </button>
                      <button
                        onClick={() => setInfoTopic('jackpot')}
                        className="rounded-2xl p-4 hover:bg-white/[0.02] transition-colors text-left cursor-pointer"
                        style={{ background: 'linear-gradient(160deg, rgba(239,68,68,0.06) 0%, transparent 60%)' }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-white text-[14px] font-semibold tracking-tight">Jackpot</h4>
                          <span className="text-white/15">&middot;</span>
                          <span className="text-[15px] font-bold tracking-tight text-jackpot">1%</span>
                        </div>
                        <p className="text-white/50 text-[12px] leading-[1.6]">Win your league and skip straight to the finals. The rarest draft type.</p>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        <aside className="w-56 shrink-0 hidden lg:flex flex-col gap-4">
          <PromosSidebar
            promos={promos}
            promoIndex={promoIndex}
            promoCount={promoCount}
            claimedPromos={claimedPromos}
            onSelectPromo={setSelectedPromo}
            onClaim={handleClaim}
            onSelectIndex={(index) => {
              setPromoIndex(index);
              setPromoAutoRotate(false);
            }}
            onPrev={() => {
              if (promoCount === 0) return;
              setPromoIndex((promoIndex - 1 + promoCount) % promoCount);
              setPromoAutoRotate(false);
            }}
            onNext={() => {
              if (promoCount === 0) return;
              setPromoIndex((promoIndex + 1) % promoCount);
              setPromoAutoRotate(false);
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
        onClose={() => setShowEntryFlow(false)}
        onComplete={handleEntryComplete}
        paidPasses={user?.draftPasses || 0}
        freePasses={user?.freeDrafts || 0}
      />

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
  );
}
