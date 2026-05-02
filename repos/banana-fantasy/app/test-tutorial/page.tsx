'use client';

import { useEffect, useRef, useState } from 'react';
import { useDraftEngine } from '@/hooks/useDraftEngine';
import { useTutorial } from '@/hooks/useTutorial';
import { useAuth } from '@/hooks/useAuth';
import { DraftRoomDrafting } from '@/components/drafting/DraftRoomDrafting';
import type { DraftTab } from '@/components/drafting/DraftTabs';
import DraftTutorial, { DRAFT_TUTORIAL_STEPS, type TutorialTab } from '@/components/tutorial/DraftTutorial';
import { DRAFT_PLAYERS } from '@/lib/draftRoomConstants';

/**
 * Onboarding tutorial. Spins up the same useDraftEngine that powers the
 * live draft room, seeded with a local-mode draft against bots, then layers
 * DraftTutorial popovers on top to walk a new user through the four tabs
 * (Draft / Queue / Board / Roster). Picking a player is real — the engine
 * reacts to the user's actions exactly as it does in production, just with
 * mock opponents instead of WebSocket peers. This guarantees what users
 * learn here is exactly how the real draft room behaves.
 */

const MOCK_USERNAME = 'Tutorial';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TestTutorialPage() {
  const { user } = useAuth();
  const engine = useDraftEngine('local');
  const tutorialState = useTutorial(DRAFT_TUTORIAL_STEPS.length);
  const [activeTab, setActiveTab] = useState<DraftTab>('draft');
  const [rosterViewPlayer, setRosterViewPlayer] = useState<string | undefined>();
  const bannerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // Seed the local-mode draft on mount. DRAFT_PLAYERS already has 'You' as
  // index 0, so the user picks first — keeps the snake-order arithmetic
  // simple and means the user can immediately practice making a pick.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    engine.initializeDraft([...DRAFT_PLAYERS]);
  }, [engine]);

  // Tutorial overlay only knows about 4 tabs (no chat). Mirror the engine's
  // tab to a TutorialTab when relevant; coerce 'chat' back to 'draft' so the
  // overlay's required-tab logic doesn't try to switch into a tab it doesn't
  // recognize.
  const tutorialActiveTab: TutorialTab =
    activeTab === 'chat' ? 'draft' : activeTab;
  const handleTutorialTab = (tab: TutorialTab) => setActiveTab(tab);

  return (
    <>
      <DraftRoomDrafting
        engine={engine}
        phase="drafting"
        visibleDraftType="pro"
        mainCountdown={engine.timeRemaining}
        bestTimeRemaining={engine.timeRemaining}
        formatTime={formatTime}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        draftId="tutorial"
        urlDraftId="tutorial"
        generatedCardUrl={null}
        walletParam=""
        playerCount={DRAFT_PLAYERS.length}
        user={{
          username: user?.username ?? MOCK_USERNAME,
          profilePicture: user?.profilePicture ?? null,
        }}
        bannerRef={bannerRef}
        onViewRoster={(name) => {
          setRosterViewPlayer(name);
          setActiveTab('roster');
        }}
        rosterViewPlayer={rosterViewPlayer}
        onDraftPlayer={(playerId) => engine.draftPlayer(playerId)}
        onQueueSync={() => {
          // Local-mode engine manages its own queue via add/remove/reorder
          // already wired into DraftQueue; this prop exists for live-mode
          // server sync, no-op here.
        }}
        onSortChange={() => {
          // Sort preference persistence is wired in live mode; tutorial just
          // resets to default each session.
        }}
        showBanner
      />
      <DraftTutorial
        {...tutorialState}
        activeTab={tutorialActiveTab}
        setActiveTab={handleTutorialTab}
      />
    </>
  );
}
