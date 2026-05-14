"use client"

import React, { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { usePrivy } from '@privy-io/react-auth';
import { useDraftAudio } from '@/hooks/useDraftAudio';
import { useDraftEngine } from '@/hooks/useDraftEngine';
import type { DraftMode } from '@/hooks/useDraftEngine';
import { useDraftLiveSync } from '@/hooks/useDraftLiveSync';
import { FounderPill } from '@/components/drafting/FounderPill';
import * as draftApi from '@/lib/draftApi';
import { leaveDraft } from '@/lib/api/leagues';
import { DraftRoomFilling } from '@/components/drafting/DraftRoomFilling';
import { DraftRoomReveal } from '@/components/drafting/DraftRoomReveal';
import { DraftRoomDrafting } from '@/components/drafting/DraftRoomDrafting';
import { BatchRandomnessLoading } from '@/components/drafting/BatchRandomnessLoading';
import { useBatchProofReady } from '@/hooks/useBatchProofReady';
import { parseDraftNumber, locateDraft } from '@/lib/batchProof';
import type { DraftTab } from '@/components/drafting/DraftTabs';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import {
  DRAFT_PLAYERS,
  TOTAL_PICKS,
  generateReelItemsForReel,
} from '@/lib/draftRoomConstants';
import type { DraftType, RoomPhase } from '@/lib/draftRoomConstants';
import { useNotifOptIn } from '@/app/providers';
import * as draftStore from '@/lib/draftStore';
import { getDraftTokenLevel } from '@/lib/api/leagues';
import { logger } from '@/lib/logger';
import { useDraftRoomUsers } from '@/hooks/useDraftRoomUsers';
import { useAutoPickSortPreference } from '@/hooks/useAutoPickSortPreference';

function DraftRoomContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // During filling phase, don't show a numbered name — drafts only get a batch number after starting.
  // The backend assigns the real name (e.g., "League #2024-fast-draft-30") after 10/10 fill.
  const urlName = searchParams?.get('name');
  const [contestName, _setContestName] = useState(urlName || 'Draft Room');
  const initialPlayers = parseInt(searchParams?.get('players') || '1', 10);
  const urlDraftId = searchParams?.get('draftId') || searchParams?.get('id') || '';
  const walletParam = searchParams?.get('wallet') || '';
  const modeParam = searchParams?.get('mode') as DraftMode | null;
  const speedParam = searchParams?.get('speed') as 'fast' | 'slow' | null;
  const passTypeParam = searchParams?.get('passType') as 'paid' | 'free' | null;
  const promoTypeParam = searchParams?.get('promoType') as 'jackpot' | 'hof' | 'pro' | null;
  const specialTypeParam = searchParams?.get('specialType') as 'jackpot' | 'hof' | null;
  // Spectator mode: same URL flow as a live participant, but no actions
  // fire (no pick submit, no leave, no queue mutations) and a SPECTATOR
  // badge replaces the user's identity-related UI. The page still
  // subscribes to live state (WS + REST polling) since it's mode=live.
  const spectateParam = searchParams?.get('spectate') === 'true';
  const isPaidDraft = passTypeParam !== 'free';

  const [draftId, _setDraftId] = useState(urlDraftId);
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  const isLiveMode = modeParam === 'live' && !!walletParam;

  // Wrap setDraftId to also update the URL so refresh rejoins the same draft.
  // Belt-and-suspenders:
  //  - window.history.replaceState updates the URL bar synchronously RIGHT
  //    NOW so the user sees the id immediately, no matter what.
  //  - router.replace then tells Next.js about the change so its internal
  //    history stack and useSearchParams() stay consistent (otherwise
  //    navigating away + back resurfaces the original id-less URL).
  // Either alone has been observed to flake; together they're reliable.
  const setDraftId = useCallback((id: string | ((prev: string) => string)) => {
    const resolved = typeof id === 'function' ? id(draftIdRef.current) : id;
    _setDraftId(resolved);
    draftIdRef.current = resolved;
    if (typeof window === 'undefined' || !resolved) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('id') === resolved) {
      console.log('[DraftRoom] setDraftId: id already in URL', resolved);
      return;
    }
    params.set('id', resolved);
    params.delete('passType');
    const newSearch = params.toString();
    const newUrl = `${pathname}?${newSearch}`;
    console.log('[DraftRoom] setDraftId → updating URL to', newUrl);
    try {
      window.history.replaceState(window.history.state, '', newUrl);
    } catch (err) {
      console.warn('[DraftRoom] history.replaceState failed:', err);
    }
    try {
      router.replace(newUrl, { scroll: false });
    } catch (err) {
      console.warn('[DraftRoom] router.replace failed:', err);
    }
    console.log('[DraftRoom] post-update window.location:', window.location.href);
  }, [router, pathname]);

  const { user, refreshBalance, isLoggedIn, setShowLoginModal } = useAuth();
  const { getAccessToken } = usePrivy();
  const {
    playSpinningSound,
    playReelStop,
    playCountdownTick,
    playWinSound,
    playYourTurnSound,
    playNewPickSound,
    cleanup: cleanupAudio,
  } = useDraftAudio();
  const { triggerOptIn } = useNotifOptIn();

  useEffect(() => {
    return () => cleanupAudio();
  }, [cleanupAudio]);

  const [fallbackLocal, setFallbackLocal] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const engine = useDraftEngine(isLiveMode && !fallbackLocal ? 'live' : 'local');
  const storedForInit = draftId ? draftStore.getDraft(draftId) : undefined;
  const [liveDataReady, setLiveDataReady] = useState(false);

  const _isResumingRandomize = !!(storedForInit?.randomizingStartedAt && !storedForInit?.preSpinStartedAt);
  const _resumeProgressDuration = 3000;
  const _resumeProgress = _isResumingRandomize
    ? (() => {
        const elapsed = Date.now() - storedForInit!.randomizingStartedAt!;
        const t = Math.min(1, elapsed / _resumeProgressDuration);
        return 0.99 * Math.pow(t, 0.6);
      })()
    : 0;

  const stored = draftId ? draftStore.getDraft(draftId) : undefined;

  // Provably-fair batch readiness gate. Derives the batch this draft falls
  // into from the draftId (e.g. "2025-fast-draft-347" → batch 4). The slot
  // machine reveal is gated on the batch's randomness being available so
  // it never spins to a wrong type. For pre-launch batches the hook
  // returns ready=true immediately, so existing UX is unchanged for old
  // batches. See docs/proof system overview in /how-it-works#fairness.
  const batchInfo = (() => {
    const candidates = [draftId, urlDraftId].filter(Boolean) as string[];
    for (const id of candidates) {
      const n = parseDraftNumber(id);
      if (n) return locateDraft(n);
    }
    return null;
  })();
  const batchProof = useBatchProofReady(batchInfo?.batchNumber ?? null);

  const [phase, setPhase] = useState<RoomPhase>(() => {
    if (isLiveMode && stored && (
      (stored.phase && stored.phase !== 'filling') ||
      stored.preSpinStartedAt ||
      (stored.randomizingStartedAt && (Date.now() - stored.randomizingStartedAt) > 3000)
    )) return 'loading';
    if (!isLiveMode && stored?.phase) return stored.phase;
    return 'filling';
  });
  const [playerCount, setPlayerCount] = useState(() => {
    if (stored?.phase && stored.phase !== 'filling') return 10;
    return Math.min(Math.max(stored?.players || initialPlayers || 1, 1), 10);
  });
  const [preSpinCountdown, setPreSpinCountdown] = useState(() => {
    if (stored?.preSpinStartedAt) return Math.max(0, Math.floor(15 - (Date.now() - stored.preSpinStartedAt) / 1000));
    return 15;
  });
  const [mainCountdown, setMainCountdown] = useState(() => {
    if (stored?.preSpinStartedAt) return Math.max(0, Math.floor(60 - (Date.now() - stored.preSpinStartedAt) / 1000));
    return 60;
  });
  const [draftType, setDraftType] = useState<DraftType | null>(() => {
    if (specialTypeParam) return specialTypeParam;
    if (stored?.draftType) return stored.draftType;
    return null;
  });

  const [allReelItems, setAllReelItems] = useState<DraftType[][]>([[], [], []]);
  const [reelOffsets, setReelOffsets] = useState([0, 0, 0]);
  const [showSlotMachine, setShowSlotMachine] = useState(false);
  const slotActiveRef = useRef(false);
  const [slotAnimationDone, setSlotAnimationDone] = useState(false);
  const showSlotIfNotDismissed = (dId?: string) => {
    const id = dId || draftIdRef.current;
    const state = id ? draftStore.getDraft(id) : undefined;
    if (state?.slotDismissed) return;
    setShowSlotMachine(true);
    slotActiveRef.current = true;
  };
  const [showFlash, setShowFlash] = useState(false);
  const [screenShake, setScreenShake] = useState(false);
  const [confetti, setConfetti] = useState<Array<{ id: number; x: number; color: string; delay: number }>>([]);
  const [jackpotRain, setJackpotRain] = useState<Array<{ id: number; x: number; delay: number; size: number }>>([]);
  const [particleBurst, setParticleBurst] = useState<Array<{ id: number; x: number; y: number; angle: number; color: string }>>([]);
  const [pulseGlow, setPulseGlow] = useState(false);

  const [draftOrder, setDraftOrder] = useState<typeof DRAFT_PLAYERS>(() => {
    if (stored?.draftOrder) return stored.draftOrder;
    if (isLiveMode && walletParam) {
      return [{
        id: '1',
        name: walletParam,
        displayName: 'You',
        isYou: true,
        avatar: '🍌',
      }];
    }
    return [];
  });
  const [userDraftPosition, setUserDraftPosition] = useState<number>(() => {
    if (stored?.userDraftPosition !== undefined) return stored.userDraftPosition;
    return 0;
  });

  // Resolve every player in the draftOrder to {username, pfp, equippedBadge}
  // via the Go API + Firestore. Lets the slot cards show real names + badges
  // instead of truncated wallet addresses. Bots are filtered out by the hook.
  const draftRoomUsers = useDraftRoomUsers(draftOrder.map(p => p.name));

  // Apply resolved usernames to draftOrder.displayName so the existing
  // text-label code paths show real names. Avatars + badges are passed
  // separately as `usersMap` to the child components.
  const enrichedDraftOrder = React.useMemo(() => {
    return draftOrder.map(p => {
      if (p.isYou) return p;
      const u = draftRoomUsers[p.name?.toLowerCase() ?? ''];
      if (u?.displayName) return { ...p, displayName: u.displayName };
      return p;
    });
  }, [draftOrder, draftRoomUsers]);

  const [autoDraft, setAutoDraft] = useState(false);
  const [autoDraftLoading, setAutoDraftLoading] = useState(false);
  const [_sortPreference, setSortPreference] = useState<'adp' | 'rank'>('adp');
  const { preference: defaultSortPreference, loaded: defaultSortPreferenceLoaded } = useAutoPickSortPreference();
  const [missedPicksCount, setMissedPicksCount] = useState(0);
  const [showAutoDraftNotification, _setShowAutoDraftNotification] = useState(false);
  const [generatedCardUrl, setGeneratedCardUrl] = useState<string | null>(null);
  const prevDrafterRef = useRef<string>('');

  const [activeTab, setActiveTab] = useState<DraftTab>('draft');
  const muteKey = `mute:${urlDraftId || ''}`;
  const [isMuted, setIsMuted] = useState(() => {
    if (typeof window === 'undefined' || !urlDraftId) return false;
    return localStorage.getItem(muteKey) === '1';
  });
  const bannerRef = useRef<HTMLDivElement>(null);

  const preSpinStartedAtRef = useRef<number | null>(stored?.preSpinStartedAt ?? null);
  const animationOffsetRef = useRef(0);

  const {
    liveError,
    setLiveError,
    retryLiveSync,
    engineReady,
    setEngineReady,
    firebaseActive,
    firebaseRtdb,
    ws,
    bestTimeRemaining,
    handleLiveDraft,
    handleLiveQueueSync,
  } = useDraftLiveSync({
    engine,
    isLiveMode,
    draftId,
    setDraftId,
    walletParam,
    speedParam,
    passTypeParam,
    promoTypeParam,
    phase,
    liveDataReady,
    setLiveDataReady,
    setFallbackLocal,
    setPhase,
    setMainCountdown,
    setShowSlotMachine,
    draftIdRef,
  });

  const loadingHandledRef = useRef(false);
  useEffect(() => {
    if (phase !== 'loading' || loadingHandledRef.current) return;
    if (!isLiveMode || !draftId) {
      setPhase('filling');
      return;
    }
    loadingHandledRef.current = true;

    let cancelled = false;

    if (specialTypeParam && draftId) {
      (async () => {
        try {
          const info = await draftApi.getDraftInfo(draftId);
          if (cancelled) return;
          if (info.draftOrder?.length >= 10) {
            const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
              id: String(idx + 1),
              name: u.ownerId,
              displayName: u.ownerId.toLowerCase() === walletParam.toLowerCase() ? 'You' : `${u.ownerId.slice(0, 6)}...${u.ownerId.slice(-4)}`,
              isYou: u.ownerId.toLowerCase() === walletParam.toLowerCase(),
              avatar: '🍌',
            }));
            setDraftOrder(realOrder);
            const userPos = realOrder.findIndex((p: { isYou: boolean }) => p.isYou);
            if (userPos >= 0) setUserDraftPosition(userPos);
            setPlayerCount(10);
            setDraftType(specialTypeParam);

            if (info.pickNumber > 1) {
              setPhase('drafting');
              setMainCountdown(0);
              setLiveDataReady(true);
              return;
            }

            const countdownStart = stored?.preSpinStartedAt || (info.draftStartTime ? info.draftStartTime * 1000 - 60000 : Date.now());
            preSpinStartedAtRef.current = countdownStart;
            setPhase('countdown');
            setMainCountdown(Math.max(0, Math.floor(60 - (Date.now() - countdownStart) / 1000)));
            setLiveDataReady(true);
            draftStore.updateDraft(draftId, { phase: 'countdown', preSpinStartedAt: countdownStart, draftOrder: realOrder, userDraftPosition: userPos, type: specialTypeParam, draftType: specialTypeParam });
            return;
          }
        } catch {}

        if (!cancelled) {
          setPlayerCount(1);
          setPhase('filling');
        }
      })();

      return () => { cancelled = true; };
    }

    async function checkServerState() {
      try {
        logger.debug('[Draft Room] Loading phase — checking server state for', draftId);
        const info = await draftApi.getDraftInfo(draftId);
        if (cancelled) return;

        const serverPlayerCount = info.draftOrder?.length || 0;
        const draftAlreadyStarted = specialTypeParam
          ? info.pickNumber > 1
          : (info.pickNumber > 1 || (info.draftStartTime && info.draftStartTime * 1000 < Date.now()));

        if (draftAlreadyStarted) {
          const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
            id: String(idx + 1),
            name: u.ownerId,
            displayName: u.ownerId.toLowerCase() === walletParam.toLowerCase() ? 'You' : `${u.ownerId.slice(0, 6)}...${u.ownerId.slice(-4)}`,
            isYou: u.ownerId.toLowerCase() === walletParam.toLowerCase(),
            avatar: '🍌',
          }));
          setDraftOrder(realOrder);
          const userPos = realOrder.findIndex((p: { isYou: boolean }) => p.isYou);
          if (userPos >= 0) setUserDraftPosition(userPos);

          setPlayerCount(10);
          setPhase('drafting');
          setMainCountdown(0);
          setShowSlotMachine(false);
          setLiveDataReady(true);

          if (specialTypeParam) setDraftType(specialTypeParam);
          else if (stored?.draftType) setDraftType(stored.draftType);

          draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10 });
        } else if (serverPlayerCount >= 10 && info.draftStartTime) {
          const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
            id: String(idx + 1),
            name: u.ownerId,
            displayName: u.ownerId.toLowerCase() === walletParam.toLowerCase() ? 'You' : `${u.ownerId.slice(0, 6)}...${u.ownerId.slice(-4)}`,
            isYou: u.ownerId.toLowerCase() === walletParam.toLowerCase(),
            avatar: '🍌',
          }));
          setDraftOrder(realOrder);
          const userPos = realOrder.findIndex((p: { isYou: boolean }) => p.isYou);
          if (userPos >= 0) setUserDraftPosition(userPos);

          setPlayerCount(10);
          const countdownStart = stored?.preSpinStartedAt || (info.draftStartTime * 1000 - 60000);
          preSpinStartedAtRef.current = countdownStart;
          const elapsed = (Date.now() - countdownStart) / 1000;

          if (elapsed >= 60) {
            setPhase('drafting');
            setMainCountdown(0);
            setLiveDataReady(true);
            if (specialTypeParam) setDraftType(specialTypeParam);
            else if (stored?.draftType) setDraftType(stored.draftType);
            draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10 });
          } else if (specialTypeParam) {
            setDraftType(specialTypeParam);
            setPhase('countdown');
            setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
            setLiveDataReady(true);
            draftStore.updateDraft(draftId, { phase: 'countdown', preSpinStartedAt: countdownStart, type: specialTypeParam, draftType: specialTypeParam });
          } else if (elapsed >= 15) {
            const selectedResult = (stored?.draftType || 'pro') as DraftType;
            const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
            setDraftType(selectedResult);
            const generatedReels = [
              generateReelItemsForReel(reelResults[0], 0),
              generateReelItemsForReel(reelResults[1], 1),
              generateReelItemsForReel(reelResults[2], 2),
            ];
            setAllReelItems(generatedReels);
            const animOffset = (elapsed - 15) * 1000;
            if (animOffset < 6000) {
              const itemHeight = 130;
              const landingIndex = (generatedReels[0]?.length || 50) - 8;
              const targetOffset = landingIndex * itemHeight;
              const reelDurations = [2000, 4000, 6000];
              const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
              const initOffsets: number[] = [0, 0, 0];
              for (let i = 0; i < 3; i++) {
                const p = Math.min(animOffset / reelDurations[i], 1);
                initOffsets[i] = easeOutQuint(p) * targetOffset;
              }
              setReelOffsets(initOffsets);
              animationOffsetRef.current = animOffset;
              showSlotIfNotDismissed();
              setSlotAnimationDone(false);
              setPhase('spinning');
            } else {
              const itemHeight = 130;
              const landingIndex = (generatedReels[0]?.length || 50) - 8;
              const finalOffset = landingIndex * itemHeight;
              setReelOffsets([finalOffset, finalOffset, finalOffset]);
              showSlotIfNotDismissed();
              setSlotAnimationDone(true);
              setPhase('result');
            }
            setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
            setLiveDataReady(true);
            draftStore.updateDraft(draftId, { phase: animOffset < 6000 ? 'spinning' : 'result', preSpinStartedAt: countdownStart });
          } else {
            setPhase('pre-spin');
            setPreSpinCountdown(Math.max(0, Math.floor(15 - elapsed)));
            setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
            setLiveDataReady(true);
            draftStore.updateDraft(draftId, { phase: 'pre-spin', preSpinStartedAt: countdownStart, draftOrder: realOrder, userDraftPosition: userPos });
          }
        } else if (serverPlayerCount >= 10) {
          setPlayerCount(10);
          if (stored?.preSpinStartedAt) {
            const countdownStart = stored.preSpinStartedAt;
            preSpinStartedAtRef.current = countdownStart;
            const elapsed = (Date.now() - countdownStart) / 1000;
            if (elapsed >= 15) {
              const selectedResult = (stored.draftType || draftType || 'pro') as DraftType;
              const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
              setDraftType(selectedResult);
              const generatedReels = [
                generateReelItemsForReel(reelResults[0], 0),
                generateReelItemsForReel(reelResults[1], 1),
                generateReelItemsForReel(reelResults[2], 2),
              ];
              setAllReelItems(generatedReels);
              const animOffset = (elapsed - 15) * 1000;
              if (animOffset < 6000) {
                const itemHeight = 130;
                const landingIndex = (generatedReels[0]?.length || 50) - 8;
                const targetOffset = landingIndex * itemHeight;
                const reelDurations = [2000, 4000, 6000];
                const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
                const initOffsets: number[] = [0, 0, 0];
                for (let i = 0; i < 3; i++) {
                  const p = Math.min(animOffset / reelDurations[i], 1);
                  initOffsets[i] = easeOutQuint(p) * targetOffset;
                }
                setReelOffsets(initOffsets);
                animationOffsetRef.current = animOffset;
                showSlotIfNotDismissed();
                setSlotAnimationDone(false);
                setPhase('spinning');
              } else {
                const itemHeight = 130;
                const landingIndex = (generatedReels[0]?.length || 50) - 8;
                const finalOffset = landingIndex * itemHeight;
                setReelOffsets([finalOffset, finalOffset, finalOffset]);
                showSlotIfNotDismissed();
                setSlotAnimationDone(true);
                setPhase('result');
              }
              setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
            } else {
              setPhase('pre-spin');
              setPreSpinCountdown(Math.max(0, Math.floor(15 - elapsed)));
              setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
            }
            setLiveDataReady(true);
          } else if (specialTypeParam && serverPlayerCount >= 10 && info.draftOrder?.length >= 10) {
            const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
              id: String(idx + 1),
              name: u.ownerId,
              displayName: u.ownerId.toLowerCase() === walletParam.toLowerCase() ? 'You' : `${u.ownerId.slice(0, 6)}...${u.ownerId.slice(-4)}`,
              isYou: u.ownerId.toLowerCase() === walletParam.toLowerCase(),
              avatar: '🍌',
            }));
            setDraftOrder(realOrder);
            const userPos = realOrder.findIndex((p: { isYou: boolean }) => p.isYou);
            if (userPos >= 0) setUserDraftPosition(userPos);
            setDraftType(specialTypeParam);
            const countdownStart = info.draftStartTime ? info.draftStartTime * 1000 - 60000 : Date.now();
            preSpinStartedAtRef.current = countdownStart;
            setPhase('countdown');
            setMainCountdown(Math.max(0, Math.floor(60 - (Date.now() - countdownStart) / 1000)));
            setLiveDataReady(true);
            draftStore.updateDraft(draftId, { phase: 'countdown', preSpinStartedAt: countdownStart, draftOrder: realOrder, userDraftPosition: userPos, type: specialTypeParam, draftType: specialTypeParam });
          } else {
            setPhase('filling');
          }
        } else {
          setPlayerCount(Math.max(serverPlayerCount, 1));
          setPhase('filling');
        }
      } catch (err) {
        console.warn('[Draft Room] Loading phase server check failed:', err);
        if (stored?.status === 'drafting') {
          setPhase('drafting');
          setLiveDataReady(true);
          if (stored.draftOrder) setDraftOrder(stored.draftOrder);
          if (stored.userDraftPosition !== undefined) setUserDraftPosition(stored.userDraftPosition);
          if (stored.draftType) setDraftType(stored.draftType);
        } else {
          setPhase('filling');
        }
      }
    }

    checkServerState();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isLiveMode, draftId]);

  const resumeHandledRef = useRef(false);
  useEffect(() => {
    if (isLiveMode || resumeHandledRef.current || !stored?.phase) return;
    resumeHandledRef.current = true;

    const restoredPhase = stored.phase;

    if (restoredPhase === 'pre-spin' && stored.preSpinStartedAt) {
      const elapsed = (Date.now() - stored.preSpinStartedAt) / 1000;
      if (elapsed >= 60) {
        setPhase('drafting');
        setMainCountdown(0);
        if (draftOrder.length > 0) engine.initializeDraft(draftOrder);
        if (draftId) draftStore.updateDraft(draftId, { status: 'drafting', phase: 'drafting', players: 10, isYourTurn: false });
        return;
      }
    }

    if (restoredPhase === 'spinning' || restoredPhase === 'result') {
      if (stored.preSpinStartedAt) {
        const elapsed = (Date.now() - stored.preSpinStartedAt) / 1000;
        if (elapsed >= 60) {
          setPhase('drafting');
          setMainCountdown(0);
          if (draftOrder.length > 0) engine.initializeDraft(draftOrder);
          if (draftId) draftStore.updateDraft(draftId, { status: 'drafting', phase: 'drafting', players: 10, isYourTurn: false });
          return;
        }
      }

      const selectedResult = (stored.draftType || draftType || 'pro') as DraftType;
      const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
      setDraftType(selectedResult);
      const generatedReels = [
        generateReelItemsForReel(reelResults[0], 0),
        generateReelItemsForReel(reelResults[1], 1),
        generateReelItemsForReel(reelResults[2], 2),
      ];
      setAllReelItems(generatedReels);
      const animOffset = stored.preSpinStartedAt ? Math.max(0, Date.now() - stored.preSpinStartedAt - 3000) : 0;
      if (animOffset < 6000) {
        const itemHeight = 130;
        const landingIndex = (generatedReels[0]?.length || 50) - 8;
        const targetOffset = landingIndex * itemHeight;
        const reelDurations = [2000, 4000, 6000];
        const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
        const initOffsets: number[] = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          const p = Math.min(animOffset / reelDurations[i], 1);
          initOffsets[i] = easeOutQuint(p) * targetOffset;
        }
        setReelOffsets(initOffsets);
        animationOffsetRef.current = animOffset;
        showSlotIfNotDismissed();
        setSlotAnimationDone(false);
        setPhase('spinning');
      } else {
        const itemHeight = 130;
        const landingIndex = (generatedReels[0]?.length || 50) - 8;
        const finalOffset = landingIndex * itemHeight;
        setReelOffsets([finalOffset, finalOffset, finalOffset]);
        showSlotIfNotDismissed();
        setSlotAnimationDone(true);
        setPhase('result');
      }
    }

    if (restoredPhase === 'drafting' && draftOrder.length > 0) {
      if (stored.enginePicks && stored.enginePicks.length > 0 && stored.enginePickNumber) {
        engine.restoreDraft(draftOrder, stored.enginePicks, stored.enginePickNumber, stored.engineQueue);
      } else {
        engine.initializeDraft(draftOrder);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!engine.airplaneMode || !engine.isUserTurn || phase !== 'drafting' || engine.draftStatus !== 'active') return;

    // Defer to the next tick so the airplaneMode state change has a chance
    // to settle in the engine, but no artificial visual buffer beyond that.
    // Was 500ms — felt like a "thinking" pause; users want it instant.
    const timeoutId = setTimeout(() => {
      const pickId = engine.getAutoPickPlayer();
      if (!pickId) return;
      logger.debug('[Airplane] Auto-picking immediately:', pickId);
      if (isLiveMode && draftId) {
        const payload = engine.draftPlayer(pickId);
        if (payload) {
          draftApi.submitPickREST(draftId, walletParam, {
            playerId: payload.playerId,
            displayName: payload.displayName,
            team: payload.team,
            position: payload.position,
          }).catch(e => console.error('[Airplane] Auto-pick REST failed:', e));
        }
      } else {
        engine.draftPlayer(pickId);
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.airplaneMode, engine.isUserTurn, phase, engine.draftStatus, engine.currentPickNumber]);

  useEffect(() => {
    if (!draftId) return;
    if (draftStore.getDraft(draftId)) return;
    draftStore.addDraft({
      id: draftId,
      contestName,
      status: 'filling',
      type: null,
      draftSpeed: speedParam || 'fast',
      players: initialPlayers,
      maxPlayers: 10,
      joinedAt: Date.now(),
      phase: 'filling',
      liveWalletAddress: walletParam,
      ...(specialTypeParam ? { specialType: specialTypeParam } : {}),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    if (!draftId || phase !== 'drafting') return;
    if (engine.draftStatus === 'completed') return;
    draftStore.updateDraft(draftId, {
      status: 'drafting',
      type: draftType,
      draftType,
      phase: 'drafting',
      players: 10,
      currentPick: engine.turnsUntilUserPick,
      totalPicks: engine.picks.length,
      isYourTurn: engine.isUserTurn,
      timeRemaining: engine.isUserTurn ? bestTimeRemaining : undefined,
      // Prefer Firebase RTDB's absolute pickEndTime when we have it — that's
      // the server-sourced end timestamp for the current pick, stable across
      // tab lifecycle. Fallback to now+bestTimeRemaining only when RTDB
      // hasn't delivered yet; skip the write entirely if neither source has
      // given us a real value, so we never stamp the store with the engine's
      // default pickLength right after mount. Previous behavior overwrote
      // the drafting-page row's countdown with a reset 8h value on every
      // fresh draft-room mount.
      pickEndTimestamp: (() => {
        if (!engine.isUserTurn) return undefined;
        const rtdb = firebaseRtdb.data?.pickEndTime;
        if (typeof rtdb === 'number' && rtdb > 0) return rtdb;
        const rtdbPickLength = firebaseRtdb.data?.pickLength;
        // If we have a server-sourced pickLength AND bestTimeRemaining is
        // strictly less than it, the engine has been updated past its
        // default — safe to derive an absolute timestamp from it.
        if (typeof rtdbPickLength === 'number' && rtdbPickLength > 0
            && bestTimeRemaining > 0 && bestTimeRemaining < rtdbPickLength) {
          return Math.ceil(Date.now() / 1000) + bestTimeRemaining;
        }
        // Otherwise we don't have confirmed server data — skip the write so
        // we don't stamp the store with the engine's fresh-mount default.
        return undefined;
      })(),
      enginePicks: engine.picks,
      enginePickNumber: engine.currentPickNumber,
      engineQueue: engine.queuedPlayers,
    });
  }, [draftId, phase, draftType, engine.currentPickNumber, engine.isUserTurn, bestTimeRemaining, firebaseRtdb.data?.pickEndTime, firebaseRtdb.data?.pickLength, engine.turnsUntilUserPick, engine.draftStatus, engine.picks.length, engine.picks, engine.queuedPlayers]);

  const getPersistId = () => draftId || urlDraftId;

  useEffect(() => {
    const id = getPersistId();
    if (!id) return;
    const existing = draftStore.getDraft(id);
    if (existing && localStorage.getItem(`airplane:${id}`) === '1') {
      engine.setAirplaneMode(true);
    } else {
      localStorage.removeItem(`airplane:${id}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    const id = getPersistId();
    if (!id) return;
    try {
      const raw = localStorage.getItem(`queue:${id}`);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length > 0 && engine.queuedPlayers.length === 0) {
          engine.reorderQueue(saved);
        }
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const handleToggleAirplane = useCallback(() => {
    engine.toggleAirplaneMode();
    const id = getPersistId();
    if (!id) return;
    const newValue = !engine.airplaneMode;
    localStorage.setItem(`airplane:${id}`, newValue ? '1' : '0');
    draftStore.updateDraft(id, { airplaneMode: newValue });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.airplaneMode, engine.toggleAirplaneMode, draftId, urlDraftId]);

  const handleToggleMute = useCallback(() => {
    const newValue = !isMuted;
    setIsMuted(newValue);
    const id = getPersistId();
    if (id) localStorage.setItem(`mute:${id}`, newValue ? '1' : '0');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted, draftId, urlDraftId]);

  useEffect(() => {
    const id = getPersistId();
    if (!id) return;
    if (engine.queuedPlayers.length > 0) {
      localStorage.setItem(`queue:${id}`, JSON.stringify(engine.queuedPlayers));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.queuedPlayers, draftId]);

  useEffect(() => {
    if (!engine.airplaneMode) return;
    const id = getPersistId();
    if (!id) return;
    localStorage.setItem(`airplane:${id}`, '1');
    draftStore.updateDraft(id, { airplaneMode: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.airplaneMode, draftId]);

  useEffect(() => {
    if (engine.draftStatus === 'completed' && draftId) {
      draftStore.removeDraft(draftId);
      localStorage.removeItem(`airplane:${draftId}`);
      localStorage.removeItem(`mute:${draftId}`);
      localStorage.removeItem(`queue:${draftId}`);
    }
  }, [engine.draftStatus, draftId]);

  useEffect(() => {
    if (engine.draftStatus === 'completed') {
      triggerOptIn('post-draft');
    }
  }, [engine.draftStatus, triggerOptIn]);

  useEffect(() => {
    if (!isLiveMode || !draftId || !walletParam || phase !== 'drafting') return;
    let cancelled = false;

    draftApi.getDraftPreferences(draftId, walletParam)
      .then((prefs) => {
        if (cancelled) return;
        setAutoDraft(prefs.autoDraft);
        const sortOrder = (prefs.sortBy || 'ADP').toUpperCase();
        let newSort = sortOrder === 'RANK' ? 'rank' as const : 'adp' as const;

        // First-time entry into this draft: if the per-draft sortBy is still
        // the system default 'ADP' AND the user's global default is 'rank',
        // apply 'rank' and push it to the Go API so it sticks. localStorage
        // marker stops the override from firing on subsequent reloads —
        // otherwise the in-draft ADP toggle would never persist.
        const appliedKey = `sortDefaultApplied:${draftId}`;
        const alreadyApplied = typeof window !== 'undefined' && localStorage.getItem(appliedKey) === '1';
        if (
          !alreadyApplied
          && defaultSortPreferenceLoaded
          && defaultSortPreference === 'rank'
          && newSort === 'adp'
        ) {
          newSort = 'rank';
          draftApi.updateSortPreference(walletParam, draftId, 'RANK').catch(() => {});
          try { localStorage.setItem(appliedKey, '1'); } catch {}
        } else if (!alreadyApplied && defaultSortPreferenceLoaded) {
          // User has no rank preference, or sortBy was already explicit.
          // Mark applied so we don't re-evaluate later.
          try { localStorage.setItem(appliedKey, '1'); } catch {}
        }

        setSortPreference(newSort);
        engine.setAutoPickSortPreference(newSort);
        setMissedPicksCount(prefs.numPicksMissedConsecutive || 0);

        // Sync local airplaneMode with server autoDraft preference
        if (prefs.autoDraft !== engine.airplaneMode) {
          engine.setAirplaneMode(prefs.autoDraft);
        }
      })
      .catch((e) => {
        console.warn('[Preferences] Failed to load draft preferences:', e);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, phase]);

  const handleToggleAutoDraft = useCallback(async () => {
    if (!isLiveMode || !draftId || !walletParam || autoDraftLoading) return;
    const newValue = !autoDraft;

    // Flip locally first so the airplane-mode useEffect can fire the pick
    // while we patch prefs server-side. Was awaiting the PATCH first which
    // added 500-1000ms of perceived latency between the click and the
    // pick landing.
    setAutoDraft(newValue);
    engine.setAirplaneMode(newValue);
    const id = getPersistId();
    if (id) localStorage.setItem(`airplane:${id}`, newValue ? '1' : '0');

    setAutoDraftLoading(true);
    try {
      const prefs = await draftApi.patchDraftPreferences(draftId, walletParam, newValue);
      // Reconcile with server in case it disagreed.
      if (prefs.autoDraft !== newValue) {
        setAutoDraft(prefs.autoDraft);
        engine.setAirplaneMode(prefs.autoDraft);
        if (id) localStorage.setItem(`airplane:${id}`, prefs.autoDraft ? '1' : '0');
      }
    } catch (e) {
      console.error('[AutoDraft] Toggle failed:', e);
      // Revert optimistic flip on failure.
      setAutoDraft(!newValue);
      engine.setAirplaneMode(!newValue);
      if (id) localStorage.setItem(`airplane:${id}`, !newValue ? '1' : '0');
    } finally {
      setAutoDraftLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, autoDraft, autoDraftLoading]);

  const handleSortChange = useCallback((sort: 'adp' | 'rank') => {
    setSortPreference(sort);
    engine.setAutoPickSortPreference(sort);
    if (isLiveMode && draftId && walletParam) {
      draftApi.updateSortPreference(walletParam, draftId, sort.toUpperCase())
        .catch(e => console.warn('[Sort] Failed to persist sort preference:', e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam]);

  useEffect(() => {
    if (!isLiveMode || isMuted || phase !== 'drafting' || engine.draftStatus !== 'active') return;
    const currentDrafter = engine.currentDrafterAddress;
    const prevDrafter = prevDrafterRef.current;
    prevDrafterRef.current = currentDrafter;

    if (!prevDrafter || !currentDrafter || prevDrafter === currentDrafter) return;
    if (currentDrafter.toLowerCase() === walletParam.toLowerCase()) playYourTurnSound();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.currentDrafterAddress, isMuted, phase, engine.draftStatus]);

  useEffect(() => {
    if (!isLiveMode || isMuted || phase !== 'drafting') return;
    if (!engine.mostRecentPick) return;
    // Only play sound for YOUR picks, not everyone else's
    if (engine.mostRecentPick.ownerName.toLowerCase() === walletParam.toLowerCase()) {
      playNewPickSound();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.mostRecentPick?.pickNumber]);

  const rankingsRefreshBucket = engine.mostRecentPick
    ? Math.floor(engine.mostRecentPick.pickNumber / 5)
    : 0;

  useEffect(() => {
    if (!isLiveMode || !draftId || !walletParam || phase !== 'drafting') return;
    if (!engine.mostRecentPick) return;
    if (engine.mostRecentPick.pickNumber % 5 !== 0) return;

    draftApi.getPlayerRankings(draftId, walletParam)
      .then((rankings) => {
        const available = rankings
          .filter((p: draftApi.PlayerDataResponse) => p.playerStateInfo.ownerAddress === '')
          .map((p: draftApi.PlayerDataResponse) => ({
            playerId: p.playerStateInfo.playerId,
            team: p.playerStateInfo.team,
            position: p.playerStateInfo.position,
            adp: p.stats.adp,
            rank: p.ranking.rank,
            byeWeek: p.stats.byeWeek,
            playersFromTeam: p.stats.playersFromTeam || [],
          }));
        engine.refreshAvailablePlayers(available);
      })
      .catch((err) => {
        console.warn('[Rankings] Failed to refresh player rankings:', err);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, phase, rankingsRefreshBucket]);

  useEffect(() => {
    if (!firebaseActive || !firebaseRtdb.data || !firebaseRtdb.data.isDraftClosed || generatedCardUrl) return;

    if (walletParam && draftId) {
      logger.debug('[DraftComplete] isDraftClosed=true, fetching generated card...');
      const fetchUrl = async () => {
        const { getDraftsApiUrl } = await import('@/lib/staging');
        const FALLBACK_URL = process.env.NEXT_PUBLIC_DRAFTS_API_URL || 'https://sbs-drafts-api-w5wydprnbq-uc.a.run.app';
        const baseUrl = getDraftsApiUrl() || FALLBACK_URL;
        try {
          const res = await fetch(`${baseUrl}/owner/${walletParam}/drafts/${draftId}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const imageUrl = data?.card?._imageUrl || data?.card?.imageUrl || data?.imageUrl;
          if (imageUrl) {
            setGeneratedCardUrl(imageUrl);
            logger.debug('[DraftComplete] Generated card URL:', imageUrl);
          }
        } catch (err) {
          console.error('[DraftComplete] Failed to fetch card:', err);
        }
      };
      fetchUrl();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseActive, firebaseRtdb.data?.isDraftClosed, draftId, walletParam, generatedCardUrl]);

  // Refresh draft pass count after joining a draft
  useEffect(() => {
    if (!draftId || !isLiveMode) return;
    // Delay so the Go API has time to process the join before we re-fetch pass count
    const timer = setTimeout(() => refreshBalance(), 3000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // Verify draft state on load — if stored as countdown/pre-spin but server says < 10, reset to filling
  useEffect(() => {
    if (!draftId || !isLiveMode || phase === 'filling' || phase === 'drafting') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/drafts/league-players?draftId=${encodeURIComponent(draftId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const count = Number(data.numPlayers) || 0;
        if (count > 0 && count < 10 && !cancelled) {
          // Server says not full — reset to filling
          setPlayerCount(count);
          setPhase('filling');
          draftStore.updateDraft(draftId, { phase: 'filling', players: count, preSpinStartedAt: undefined, randomizingStartedAt: undefined });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, isLiveMode]);

  // Poll server for real player count during filling
  useEffect(() => {
    if (!draftId || phase !== 'filling') return;
    let cancelled = false;

    const pollPlayers = async () => {
      try {
        const res = await fetch(`/api/drafts/league-players?draftId=${encodeURIComponent(draftId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const count = Number(data.numPlayers) || 0;
        if (count > 0 && !cancelled) setPlayerCount(count);
      } catch { /* ignore */ }
    };

    pollPlayers();
    const interval = setInterval(pollPlayers, 2500);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, phase]);

  useEffect(() => {
    if (!isLiveMode || !draftId) return;
    if (phase === 'drafting' || phase === 'loading') return;

    let cancelled = false;

    const poll = async () => {
      try {
        logger.debug('[Draft Room] Polling getDraftInfo for', draftId);
        const info = await draftApi.getDraftInfo(draftId);
        if (cancelled) return;

        if (info.draftOrder && info.draftOrder.length > 0) {
          if (phase !== 'filling') {
            const mappedOrder = info.draftOrder.map((entry: { ownerId: string }, idx: number) => {
              const isUser = entry.ownerId.toLowerCase() === walletParam.toLowerCase();
              return {
                id: String(idx + 1),
                name: entry.ownerId,
                displayName: isUser ? 'You' : `${entry.ownerId.slice(0, 6)}...${entry.ownerId.slice(-4)}`,
                isYou: isUser,
                avatar: '🍌',
              };
            });
            setDraftOrder(mappedOrder);
            const userPos = mappedOrder.findIndex((p: { isYou: boolean }) => p.isYou);
            if (userPos >= 0) setUserDraftPosition(userPos);
            setPlayerCount(prev => Math.max(prev, info.draftOrder.length));
          }
        }
      } catch (err) {
        console.warn('[Draft Room] Poll failed:', err);
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, phase, draftId, walletParam]);

  const [waitingForServer, setWaitingForServer] = useState(_isResumingRandomize);
  const [serverWaitProgress, setServerWaitProgress] = useState(_resumeProgress);
  const serverWaitProgressRef = useRef(_resumeProgress);
  const [serverPollResult, setServerPollResult] = useState<{ order: typeof DRAFT_PLAYERS; countdownStart: number } | null>(null);
  const serverPollStartedRef = useRef(false);

  useEffect(() => {
    if (phase !== 'filling' || playerCount < 10) return;
    if (isLiveMode && !draftId) return;

    const currentState = draftId ? draftStore.getDraft(draftId) : null;
    if (currentState?.preSpinStartedAt) return;

    if (!isLiveMode) {
      setServerPollResult({ order: [...DRAFT_PLAYERS].sort(() => Math.random() - 0.5), countdownStart: Date.now() });
      return;
    }

    if (serverPollStartedRef.current) return;
    serverPollStartedRef.current = true;
    setWaitingForServer(true);

    const existingTimestamp = draftId ? draftStore.getDraft(draftId)?.randomizingStartedAt : undefined;
    const randomizingStartedAt = existingTimestamp || Date.now();
    const progressDuration = 3000;
    const initialElapsed = Date.now() - randomizingStartedAt;
    const initialT = Math.min(1, initialElapsed / progressDuration);
    const initialProgress = 0.99 * (1 - Math.pow(1 - initialT, 3));
    setServerWaitProgress(initialProgress);
    serverWaitProgressRef.current = initialProgress;

    if (draftId) draftStore.updateDraft(draftId, { randomizingStartedAt, players: 10 });
    const pollDraftId = draftId;
    const MIN_RANDOMIZING_MS = 2000;
    const PROGRESS_DURATION_MS = 3000;
    const RETRY_DELAY_MS = 2000;
    const MAX_RETRIES = 10;
    let pollDone = false;

    const progressInterval = setInterval(() => {
      if (pollDone) { clearInterval(progressInterval); return; }
      const elapsed = Date.now() - randomizingStartedAt;
      const t = Math.min(1, elapsed / PROGRESS_DURATION_MS);
      const progress = 0.99 * (1 - Math.pow(1 - t, 3));
      serverWaitProgressRef.current = progress;
      setServerWaitProgress(progress);
    }, 50);

    (async () => {
      let attempts = 0;
      while (attempts < MAX_RETRIES) {
        attempts++;
        try {
          const info = await draftApi.getDraftInfo(pollDraftId);
          if (!info.draftOrder || info.draftOrder.length < 10) {
            throw new Error(`Draft order incomplete: ${info.draftOrder?.length || 0}/10`);
          }

          const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
            id: String(idx + 1),
            name: u.ownerId,
            displayName: u.ownerId.length > 10 ? `${u.ownerId.slice(0, 6)}...${u.ownerId.slice(-4)}` : u.ownerId,
            isYou: u.ownerId.toLowerCase() === walletParam.toLowerCase(),
            avatar: '🍌',
          }));

          pollDone = true;
          clearInterval(progressInterval);
          const elapsed = Date.now() - randomizingStartedAt;
          const remainingMs = Math.max(300, MIN_RANDOMIZING_MS - elapsed);
          const currentProgress = serverWaitProgressRef.current;

          await new Promise<void>(resolve => {
            const steps = Math.max(10, Math.floor(remainingMs / 50));
            const stepTime = remainingMs / steps;
            let step = 0;
            const finishInterval = setInterval(() => {
              step++;
              const t = step / steps;
              const smoothed = currentProgress + (1 - currentProgress) * (1 - Math.pow(1 - t, 2));
              serverWaitProgressRef.current = smoothed;
              setServerWaitProgress(smoothed);
              if (step >= steps) {
                clearInterval(finishInterval);
                setServerWaitProgress(1);
                resolve();
              }
            }, stepTime);
          });

          const serverCountdownStart = info.draftStartTime ? info.draftStartTime * 1000 - 60000 : Date.now();
          setServerPollResult({ order: realOrder, countdownStart: serverCountdownStart });
          return;
        } catch (err) {
          console.warn(`[Draft Room] Server not ready (attempt ${attempts}):`, err instanceof Error ? err.message : err);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }

      pollDone = true;
      clearInterval(progressInterval);
      setServerPollResult({ order: [...DRAFT_PLAYERS].sort(() => Math.random() - 0.5), countdownStart: Date.now() });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playerCount, draftId]);

  useEffect(() => {
    if (!serverPollResult) return;
    if (phase !== 'filling') {
      setServerPollResult(null);
      return;
    }

    const { order, countdownStart } = serverPollResult;
    setServerPollResult(null);

    const userPos = order.findIndex((p: { isYou: boolean }) => p.isYou);
    setDraftOrder(order);
    setUserDraftPosition(userPos);
    setWaitingForServer(false);

    preSpinStartedAtRef.current = countdownStart;
    if (isLiveMode) setLiveDataReady(true);

    if (specialTypeParam) {
      setDraftType(specialTypeParam);
      setPhase('countdown');
      setMainCountdown(Math.max(0, Math.floor(60 - (Date.now() - countdownStart) / 1000)));
      if (draftId) {
        draftStore.updateDraft(draftId, {
          phase: 'countdown',
          preSpinStartedAt: countdownStart,
          randomizingStartedAt: undefined,
          draftOrder: order,
          userDraftPosition: userPos,
          type: specialTypeParam,
          draftType: specialTypeParam,
        });
      }
    } else {
      setPhase('pre-spin');
      setPreSpinCountdown(15);
      setMainCountdown(Math.max(0, Math.floor(60 - (Date.now() - countdownStart) / 1000)));
      if (draftId) {
        draftStore.updateDraft(draftId, {
          phase: 'pre-spin',
          preSpinStartedAt: countdownStart,
          randomizingStartedAt: undefined,
          draftOrder: order,
          userDraftPosition: userPos,
          type: specialTypeParam || draftType,
          draftType: specialTypeParam || draftType,
        });
      }
    }

    const id = draftId || urlDraftId;
    const promoUserId = user?.id || walletParam?.toLowerCase();
    if (id && promoUserId && isPaidDraft) {
      const trackedKey = `promo-tracked:${id}`;
      if (!localStorage.getItem(trackedKey)) {
        localStorage.setItem(trackedKey, '1');
        fetch('/api/promos/draft-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: promoUserId, draftId: id }),
        }).then(r => r.json()).catch(err => {
          console.error('[Promo] Failed to track draft:', err);
        });
      }
      // Badge sweep runs server-side on every /api/badges read (called
      // by the badge notifier) so we don't need to fire it from here.
    }

    if (id && promoUserId && isPaidDraft && userPos === 9) {
      const pick10Key = `promo-pick10:${id}`;
      if (!localStorage.getItem(pick10Key)) {
        localStorage.setItem(pick10Key, '1');
        fetch('/api/promos/pick10', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: promoUserId, draftId: id, draftName: contestName }),
        }).then(r => r.json()).catch(err => {
          console.error('[Promo] Pick 10 tracking failed:', err);
        });
      }
    }

    if (id && walletParam && !specialTypeParam) {
      getDraftTokenLevel(walletParam, id).then(level => {
        if (!level) return;
        const typeMap: Record<string, DraftType> = { 'Jackpot': 'jackpot', 'Hall of Fame': 'hof', 'Pro': 'pro' };
        const mapped = typeMap[level] || 'pro';
        setDraftType(mapped);
        if (draftId) draftStore.updateDraft(draftId, { type: mapped, draftType: mapped });
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPollResult]);

  // Jackpot-hit promo POST. Fires whenever the resolved draftType is
  // 'jackpot' for a paid draft — independent of whether the user was on
  // the page during the slot-machine animation. Idempotent via
  // localStorage promo-jackpot:* + the server's draftId dedupe.
  useEffect(() => {
    if (!isLiveMode || draftType !== 'jackpot') return;
    const id = draftId || urlDraftId;
    if (!id || !isPaidDraft) return;
    const promoUserId = user?.id || walletParam?.toLowerCase();
    if (!promoUserId) return;
    const jackpotKey = `promo-jackpot:${id}`;
    if (localStorage.getItem(jackpotKey)) return;
    localStorage.setItem(jackpotKey, '1');
    fetch('/api/promos/jackpot-hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: promoUserId, draftId: id }),
    }).catch(err => console.error('[Promo] Jackpot tracking failed:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftType, draftId, urlDraftId, isLiveMode, isPaidDraft, walletParam, user?.id]);

  // Founder Draft promo POST. Fires once the draft is past filling.
  // Server validates that the draft actually qualifies (within window
  // + founder wallet present + caller in draftOrder) so we can fire
  // optimistically. Server-side dedupe in recordFounderDraftJoin is
  // the source of truth (founderHistory.draftName check).
  //
  // Client-side flag is set ONLY on definitive responses (2xx success
  // or 4xx rejection) — never on transient failures (5xx, network).
  // Previously the flag was set before the fetch, which meant a
  // transient hiccup permanently lost the credit because subsequent
  // renders short-circuited on the flag and never retried.
  useEffect(() => {
    // Fire as soon as the draft FILLS (10/10), not when active drafting
    // begins. The Founder Draft rule is: be in the draft when it fills.
    // If the user navigates away during the slot-machine reveal or
    // post-reveal countdown, they should still get credit.
    if (!isLiveMode || playerCount < 10) return;
    // Privy must be authenticated before we can mint a Bearer token.
    // Without it the route returns 401 and we'd waste an attempt — server
    // dedupe makes the wait-and-retry safe.
    if (!isLoggedIn) return;
    const id = draftId || urlDraftId;
    if (!id) return;
    const promoUserId = user?.id || walletParam?.toLowerCase();
    if (!promoUserId) return;
    // Bumped from `promo-founder:` → `promo-founder-v2:` so any flags set
    // by a prior buggy build (which marked-done on transient 401s) get
    // ignored and the credit gets one fresh shot.
    const founderKey = `promo-founder-v2:${id}`;
    if (localStorage.getItem(founderKey)) return;
    (async () => {
      const token = await getAccessToken();
      if (!token) return; // try again on next render once Privy hands one over
      try {
        const res = await fetch('/api/promos/founder-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ draftId: id }),
        });
        if (res.ok) {
          localStorage.setItem(founderKey, '1');
        } else if (res.status === 400) {
          // Server says draft is genuinely not a Founder Draft — mark done.
          localStorage.setItem(founderKey, '1');
        } else {
          // 401 (token rejected), 403 (caller not in draft yet — race with
          // Go's draftOrder population), 5xx, network — leave flag unset and
          // let the next render retry. Server-side dedupe is the source of
          // truth, so retrying is safe.
          logger.warn('[Promo] Founder POST non-OK (will retry)', { status: res.status });
        }
      } catch (err) {
        logger.error('[Promo] Founder tracking failed (will retry):', err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerCount, draftId, urlDraftId, isLiveMode, isLoggedIn, walletParam, user?.id]);

  useEffect(() => {
    if (phase !== 'pre-spin') return;
    const startedAt = preSpinStartedAtRef.current;
    if (!startedAt) return;

    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setPreSpinCountdown(Math.max(0, Math.floor(15 - elapsed)));
      setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'pre-spin' || preSpinCountdown > 0) return;

    const selectedResult: DraftType = draftType || 'pro';
    const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
    setDraftType(selectedResult);
    if (draftId) {
      draftStore.updateDraft(draftId, {
        phase: 'spinning',
        draftType: selectedResult,
        type: selectedResult,
        yourPosition: userDraftPosition >= 0 ? userDraftPosition + 1 : undefined,
      });
    }
    setAllReelItems([
      generateReelItemsForReel(reelResults[0], 0),
      generateReelItemsForReel(reelResults[1], 1),
      generateReelItemsForReel(reelResults[2], 2),
    ]);
    setShowSlotMachine(true);
    slotActiveRef.current = true;
    setSlotAnimationDone(false);
    setPhase('spinning');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, preSpinCountdown]);

  useEffect(() => {
    if (phase !== 'spinning' && phase !== 'result' && phase !== 'countdown') return;
    const startedAt = preSpinStartedAtRef.current;
    if (!startedAt) return;

    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const main = Math.max(0, Math.floor(60 - elapsed));
      setMainCountdown(prev => {
        if (main < prev && main <= 10 && main > 0) playCountdownTick();
        return main;
      });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, playCountdownTick]);

  useEffect(() => {
    if (phase !== 'pre-spin' && phase !== 'spinning' && phase !== 'result' && phase !== 'countdown') return;
    if (mainCountdown > 0) return;

    setShowSlotMachine(false);
    setScreenShake(false);
    setJackpotRain([]);
    setConfetti([]);
    setPulseGlow(false);
    setParticleBurst([]);

    if (isLiveMode) {
      if (engineReady) {
        setPhase('drafting');
        if (draftId) draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10, isYourTurn: false });
      } else {
        setFallbackLocal(true);
        setPhase('drafting');
        if (draftOrder.length > 0) engine.initializeDraft(draftOrder);
        setEngineReady(true);
        if (draftId) draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10, isYourTurn: false });
      }
    } else {
      setPhase('drafting');
      if (draftOrder.length > 0) engine.initializeDraft(draftOrder);
      setEngineReady(true);
      if (draftId) draftStore.updateDraft(draftId, { status: 'drafting', phase: 'drafting', players: 10, isYourTurn: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mainCountdown, draftOrder, isLiveMode, engineReady, fallbackLocal]);

  useEffect(() => {
    if (mainCountdown <= 15 && showSlotMachine && slotAnimationDone) {
      setShowSlotMachine(false);
      if (draftId) draftStore.updateDraft(draftId, { slotDismissed: true });
    }
  }, [mainCountdown, showSlotMachine, slotAnimationDone, draftId]);

  // Notify the global header's BatchProgressIndicator that a draft's
  // type just got revealed — gives the JP/HOF remaining counter an
  // instant refresh trigger instead of waiting for the 30s poll. The
  // listener on the other end is in useBatchProgress.ts.
  useEffect(() => {
    if (slotAnimationDone) {
      window.dispatchEvent(new CustomEvent('bbb:type-revealed'));
    }
  }, [slotAnimationDone]);

  useEffect(() => {
    if (mainCountdown <= 15 && screenShake) setScreenShake(false);
  }, [mainCountdown, screenShake]);

  useEffect(() => {
    if (!screenShake) { setJackpotRain([]); return; }
    const interval = setInterval(() => {
      setJackpotRain(Array.from({ length: 25 }, (_, i) => ({
        id: Date.now() + i,
        x: Math.random() * 100,
        delay: Math.random() * 2,
        size: 20 + Math.random() * 20,
      })));
    }, 3000);
    return () => clearInterval(interval);
  }, [screenShake]);

  useEffect(() => {
    if (phase !== 'result') return;
    if (draftType !== 'jackpot' && draftType !== 'hof') return;
    if (screenShake) return;

    setScreenShake(true);
    setPulseGlow(true);

    const colors = draftType === 'jackpot'
      ? ['#ef4444', '#f97316', '#fbbf24', '#ffffff', '#ff6b6b', '#ffd93d']
      : ['#FFD700', '#FFA500', '#ffffff', '#fbbf24', '#ffe066', '#ffb347'];

    setConfetti(Array.from({ length: 150 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 0.3,
    })));
    setTimeout(() => setConfetti([]), 6000);

    setJackpotRain(Array.from({ length: 35 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 2.5,
      size: 16 + Math.random() * 24,
    })));
  }, [phase, draftType, screenShake]);

  useEffect(() => {
    if (phase !== 'spinning' || allReelItems[0]?.length === 0) return;

    const itemHeight = 130;
    const landingIndex = (allReelItems[0]?.length || 50) - 8;
    const targetOffset = landingIndex * itemHeight;
    const reelDurations = [2000, 4000, 6000];
    const offset = animationOffsetRef.current;
    animationOffsetRef.current = 0;
    const startTime = performance.now() - offset;
    let animationId: number;
    const stoppedReels = [false, false, false];

    for (let i = 0; i < 3; i++) {
      if (offset >= reelDurations[i]) stoppedReels[i] = true;
    }

    const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const newOffsets = [0, 0, 0];
      let allStopped = true;

      for (let i = 0; i < 3; i++) {
        const progress = Math.min(elapsed / reelDurations[i], 1);
        newOffsets[i] = easeOutQuint(progress) * targetOffset;
        if (progress >= 1 && !stoppedReels[i]) { stoppedReels[i] = true; if (slotActiveRef.current) playReelStop(); }
        if (progress < 1) allStopped = false;
      }

      setReelOffsets(newOffsets);

      if (!allStopped) {
        animationId = requestAnimationFrame(animate);
      } else {
        setReelOffsets([targetOffset, targetOffset, targetOffset]);
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 150);

        if (draftType === 'jackpot' || draftType === 'hof') {
          setScreenShake(true);
          setPulseGlow(true);

          const colors = draftType === 'jackpot'
            ? ['#ef4444', '#f97316', '#fbbf24', '#ffffff', '#ff6b6b', '#ffd93d']
            : ['#FFD700', '#FFA500', '#ffffff', '#fbbf24', '#ffe066', '#ffb347'];

          setConfetti(Array.from({ length: 150 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            color: colors[Math.floor(Math.random() * colors.length)],
            delay: Math.random() * 0.3,
          })));
          setTimeout(() => {
            setConfetti(prev => [...prev, ...Array.from({ length: 100 }, (_, i) => ({
              id: 200 + i,
              x: Math.random() * 100,
              color: colors[Math.floor(Math.random() * colors.length)],
              delay: Math.random() * 0.3,
            }))]);
          }, 1000);
          setTimeout(() => setConfetti([]), 6000);

          setParticleBurst(Array.from({ length: 40 }, (_, i) => ({
            id: i,
            x: 50,
            y: 40,
            angle: (i / 40) * 360,
            color: colors[Math.floor(Math.random() * colors.length)],
          })));
          setTimeout(() => setParticleBurst([]), 1500);

          setJackpotRain(Array.from({ length: 35 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            delay: Math.random() * 2.5,
            size: 16 + Math.random() * 24,
          })));
        }

        setTimeout(() => {
          if (slotActiveRef.current) playWinSound(draftType === 'jackpot' || draftType === 'hof');
          setSlotAnimationDone(true);
          setPhase('result');
          const currentDraftId = draftIdRef.current;
          if (currentDraftId) draftStore.updateDraft(currentDraftId, { phase: 'result', type: draftType, draftType });
        }, 400);
      }
    };

    const isResuming = offset > 0;
    const startTimeout = setTimeout(() => {
      if (!isResuming && slotActiveRef.current) playSpinningSound();
      animationId = requestAnimationFrame(animate);
    }, isResuming ? 0 : 200);

    return () => {
      clearTimeout(startTimeout);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [phase, allReelItems, draftType, playReelStop, playWinSound, playSpinningSound]);

  useEffect(() => {
    if (phase !== 'drafting' || !bannerRef.current) return;
    const currentCard = bannerRef.current.querySelector(`[data-pick="${engine.currentPickNumber}"]`);
    if (currentCard) {
      currentCard.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    }
  }, [phase, engine.currentPickNumber]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m < 10 ? `0${m}` : m}:${s < 10 ? `0${s}` : s}`;
    return `${m < 10 ? `0${m}` : m}:${s < 10 ? `0${s}` : s}`;
  };

  const storedNow = draftId ? draftStore.getDraft(draftId) : null;
  const isRandomizingFromStore = !!(storedNow?.randomizingStartedAt && !storedNow?.preSpinStartedAt);
  const randomizingProgressFromStore = isRandomizingFromStore
    ? (() => {
        const elapsed = Date.now() - storedNow!.randomizingStartedAt!;
        const t = Math.min(1, elapsed / 3000);
        return 0.99 * Math.pow(t, 0.6);
      })()
    : 0;

  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!isRandomizingFromStore || waitingForServer) return;
    const ticker = setInterval(() => forceRender(v => v + 1), 50);
    return () => clearInterval(ticker);
  }, [isRandomizingFromStore, waitingForServer]);

  // Keep the JP/HOF badge hidden during pre-reveal phases. The
  // backend sets league.Level the moment the league fills (10th player
  // joins), which previously leaked the type into the UI during the
  // 'filling' and 'countdown' phases — defeating the slot-machine
  // reveal. Now we only show the type after the slot animation
  // completes, drafting has actually started, an explicit URL override
  // sets it, or the user has explicitly dismissed the slot machine.
  //
  // Earlier version checked `!showSlotMachine`, which was true BEFORE
  // the slot machine first mounts (set to true in the spinning
  // transition at line ~1214) — so during 'countdown' the JP/HOF logo
  // leaked through bannerControls. Switching to slotDismissed (set in
  // draftStore when the user closes the modal) fixes the leak.
  const slotDismissed = !!(draftId && draftStore.getDraft(draftId)?.slotDismissed);
  const visibleDraftType = specialTypeParam || slotAnimationDone || phase === 'drafting' || slotDismissed ? draftType : null;
  const [rosterViewPlayer, setRosterViewPlayer] = useState<string | undefined>(undefined);
  const handleViewRoster = (playerName: string) => {
    setRosterViewPlayer(playerName);
    setActiveTab('roster');
  };

  const bannerControls = (
    <div className="flex items-center justify-center gap-2 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
      {visibleDraftType === 'hof' && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hof-logo.jpg" alt="Hall of Fame" className="w-[50px] mr-2 h-auto" style={{ filter: 'sepia(100%) saturate(400%) brightness(110%) hue-rotate(10deg)' }} />
        </div>
      )}
      {visibleDraftType === 'jackpot' && (
        <div style={{ marginRight: '5px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/jackpot-logo.png" alt="Jackpot" className="w-[100px] mr-2 h-auto" />
        </div>
      )}
      {/* Founder pill — sits inline with the JP/HOF logo (when present) and
          the MUTE / airplane buttons. Adds a soft cyan glow so it reads as a
          premium tag alongside the larger JP/HOF artwork rather than a plain
          chip. Self-hides when the draft isn't a Founder Draft. */}
      {(draftId || urlDraftId) && (
        <div
          className="flex items-center"
          style={{ filter: 'drop-shadow(0 0 6px rgba(6,182,212,0.55))' }}
        >
          <FounderPill draftId={draftId || urlDraftId} size="md" />
        </div>
      )}
      <div>
        <button
          onClick={handleToggleMute}
          className="text-[12px] text-right cursor-pointer flex items-center justify-end border border-gray-500 px-1 font-primary"
        >
          {isMuted ? 'UNMUTE' : 'MUTE'} <span className="ml-1">🎵</span>
        </button>
      </div>
      {(() => {
        const isOn = (isLiveMode && phase === 'drafting') ? autoDraft : engine.airplaneMode;
        const handler = (isLiveMode && phase === 'drafting') ? handleToggleAutoDraft : handleToggleAirplane;
        return (
          <button
            onClick={handler}
            disabled={isLiveMode && phase === 'drafting' && autoDraftLoading}
            title={isOn ? 'Auto-draft ON — click to disable' : 'Auto-draft OFF — click to enable'}
            className={`cursor-pointer text-[12px] flex items-center justify-center border px-1 font-primary transition-all ${
              isOn ? 'border-emerald-500 text-emerald-400' : 'border-gray-500 text-white/60'
            } ${isLiveMode && phase === 'drafting' && autoDraftLoading ? 'opacity-50 cursor-wait' : ''}`}
          >
            ✈️ {isOn ? 'ON' : 'OFF'}
          </button>
        );
      })()}
    </div>
  );

  return (
    <div className={`min-h-screen text-white overflow-hidden flex flex-col transition-colors duration-1000 bg-black ${screenShake ? 'animate-shake' : ''}`}>
      {/* Login gate — dims draft and blocks interaction when logged out */}
      {!isLoggedIn && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center p-8 max-w-sm">
            <div className="text-5xl mb-4">🍌</div>
            <h2 className="text-xl font-bold text-white mb-2">Log in to Draft</h2>
            <p className="text-white/50 text-sm mb-6">You need to be logged in to join and participate in drafts.</p>
            <button
              onClick={() => setShowLoginModal(true)}
              className="px-8 py-3 bg-banana text-black font-bold rounded-xl hover:bg-yellow-300 transition-colors"
            >
              Log In
            </button>
          </div>
        </div>
      )}
      {showAutoDraftNotification && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl bg-emerald-900/95 border border-emerald-500/50 shadow-2xl backdrop-blur-sm animate-fade-in-down">
          <div className="flex items-center gap-3">
            <span className="text-emerald-400 font-bold text-sm">Auto-draft enabled</span>
            <span className="text-white/60 text-xs">You missed {missedPicksCount}+ picks in a row</span>
          </div>
        </div>
      )}

      {(phase === 'filling' || phase === 'countdown' || phase === 'loading' || engine.draftStatus === 'completed') && (
        <div className="h-14 bg-black/30 border-b border-white/10 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-bold">{contestName}</span>
            {visibleDraftType && (phase !== 'filling' || specialTypeParam) && (
              <>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  visibleDraftType === 'jackpot' ? 'bg-red-500/30 text-red-400' :
                  visibleDraftType === 'hof' ? 'bg-yellow-500/30 text-yellow-400' :
                  'bg-purple-500/30 text-purple-400'
                }`}>{visibleDraftType.toUpperCase()}</span>
                <VerifiedBadge type="draft-type" draftType={visibleDraftType} draftId={draftId || urlDraftId} />
              </>
            )}
            {phase === 'filling' && !specialTypeParam && (
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-white/10 text-white/50">UNREVEALED</span>
            )}
            {(draftId || urlDraftId) && (
              <FounderPill draftId={draftId || urlDraftId} size="md" />
            )}
          </div>
          <div className="flex items-center gap-4">
            {spectateParam && (
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-banana text-black">
                Spectator
              </span>
            )}
            {phase === 'filling' && isLiveMode && !spectateParam && (
              <button
                onClick={() => setShowLeaveConfirm(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-red-400 hover:bg-red-400/10 border border-white/10 hover:border-red-400/30 transition-all"
              >
                Leave
              </button>
            )}
            {phase === 'drafting' && engine.draftStatus === 'active' && (
              <>
                {engine.isUserTurn && (
                  <div className={`px-3 py-1 rounded-full text-sm font-bold ${
                    bestTimeRemaining <= 10 ? 'bg-red-500 animate-pulse' : 'bg-yellow-500 text-black'
                  }`}>
                    {formatTime(bestTimeRemaining)}
                  </div>
                )}
                <span className="text-white/50 text-sm">Pick {engine.currentPickNumber}/{TOTAL_PICKS}</span>
              </>
            )}
          </div>
        </div>
      )}

      {isLiveMode && liveError && !fallbackLocal && (
        <div className="fixed top-[200px] left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-4">
          <div className="bg-red-950/95 border border-red-500/50 rounded-xl p-4 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-red-400 font-bold text-sm">Draft connection error</p>
                <p className="text-white/50 text-xs mt-1 break-words">{liveError}</p>
              </div>
              <button onClick={() => setLiveError(null)} className="text-white/40 hover:text-white flex-shrink-0 text-lg leading-none">&times;</button>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={retryLiveSync}
                className="px-4 py-1.5 bg-banana text-black font-bold rounded-lg text-sm hover:bg-banana-light transition-all"
              >
                Retry
              </button>
              <button
                onClick={() => window.history.back()}
                className="px-4 py-1.5 bg-white/10 text-white font-bold rounded-lg text-sm hover:bg-white/20 transition-all"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}

      {isLiveMode && (phase === 'drafting' || phase === 'loading' || phase === 'filling') && (
        <div className="absolute top-16 right-4 z-20 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${firebaseRtdb.isListening || ws.isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
          <span className="text-xs text-white/40">{firebaseRtdb.isListening ? 'Live' : ws.isConnected ? 'WS' : 'Connecting...'}</span>
        </div>
      )}

      {phase === 'loading' ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-banana border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/60 text-sm">Reconnecting to draft...</p>
          </div>
        </div>
      ) : (
        <>
          {phase === 'filling' && (
            <DraftRoomFilling
              draftOrder={enrichedDraftOrder}
              playerCount={playerCount}
              waitingForServer={waitingForServer}
              isRandomizingFromStore={isRandomizingFromStore}
              serverWaitProgress={serverWaitProgress}
              randomizingProgressFromStore={randomizingProgressFromStore}
              user={user}
              visibleDraftType={visibleDraftType}
              controls={bannerControls}
              usersMap={draftRoomUsers}
            />
          )}

          {(phase === 'pre-spin' || phase === 'countdown' || phase === 'spinning' || phase === 'result') && (
            <>
              <DraftRoomReveal
                draftOrder={enrichedDraftOrder}
                usersMap={draftRoomUsers}
                phase={phase}
                user={user}
                visibleDraftType={visibleDraftType}
                mainCountdown={mainCountdown}
                preSpinCountdown={preSpinCountdown}
                formatTime={formatTime}
                controls={bannerControls}
                showFlash={showFlash}
                confetti={confetti}
                jackpotRain={jackpotRain}
                particleBurst={particleBurst}
                pulseGlow={pulseGlow}
                specialTypeParam={specialTypeParam}
                // Gate the slot machine on the batch's randomness being
                // available. Without this, on a fresh batch boundary the
                // slot would spin before Chainlink VRF returns and risk
                // landing on a wrong type. For pre-launch / already-ready
                // batches batchProof.ready=true so behavior is unchanged.
                showSlotMachine={showSlotMachine && batchProof.ready}
                allReelItems={allReelItems}
                reelOffsets={reelOffsets}
                draftType={draftType}
                slotAnimationDone={slotAnimationDone}
                draftId={draftId || urlDraftId}
                onCloseSlotMachine={() => {
                  setShowSlotMachine(false);
                  slotActiveRef.current = false;
                  cleanupAudio();
                  if (draftId) draftStore.updateDraft(draftId, { slotDismissed: true });
                }}
              />

              {/* Batch randomness loading overlay — shows when the slot
                  would otherwise spin but the batch's VRF hasn't yet
                  returned. Auto-dismisses once batchProof.ready flips true. */}
              {showSlotMachine && !batchProof.ready && batchInfo && (
                <BatchRandomnessLoading
                  batchNumber={batchInfo.batchNumber}
                  secondsElapsed={batchProof.secondsElapsed}
                  status={batchProof.status}
                  commitTxHash={batchProof.commitTxHashVrf || batchProof.vrfRequestTxHash}
                />
              )}
            </>
          )}

          <DraftRoomDrafting
            engine={engine}
            usersMap={draftRoomUsers}
            phase={phase}
            visibleDraftType={visibleDraftType}
            mainCountdown={mainCountdown}
            bestTimeRemaining={bestTimeRemaining}
            formatTime={formatTime}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            draftId={draftId}
            urlDraftId={urlDraftId}
            generatedCardUrl={generatedCardUrl}
            walletParam={walletParam}
            playerCount={playerCount}
            user={user}
            controls={bannerControls}
            bannerRef={bannerRef}
            onViewRoster={handleViewRoster}
            rosterViewPlayer={rosterViewPlayer}
            onDraftPlayer={(playerId) => {
              if (spectateParam) return;
              console.log('[DraftRoom] onDraftPlayer:', playerId, 'phase:', phase, 'engineStatus:', engine.draftStatus);
              if (phase !== 'drafting' && engine.draftStatus !== 'active') {
                console.log('[DraftRoom] BLOCKED — phase:', phase, 'engineStatus:', engine.draftStatus);
                return;
              }
              if (phase !== 'drafting') setPhase('drafting');
              handleLiveDraft(playerId);
            }}
            onQueueSync={(queue) => {
              if (spectateParam) return;
              if (isLiveMode && phase === 'drafting') handleLiveQueueSync(queue);
            }}
            onSortChange={handleSortChange}
            showBanner={phase === 'drafting'}
            spectator={spectateParam}
          />
        </>
      )}

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-5px, -3px); }
          20% { transform: translate(5px, 3px); }
          30% { transform: translate(-5px, 3px); }
          40% { transform: translate(5px, -3px); }
          50% { transform: translate(-3px, 5px); }
          60% { transform: translate(3px, -5px); }
          70% { transform: translate(-3px, -3px); }
          80% { transform: translate(3px, 3px); }
          90% { transform: translate(-2px, 2px); }
        }
        .animate-shake { animation: shake 0.15s ease-in-out infinite; }
        @keyframes flash { 0% { opacity: 0.5; } 100% { opacity: 0; } }
        .animate-flash { animation: flash 0.15s ease-out forwards; }
        @keyframes confetti {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .animate-confetti { animation: confetti 3s ease-out forwards; }
        @keyframes jackpot-rain {
          0% { transform: translateY(-50px) rotate(-5deg); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(100vh) rotate(5deg); opacity: 0; }
        }
        .animate-jackpot-rain { animation: jackpot-rain 4s ease-in forwards; }
        @keyframes burst {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--end-x)), calc(-50% + var(--end-y))) scale(0); opacity: 0; }
        }
        .animate-burst { animation: burst 1.2s ease-out forwards; }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        .animate-pulse-glow { animation: pulse-glow 1s ease-in-out infinite; }
        @keyframes fade-in-down {
          0% { transform: translate(-50%, -20px); opacity: 0; }
          100% { transform: translate(-50%, 0); opacity: 1; }
        }
        .animate-fade-in-down { animation: fade-in-down 0.3s ease-out forwards; }
        .banner-no-scrollbar::-webkit-scrollbar { display: none; }
        .banner-no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {showLeaveConfirm && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setShowLeaveConfirm(false)}
        >
          <div
            className="bg-[#1a1a1a] rounded-2xl border border-white/10 p-6 max-w-sm w-full cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-2">Leave Draft?</h3>
            <p className="text-white/60 mb-6">
              Are you sure you want to leave <span className="text-white font-medium">{contestName}</span>? Your draft pass will be returned.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 px-4 py-3 bg-transparent border border-white/50 text-white font-medium rounded-xl hover:bg-white/10 hover:scale-105 transition-all"
              >
                Cancel
              </button>
              <button
                disabled={leaving}
                onClick={async () => {
                  if (!draftId || !walletParam) return;
                  setLeaving(true);
                  try {
                    const storedDraft = draftStore.getDraft(draftId);
                    await leaveDraft(draftId, walletParam, storedDraft?.cardId);
                    // Await the refund-pass POST before navigating away.
                    // Was fire-and-forget, but window.location.href below
                    // can cancel in-flight requests in some browsers, so
                    // the Firestore counter wouldn't tick back. Best-
                    // effort still — failure swallowed (Go side already
                    // gave the card back; the next refreshBalance on the
                    // /drafting page will reconcile).
                    const userId = user?.id || walletParam;
                    const passType = passTypeParam || storedDraft?.passType || 'paid';
                    try {
                      await fetch('/api/owner/refund-pass', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId, passType, leagueId: draftId }),
                      });
                      await refreshBalance();
                    } catch (err) {
                      console.warn('[Leave] Refund pass failed:', err);
                    }
                    draftStore.removeDraft(draftId);
                    window.location.href = '/drafting';
                  } catch (err) {
                    console.error('Failed to leave draft:', err);
                    setLeaving(false);
                    setShowLeaveConfirm(false);
                  }
                }}
                className="flex-1 px-4 py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-400 transition-colors disabled:opacity-50"
              >
                {leaving ? 'Leaving...' : 'Leave Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DraftRoomPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <DraftRoomContent />
    </Suspense>
  );
}
