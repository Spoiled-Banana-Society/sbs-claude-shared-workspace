"use client"

import React, { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useDraftAudio } from '@/hooks/useDraftAudio';
import { useDraftEngine } from '@/hooks/useDraftEngine';
import type { DraftMode } from '@/hooks/useDraftEngine';
import { useDraftWebSocket } from '@/hooks/useDraftWebSocket';
import * as draftApi from '@/lib/draftApi';

import { DraftRoomChat } from '@/components/drafting/DraftRoomChat';
import { SlotMachineOverlay } from '@/components/drafting/SlotMachineOverlay';
import { DraftTabs } from '@/components/drafting/DraftTabs';
import type { DraftTab } from '@/components/drafting/DraftTabs';
import { DraftPlayerList } from '@/components/drafting/DraftPlayerList';
import { DraftQueue } from '@/components/drafting/DraftQueue';
import { DraftBoardGrid } from '@/components/drafting/DraftBoardGrid';
import { DraftRoster } from '@/components/drafting/DraftRoster';
import { DraftComplete } from '@/components/drafting/DraftComplete';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import {
  DRAFT_PLAYERS,
  TOTAL_PICKS,
  getPositionColorHex,
  POSITION_COLORS,
  generateReelItemsForReel,
} from '@/lib/draftRoomConstants';
import type { DraftType, RoomPhase } from '@/lib/draftRoomConstants';
import { useNotifOptIn } from '@/app/providers';
import * as draftStore from '@/lib/draftStore';
import { isStagingMode, getStagingApiUrl } from '@/lib/staging';

function DraftRoomContent() {
  const searchParams = useSearchParams();
  const contestName = searchParams.get('name') || 'Draft Room';
  const initialPlayers = parseInt(searchParams.get('players') || '1', 10);
  const urlDraftId = searchParams.get('draftId') || searchParams.get('id') || '';
  const walletParam = searchParams.get('wallet') || '';
  const modeParam = searchParams.get('mode') as DraftMode | null;
  const speedParam = searchParams.get('speed') as 'fast' | 'slow' | null;

  // draftId is stateful — starts empty when navigating before joinDraft completes
  const [draftId, setDraftId] = useState(urlDraftId);
  const isLiveMode = modeParam === 'live' && !!walletParam;

  const { user } = useAuth();
  const { playSpinningSound, playReelStop, playCountdownTick, playWinSound } = useDraftAudio();
  const { triggerOptIn } = useNotifOptIn();

  // Fallback: when server APIs can't provide player data, switch to local mode
  // so bots auto-play, local timer ticks, and ALL_POSITIONS provides 224 NFL players
  const [fallbackLocal, setFallbackLocal] = useState(false);

  // Draft engine — live mode uses 'live' for server state; fallbackLocal overrides to 'local'
  const engine = useDraftEngine(isLiveMode && !fallbackLocal ? 'live' : 'local');

  // ==================== LIVE MODE STATE ====================
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveInitializedRef = useRef(false);
  const storedForInit = draftId ? draftStore.getDraft(draftId) : undefined;
  // liveDataReady gates the loadLiveData effect — set true when loading phase resolves to drafting
  const [liveDataReady, setLiveDataReady] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const liveRetryCountRef = useRef(0);
  // Track whether we're waiting for server to create draft documents after filling
  // Initialize from stored state so re-entry renders correctly on first frame (no flash)
  const _isResumingRandomize = !!(storedForInit?.randomizingStartedAt && !storedForInit?.preSpinStartedAt);
  const _resumeProgress = _isResumingRandomize
    ? (() => { const e = Date.now() - storedForInit!.randomizingStartedAt!; const t = Math.min(1, e / 15000); return 0.99 * (1 - Math.pow(1 - t, 3)); })()
    : 0;
  const [waitingForServer, setWaitingForServer] = useState(_isResumingRandomize);
  const [serverWaitProgress, setServerWaitProgress] = useState(_resumeProgress);
  const serverWaitProgressRef = useRef(_resumeProgress);
  // State-driven approach: when poll succeeds, store result here; a separate effect transitions
  const [serverPollResult, setServerPollResult] = useState<{
    order: typeof DRAFT_PLAYERS;
    countdownStart: number;
  } | null>(null);
  const serverPollStartedRef = useRef(false);
  // Queue WS messages that arrive before engine initialization (instead of dropping them)
  // Messages are replayed after initializeFromServer completes — matches production behavior
  const pendingWsMessagesRef = useRef<Array<{type: string, payload: any}>>([]);

  // ==================== LIVE MODE: Join draft if no draftId yet ====================
  const joinCalledRef = useRef(false);
  useEffect(() => {
    if (!isLiveMode || draftId || !walletParam || joinCalledRef.current) return;
    joinCalledRef.current = true;

    // Write a preliminary entry to draftStore immediately so the drafting page
    // can show it while the joinDraft API call is in progress
    const pendingId = `pending-${Date.now()}`;
    const joinStartedAt = Date.now();
    draftStore.addDraft({
      id: pendingId,
      contestName: 'Joining...',
      status: 'filling',
      type: null,
      draftSpeed: speedParam || 'fast',
      players: 1,
      maxPlayers: 10,
      joinedAt: joinStartedAt,
      phase: 'filling',
      fillingStartedAt: joinStartedAt,
      fillingInitialPlayers: 1,
      liveWalletAddress: walletParam,
    });

    async function joinAndFill() {
      try {
        const { joinDraft } = await import('@/lib/api/leagues');
        const promoType = searchParams?.get('promoType') as 'jackpot' | 'hof' | 'pro' | null;
        const draftRoom = await joinDraft(walletParam, speedParam || 'fast', 1, promoType ?? undefined);
        if (!draftRoom?.id) throw new Error('Join failed: no draft ID');

        const newId = draftRoom.id;
        setDraftId(newId);

        // Remove the pending entry and add the real one
        draftStore.removeDraft(pendingId);
        draftStore.addDraft({
          id: newId,
          contestName: draftRoom.contestName || `BBB #${newId}`,
          status: 'filling',
          type: null,
          draftSpeed: speedParam || 'fast',
          players: draftRoom.players || 1,
          maxPlayers: 10,
          joinedAt: joinStartedAt,
          phase: 'filling',
          fillingStartedAt: joinStartedAt,  // Use the ORIGINAL timestamp, not Date.now()
          fillingInitialPlayers: draftRoom.players || 1,
          liveWalletAddress: walletParam,
        });

        // Fire off bot fill in background (staging only)
        if (isStagingMode()) {
          const stagingBase = getStagingApiUrl();
          if (stagingBase) {
            fetch(`${stagingBase}/staging/fill-bots/${speedParam || 'fast'}?count=9`, { method: 'POST' })
              .catch(() => console.warn('Bot fill failed'));
          }
        }
      } catch (err) {
        console.error('[Draft Room] Failed to join draft:', err);
        draftStore.removeDraft(pendingId); // Clean up pending entry on failure
        setLiveError(err instanceof Error ? err.message : 'Failed to join draft');
      }
    }

    joinAndFill();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, speedParam]);

  // ==================== RESTORE FROM STORE ====================
  // Check store in both modes — needed to skip animations when re-entering mid-draft
  const stored = draftId ? draftStore.getDraft(draftId) : undefined;

  // ==================== PHASE STATE ====================
  const [phase, setPhase] = useState<RoomPhase>(() => {
    // In live mode, if stored state shows draft is past filling, start in 'loading'
    // to check server state BEFORE showing any UI/animations. This prevents replaying
    // RANDOMIZING/slot machine on re-entry.
    if (isLiveMode && stored && stored.phase && stored.phase !== 'filling') return 'loading';
    if (!isLiveMode && stored?.phase) return stored.phase;
    return 'filling';
  });
  const [playerCount, setPlayerCount] = useState(() => {
    if (stored?.phase === 'filling' && stored.fillingStartedAt) {
      const initPlayers = stored.fillingInitialPlayers ?? Math.max(initialPlayers, 1);
      const elapsed = (Date.now() - stored.fillingStartedAt) / 800;
      return Math.min(10, initPlayers + Math.floor(elapsed));
    }
    if (stored?.phase && stored.phase !== 'filling') return 10;
    return Math.min(Math.max(initialPlayers, 1), 10);
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
    if (stored?.draftType) return stored.draftType;
    return 'pro'; // TESTING: force pro
  });

  // ==================== SLOT MACHINE STATE ====================
  const [allReelItems, setAllReelItems] = useState<DraftType[][]>([[], [], []]);
  const [reelOffsets, setReelOffsets] = useState([0, 0, 0]);
  const [showSlotMachine, setShowSlotMachine] = useState(false);
  const [slotAnimationDone, setSlotAnimationDone] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [screenShake, setScreenShake] = useState(false);
  const [confetti, setConfetti] = useState<Array<{ id: number; x: number; color: string; delay: number }>>([]);
  const [jackpotRain, setJackpotRain] = useState<Array<{ id: number; x: number; delay: number; size: number }>>([]);
  const [particleBurst, setParticleBurst] = useState<Array<{ id: number; x: number; y: number; angle: number; color: string }>>([]);
  const [pulseGlow, setPulseGlow] = useState(false);

  // ==================== DRAFT ORDER STATE (pre-engine) ====================
  const [draftOrder, setDraftOrder] = useState<typeof DRAFT_PLAYERS>(() => {
    if (stored?.draftOrder) return stored.draftOrder;
    // In live mode, pre-populate with user as first entry so box #1 shows "You"
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

  // ==================== DRAFTING UI STATE ====================
  const [activeTab, setActiveTab] = useState<DraftTab>('draft');
  const [isMuted, setIsMuted] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  // ==================== TIMESTAMP REFS ====================
  const fillingStartedAtRef = useRef<number | null>(stored?.fillingStartedAt ?? null);
  const preSpinStartedAtRef = useRef<number | null>(stored?.preSpinStartedAt ?? null);
  const animationOffsetRef = useRef(0); // ms offset for resuming slot animation mid-way
  const lastWsUpdateRef = useRef<number>(Date.now());

  // ==================== LOADING PHASE: Check server state before showing any UI ====================
  // When re-entering a live draft, we start in 'loading' phase to avoid replaying animations.
  // This effect fetches server state and jumps to the exact correct phase.
  const loadingHandledRef = useRef(false);
  useEffect(() => {
    if (phase !== 'loading' || !isLiveMode || !draftId || loadingHandledRef.current) return;
    loadingHandledRef.current = true;

    let cancelled = false;

    async function checkServerState() {
      try {
        console.log('[Draft Room] Loading phase — checking server state for', draftId);
        const info = await draftApi.getDraftInfo(draftId);
        if (cancelled) return;

        const playerCount = info.draftOrder?.length || 0;
        const draftAlreadyStarted = info.pickNumber > 1 ||
          (info.draftStartTime && info.draftStartTime * 1000 < Date.now());

        if (draftAlreadyStarted) {
          // Draft is actively picking — jump straight to drafting
          console.log(`[Draft Room] Server shows draft at pick ${info.pickNumber} — jumping to drafting`);

          // Build draft order from server data
          const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
            id: String(idx + 1),
            name: u.ownerId,
            displayName: u.ownerId.toLowerCase() === walletParam.toLowerCase()
              ? 'You'
              : u.ownerId.slice(0, 6) + '...' + u.ownerId.slice(-4),
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

          // Restore draft type from stored state
          if (stored?.draftType) setDraftType(stored.draftType);

          draftStore.updateDraft(draftId, {
            phase: 'drafting', status: 'drafting', players: 10,
          });
        } else if (playerCount >= 10 && info.draftStartTime) {
          // Draft is full but not started yet — in pre-spin/countdown phase
          console.log('[Draft Room] Server shows draft full, starting countdown');

          const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
            id: String(idx + 1),
            name: u.ownerId,
            displayName: u.ownerId.toLowerCase() === walletParam.toLowerCase()
              ? 'You'
              : u.ownerId.slice(0, 6) + '...' + u.ownerId.slice(-4),
            isYou: u.ownerId.toLowerCase() === walletParam.toLowerCase(),
            avatar: '🍌',
          }));
          setDraftOrder(realOrder);
          const userPos = realOrder.findIndex((p: { isYou: boolean }) => p.isYou);
          if (userPos >= 0) setUserDraftPosition(userPos);

          setPlayerCount(10);

          // Calculate remaining time
          const countdownStart = stored?.preSpinStartedAt || (info.draftStartTime * 1000 - 60000);
          preSpinStartedAtRef.current = countdownStart;
          const elapsed = (Date.now() - countdownStart) / 1000;

          if (elapsed >= 60) {
            // Countdown already expired — jump to drafting
            setPhase('drafting');
            setMainCountdown(0);
            setLiveDataReady(true);
            if (stored?.draftType) setDraftType(stored.draftType);
            draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10 });
          } else if (elapsed >= 15) {
            // Past slot machine start — play animation (or show result if animation done)
            const selectedResult = (stored?.draftType || 'pro') as DraftType;
            const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
            setDraftType(selectedResult);
            setAllReelItems([
              generateReelItemsForReel(reelResults[0], 0),
              generateReelItemsForReel(reelResults[1], 1),
              generateReelItemsForReel(reelResults[2], 2),
            ]);
            const animOffset = (elapsed - 15) * 1000; // ms into animation
            if (animOffset < 6000) {
              // Animation still in progress — resume from offset
              animationOffsetRef.current = animOffset;
              setShowSlotMachine(true);
              setSlotAnimationDone(false);
              setPhase('spinning');
            } else {
              // Animation done — show result with overlay visible
              setShowSlotMachine(true);
              setSlotAnimationDone(true);
              setPhase('result');
            }
            setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
            setLiveDataReady(true);
            draftStore.updateDraft(draftId, { phase: animOffset < 6000 ? 'spinning' : 'result', preSpinStartedAt: countdownStart });
          } else {
            // Still in pre-spin countdown — resume with remaining time
            setPhase('pre-spin');
            setPreSpinCountdown(Math.max(0, Math.floor(15 - elapsed)));
            setMainCountdown(Math.max(0, Math.floor(60 - elapsed)));
            setLiveDataReady(true);
            draftStore.updateDraft(draftId, { phase: 'pre-spin', preSpinStartedAt: countdownStart, draftOrder: realOrder, userDraftPosition: userPos });
          }
        } else if (playerCount >= 10) {
          // Draft is full but no draftStartTime yet — resume from stored state
          console.log('[Draft Room] Server shows 10/10 but no draftStartTime — resuming stored phase');
          setPlayerCount(10);
          if (stored?.preSpinStartedAt) {
            // Already in countdown — resume
            const countdownStart = stored.preSpinStartedAt;
            preSpinStartedAtRef.current = countdownStart;
            const elapsed = (Date.now() - countdownStart) / 1000;
            if (elapsed >= 15) {
              const selectedResult = (stored.draftType || 'pro') as DraftType;
              const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
              setDraftType(selectedResult);
              setAllReelItems([
                generateReelItemsForReel(reelResults[0], 0),
                generateReelItemsForReel(reelResults[1], 1),
                generateReelItemsForReel(reelResults[2], 2),
              ]);
              const animOffset = (elapsed - 15) * 1000;
              if (animOffset < 6000) {
                animationOffsetRef.current = animOffset;
                setShowSlotMachine(true);
                setSlotAnimationDone(false);
                setPhase('spinning');
              } else {
                setShowSlotMachine(true);
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
          } else {
            // Still randomizing or just reached 10/10 — let "at 10" effect handle it
            setPhase('filling');
          }
        } else {
          // Still filling — go back to filling phase (normal flow)
          console.log('[Draft Room] Server shows draft still filling — resuming fill');
          setPlayerCount(Math.max(playerCount, 1));
          setPhase('filling');
        }
      } catch (err) {
        console.warn('[Draft Room] Loading phase server check failed, falling back to stored state:', err);
        // Fall back to stored phase or filling
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

  // ==================== RESUME: Handle re-mount into mid-phase ====================
  const resumeHandledRef = useRef(false);
  useEffect(() => {
    if (isLiveMode || resumeHandledRef.current || !stored?.phase) return;
    resumeHandledRef.current = true;

    const restoredPhase = stored.phase;

    // If we resumed into pre-spin with countdown already expired, auto-advance
    if (restoredPhase === 'pre-spin' && stored.preSpinStartedAt) {
      const elapsed = (Date.now() - stored.preSpinStartedAt) / 1000;
      if (elapsed >= 60) {
        // Main countdown already expired — jump to drafting
        setPhase('drafting');
        setMainCountdown(0);
        if (draftOrder.length > 0) engine.initializeDraft(draftOrder);
        if (draftId) {
          draftStore.updateDraft(draftId, { status: 'drafting', phase: 'drafting', players: 10, isYourTurn: false });
        }
        return;
      }
    }

    // Resume spinning/result: play animation (or show result if animation done)
    if (restoredPhase === 'spinning' || restoredPhase === 'result') {
      if (stored.preSpinStartedAt) {
        const elapsed = (Date.now() - stored.preSpinStartedAt) / 1000;
        if (elapsed >= 60) {
          // Main countdown expired — jump to drafting
          setPhase('drafting');
          setMainCountdown(0);
          if (draftOrder.length > 0) engine.initializeDraft(draftOrder);
          if (draftId) {
            draftStore.updateDraft(draftId, { status: 'drafting', phase: 'drafting', players: 10, isYourTurn: false });
          }
          return;
        }
      }
      // Play the slot machine animation instead of skipping it
      const selectedResult = (stored.draftType || draftType || 'pro') as DraftType;
      const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
      setDraftType(selectedResult);
      setAllReelItems([
        generateReelItemsForReel(reelResults[0], 0),
        generateReelItemsForReel(reelResults[1], 1),
        generateReelItemsForReel(reelResults[2], 2),
      ]);
      const animOffset = stored.preSpinStartedAt
        ? Math.max(0, Date.now() - stored.preSpinStartedAt - 15000)
        : 0;
      if (animOffset < 6000) {
        animationOffsetRef.current = animOffset;
        setShowSlotMachine(true);
        setSlotAnimationDone(false);
        setPhase('spinning');
      } else {
        setShowSlotMachine(true);
        setSlotAnimationDone(true);
        setPhase('result');
      }
    }

    // Resume drafting: restore full engine state if we have saved picks
    if (restoredPhase === 'drafting') {
      if (draftOrder.length > 0) {
        if (stored.enginePicks && stored.enginePicks.length > 0 && stored.enginePickNumber) {
          engine.restoreDraft(draftOrder, stored.enginePicks, stored.enginePickNumber, stored.engineQueue);
        } else {
          engine.initializeDraft(draftOrder);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==================== LIVE MODE: WebSocket + pick handler ====================
  const handleLiveDraft = useCallback((playerId: string) => {
    if (!isLiveMode) {
      engine.draftPlayer(playerId);
      return;
    }
    // In live mode, build payload and send via WebSocket
    const pickPayload = engine.draftPlayer(playerId);
    if (pickPayload) {
      ws.sendPick(pickPayload);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, engine.draftPlayer]);

  const handleLiveQueueSync = useCallback((queue: typeof engine.queuedPlayers) => {
    if (!isLiveMode || !draftId || !walletParam) return;
    const payload = queue.map(p => ({
      playerId: p.playerId,
      displayName: p.playerId,
      team: p.team,
      position: p.position,
      ownerAddress: walletParam,
      pickNum: 0,
      round: 0,
    }));
    draftApi.updateQueue(walletParam, draftId, payload).catch(err => {
      console.error('[Queue] REST sync failed:', err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam]);

  // WebSocket connection (only in live mode)
  const ws = useDraftWebSocket({
    walletAddress: walletParam,
    draftName: draftId,
    enabled: isLiveMode,  // Connect immediately — don't wait for REST fetch
    onCountdownUpdate: (payload) => {
      engine.handleCountdownUpdate(payload);
    },
    onTimerUpdate: (payload) => {
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'timer_update', payload });
        return;
      }
      // Match production: let all timer_update through, no blocking.
      // The display logic uses mainCountdown (from draftStartTime) during
      // pre-spin/spinning/result phases regardless of engine.draftPhase.
      engine.handleTimerUpdate(payload);
      lastWsUpdateRef.current = Date.now();
    },
    onNewPick: (payload) => {
      console.log('[WS] new_pick received:', payload?.playerId, 'pick#', payload?.pickNum, 'initialized:', liveInitializedRef.current);
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'new_pick', payload });
        console.log('[WS] Queued new_pick (engine not ready). Queue size:', pendingWsMessagesRef.current.length);
        return;
      }
      engine.handleNewPick(payload);
      lastWsUpdateRef.current = Date.now();
    },
    onDraftInfoUpdate: (payload) => {
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'draft_info_update', payload });
        return;
      }
      // Cast: handler only uses pickNumber + currentDrafter, adp shape differs between WS and engine types
      engine.handleDraftInfoUpdate(payload as unknown as Parameters<typeof engine.handleDraftInfoUpdate>[0]);
      lastWsUpdateRef.current = Date.now();
      // Also update draftOrder from WS payload so boxes show wallet addresses
      if (payload.draftOrder && payload.draftOrder.length > 0) {
        const mapped = payload.draftOrder.map((entry: { ownerId: string }, idx: number) => {
          const isUser = entry.ownerId.toLowerCase() === walletParam.toLowerCase();
          return {
            id: String(idx + 1),
            name: entry.ownerId,
            displayName: isUser ? 'You' : entry.ownerId.slice(0, 6) + '...' + entry.ownerId.slice(-4),
            isYou: isUser,
            avatar: '🍌',
          };
        });
        setDraftOrder(mapped);
      }
    },
    onDraftComplete: () => {
      engine.handleDraftComplete();
    },
    onFinalCard: (payload) => {
      engine.handleFinalCard(payload);
    },
    onInvalidPick: (payload) => {
      // Surface server pick rejections — matches production useDraftRoom.ts logging
      console.warn('[WS] Invalid pick rejected by server:', payload);
    },
    onNewQueue: (payload) => {
      // Server sent updated queue — sync local state
      const available = engine.availablePlayers;
      const queuePlayers = payload
        .map(q => available.find(a => a.playerId === q.playerId))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);
      engine.reorderQueue(queuePlayers);
    },
    onOpen: () => {
      console.log('[WS] Connected to draft server');
      lastWsUpdateRef.current = Date.now();
      // Minimal reconnect sync (matches production): only fetch summary to catch
      // picks missed during disconnect. WS messages handle ongoing state sync.
      if (liveInitializedRef.current && draftId) {
        draftApi.getDraftSummary(draftId).then(summary => {
          const summaryArr = Array.isArray(summary) ? summary : (summary as any).summary || [];
          if (summaryArr.length > 0) {
            engine.refreshSummaryPicks(summaryArr);
            console.log(`[WS Reconnect] Synced ${summaryArr.filter((s: any) => s.playerInfo?.playerId).length} picks from summary`);
          }
        }).catch(() => {});
      }
    },
    onClose: () => {
      console.log('[WS] Disconnected from draft server');
    },
  });

  // ==================== LIVE MODE: Load initial state from REST API ====================
  // Gated by liveDataReady — runs when entering pre-spin (60s before draft starts)
  useEffect(() => {
    if (!isLiveMode || liveInitializedRef.current || !liveDataReady || !draftId) return;

    // Retry helper
    async function retryAsync<T,>(fn: () => Promise<T>, maxRetries = 3, delayMs = 2000): Promise<T> {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`[loadLiveData] Attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }
      throw lastError!;
    }

    async function loadLiveData() {
      try {
        setLiveLoading(true);
        setLiveError(null);
        console.log('[Draft Room] Loading draft data for', draftId);

        // Match production pattern: Promise.allSettled tolerates partial failures.
        // DraftInfo and playerRankings are required — if either fails, throw to retry.
        // Rosters, queue, and summary gracefully degrade to empty.
        const [rankingsResult, infoResult, rostersResult, queueResult, summaryResult] =
          await Promise.allSettled([
            retryAsync(() => draftApi.getPlayerRankings(draftId, walletParam)),
            retryAsync(() => draftApi.getDraftInfo(draftId)),
            draftApi.getDraftRosters(draftId),
            draftApi.getQueue(walletParam, draftId),
            draftApi.getDraftSummary(draftId),
          ]);

        const playerRankings = rankingsResult.status === 'fulfilled' ? rankingsResult.value : [];
        const draftInfo = infoResult.status === 'fulfilled' ? infoResult.value : null;
        const serverRosters = rostersResult.status === 'fulfilled'
          ? rostersResult.value
          : ({} as Record<string, { QB: unknown[]; RB: unknown[]; WR: unknown[]; TE: unknown[]; DST: unknown[] }>);
        const queue = queueResult.status === 'fulfilled' ? queueResult.value : ([] as draftApi.PlayerStateInfo[]);
        const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : ([] as draftApi.DraftSummaryItem[]);

        // Both required — if either failed or empty, throw to retry
        if (!draftInfo || (playerRankings as draftApi.PlayerDataResponse[]).length === 0) {
          throw new Error('Required draft data not available yet');
        }

        // Server has real player data — initialize engine in live mode
        const serverDraftInfo = {
          draftId: draftInfo.draftId,
          displayName: draftInfo.displayName,
          draftStartTime: draftInfo.draftStartTime,
          pickLength: draftInfo.pickLength,
          currentDrafter: draftInfo.currentDrafter,
          pickNumber: draftInfo.pickNumber,
          roundNum: draftInfo.roundNum,
          pickInRound: draftInfo.pickInRound,
          draftOrder: draftInfo.draftOrder,
          adp: draftInfo.adp.map(a => ({
            adp: a.adp,
            byeWeek: String(a.bye ?? a.byeWeek ?? ''),
            playerId: a.playerId,
          })),
        };

        // Convert queue to ServerPickPayload format
        const queuePayload = (queue as draftApi.PlayerStateInfo[]).map(q => ({
          playerId: q.playerId,
          displayName: q.displayName,
          team: q.team,
          position: q.position,
          ownerAddress: q.ownerAddress,
          pickNum: q.pickNum,
          round: q.round,
        }));

        // Convert rosters
        const rostersForEngine: Record<string, { QB: unknown[]; RB: unknown[]; WR: unknown[]; TE: unknown[]; DST: unknown[] }> = {};
        for (const [addr, roster] of Object.entries(serverRosters)) {
          rostersForEngine[addr] = roster;
        }

        // Preserve any queue the user built during filling/pre-spin
        const localQueue = engine.queuedPlayers;

        engine.initializeFromServer(
          serverDraftInfo,
          playerRankings,
          summary,
          rostersForEngine,
          queuePayload,
          walletParam,
        );

        // Restore local queue if server had nothing (user queued during filling)
        if (queuePayload.length === 0 && localQueue.length > 0) {
          engine.reorderQueue(localQueue);
        }

        liveInitializedRef.current = true;
        setEngineReady(true);
        console.log('[Draft Room] Engine ready — draft data loaded successfully');

        // Replay any WS messages that arrived during REST loading.
        // The lastPickRef dedup in handleNewPick rejects picks already covered by REST data.
        if (pendingWsMessagesRef.current.length > 0) {
          console.log(`[Draft Room] Replaying ${pendingWsMessagesRef.current.length} queued WS messages`);
          for (const msg of pendingWsMessagesRef.current) {
            switch (msg.type) {
              case 'new_pick': engine.handleNewPick(msg.payload); break;
              case 'timer_update': {
                // Match production: let timer_update through. Display logic uses
                // mainCountdown during pre-draft phases regardless of engine state.
                engine.handleTimerUpdate(msg.payload);
                break;
              }
              case 'draft_info_update':
                engine.handleDraftInfoUpdate(msg.payload as unknown as Parameters<typeof engine.handleDraftInfoUpdate>[0]);
                break;
            }
          }
          pendingWsMessagesRef.current = [];
        }
        lastWsUpdateRef.current = Date.now();

        setLiveLoading(false);

        // If draft is already in progress (picks happening or start time passed),
        // skip the slot machine countdown and jump straight to drafting
        const draftAlreadyStarted = draftInfo.pickNumber > 1 ||
          (draftInfo.draftStartTime && draftInfo.draftStartTime * 1000 < Date.now());
        if (draftAlreadyStarted) {
          console.log(`[Draft Room] Draft already at pick ${draftInfo.pickNumber} — skipping countdown, jumping to drafting`);
          setPhase('drafting');
          setMainCountdown(0);
          setShowSlotMachine(false);
          if (draftId) {
            draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10, isYourTurn: false });
          }
        }
      } catch (err) {
        const MAX_OUTER_RETRIES = 8;
        liveRetryCountRef.current += 1;
        console.error(`[Live Mode] loadLiveData attempt ${liveRetryCountRef.current}/${MAX_OUTER_RETRIES} failed:`, err);
        setLiveLoading(false);

        if (liveRetryCountRef.current >= MAX_OUTER_RETRIES) {
          // Exhausted all retries — fall back to local mode (bots + ALL_POSITIONS)
          // instead of showing an error overlay that blocks the draft
          console.log('[Draft Room] All retries exhausted — falling back to local mode');
          setFallbackLocal(true);
          liveInitializedRef.current = true;
        } else {
          // Auto-retry: toggle liveDataReady after delay to re-trigger the effect
          console.log(`[Live Mode] Auto-retrying in 5s...`);
          setTimeout(() => {
            liveInitializedRef.current = false;
            setLiveDataReady(false);
            setTimeout(() => setLiveDataReady(true), 100);
          }, 5000);
        }
      }
    }

    loadLiveData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, liveDataReady]);

  // ==================== SYNC DRAFT STATE TO STORE ====================
  // Ensure draft exists in the store on mount (defensive — covers edge cases
  // where addDraft was missed before navigation, e.g. local fallback)
  useEffect(() => {
    if (!draftId) return;
    if (draftStore.getDraft(draftId)) return; // already exists
    const speedParam = searchParams.get('speed') as 'fast' | 'slow' | null;
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
      fillingStartedAt: Date.now(),
      fillingInitialPlayers: Math.max(initialPlayers, 1),
      liveWalletAddress: walletParam,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // Syncs pick progress, turn status, and engine state to localStorage
  useEffect(() => {
    if (!draftId || phase !== 'drafting') return;
    if (engine.draftStatus === 'completed') return;
    draftStore.updateDraft(draftId, {
      status: 'drafting',
      type: draftType,
      draftType: draftType,
      phase: 'drafting',
      players: 10,
      currentPick: engine.turnsUntilUserPick,
      totalPicks: engine.picks.length,
      isYourTurn: engine.isUserTurn,
      timeRemaining: engine.isUserTurn ? engine.timeRemaining : undefined,
      pickEndTimestamp: engine.isUserTurn ? Math.ceil(Date.now() / 1000) + (engine.timeRemaining || 0) : undefined,
      // Save engine state so draft can resume after leaving
      enginePicks: engine.picks,
      enginePickNumber: engine.currentPickNumber,
      engineQueue: engine.queuedPlayers,
    });
  }, [draftId, phase, draftType, engine.currentPickNumber, engine.isUserTurn, engine.timeRemaining, engine.turnsUntilUserPick, engine.draftStatus, engine.picks.length, engine.picks, engine.queuedPlayers]);

  // Write 6: Draft completes — remove from active drafts
  useEffect(() => {
    if (engine.draftStatus === 'completed' && draftId) {
      draftStore.removeDraft(draftId);
    }
  }, [engine.draftStatus, draftId]);

  // Trigger notification opt-in when draft completes
  useEffect(() => {
    if (engine.draftStatus === 'completed') {
      triggerOptIn('post-draft');
    }
  }, [engine.draftStatus, triggerOptIn]);

  // ==================== FILLING PHASE ====================
  // Client-side visual animation for filling phase (all modes).
  // In live mode, server polling also updates draftOrder + playerCount via Math.max.
  useEffect(() => {
    if (phase !== 'filling') return;

    // Record filling start timestamp (only if not already set by addDraft)
    if (!fillingStartedAtRef.current) {
      fillingStartedAtRef.current = Date.now();
      if (!isLiveMode && draftId) {
        draftStore.updateDraft(draftId, { phase: 'filling', fillingStartedAt: fillingStartedAtRef.current, fillingInitialPlayers: Math.max(initialPlayers, 1) });
      }
    }

    // If already at 10, skip directly
    if (playerCount >= 10) return;

    const fillingInterval = 800;
    const startedAt = fillingStartedAtRef.current;
    const initPlayers = stored?.fillingInitialPlayers ?? Math.max(initialPlayers, 1);
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / fillingInterval;
      const count = Math.min(10, initPlayers + Math.floor(elapsed));
      setPlayerCount(prev => {
        if (prev >= 10) { clearInterval(interval); return 10; }
        if (count <= prev) return prev;
        // Only sync to draftStore in local mode (server is source of truth in live mode)
        if (!isLiveMode && draftId) {
          draftStore.updateDraft(draftId, { players: count, status: 'filling' });
        }
        return count;
      });
    }, fillingInterval);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ==================== LIVE MODE: Poll server for draft order + player count ====================
  // Runs during filling AND pre-spin/spinning/result — server may create state/info
  // document after bots join, so we keep polling to pick up wallet addresses.
  useEffect(() => {
    if (!isLiveMode || !draftId) return;
    if (phase === 'drafting' || phase === 'loading') return; // Stop polling during loading (loading effect handles it) and drafting (engine handles state)

    let cancelled = false;

    const poll = async () => {
      try {
        console.log('[Draft Room] Polling getDraftInfo for', draftId);
        const info = await draftApi.getDraftInfo(draftId);
        if (cancelled) return;

        console.log('[Draft Room] Poll result:', info.draftOrder?.length ?? 0, 'players');

        if (info.draftOrder && info.draftOrder.length > 0) {
          // During filling phase, only update playerCount here — the "at 10" effect
          // handles draftOrder, wallets, progress bar, and phase transition.
          // This prevents a race where setting draftOrder here causes the "at 10" effect
          // to succeed instantly, skipping the progress bar.
          if (phase === 'filling') {
            setPlayerCount(prev => Math.max(prev, info.draftOrder.length));
            if (info.draftOrder.length >= 10) {
              console.log('[Draft Room] Poll detected 10/10 — handing off to randomizing phase');
              return; // Stop polling, let "at 10" effect take over
            }
          } else {
            // After filling (pre-spin/spinning/result), update draftOrder normally
            const mappedOrder = info.draftOrder.map((entry: { ownerId: string }, idx: number) => {
              const isUser = entry.ownerId.toLowerCase() === walletParam.toLowerCase();
              return {
                id: String(idx + 1),
                name: entry.ownerId,
                displayName: isUser ? 'You' : entry.ownerId.slice(0, 6) + '...' + entry.ownerId.slice(-4),
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
        // Draft not ready yet — keep polling
      }
    };

    poll(); // Immediate first check
    const interval = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, phase, draftId, walletParam]);

  // ---- "At 10" effect: triggers server poll (live) or immediate transition (local) ----
  useEffect(() => {
    if (phase !== 'filling' || playerCount < 10) return;
    if (isLiveMode && !draftId) return;

    if (!isLiveMode) {
      // LOCAL MODE: transition immediately
      const shuffled = [...DRAFT_PLAYERS].sort(() => Math.random() - 0.5);
      setServerPollResult({ order: shuffled, countdownStart: Date.now() });
      return;
    }

    // LIVE MODE: poll server for draft order
    if (serverPollStartedRef.current) return; // Already polling
    serverPollStartedRef.current = true;
    setWaitingForServer(true);

    // Reuse existing timestamp if resuming (e.g., re-entering from drafting page)
    // so the progress bar continues from where it was, not restarting
    const existingTimestamp = draftId ? draftStore.getDraft(draftId)?.randomizingStartedAt : undefined;
    const randomizingStartedAt = existingTimestamp || Date.now();

    // Compute initial progress from elapsed time so the bar doesn't flash to 0%
    const initialElapsed = Date.now() - randomizingStartedAt;
    const initialT = Math.min(1, initialElapsed / 15000);
    const initialProgress = 0.99 * (1 - Math.pow(1 - initialT, 3));
    setServerWaitProgress(initialProgress);
    serverWaitProgressRef.current = initialProgress;

    // Sync to draftStore so drafting page can show progress bar
    if (draftId) {
      draftStore.updateDraft(draftId, { randomizingStartedAt, players: 10 });
    }
    const MIN_RANDOMIZING_MS = 3000;
    const pollDraftId = draftId; // Capture for async closure

    // Smooth progress animation — ticks every 50ms, reaches ~99% over ~15s
    // Independent of API attempts so the bar moves smoothly
    let pollDone = false;
    const progressInterval = setInterval(() => {
      if (pollDone) { clearInterval(progressInterval); return; }
      const elapsed = Date.now() - randomizingStartedAt;
      // Cubic ease-out: decelerates more gradually than quadratic
      const t = Math.min(1, elapsed / 15000); // 15s to reach max
      const progress = 0.99 * (1 - Math.pow(1 - t, 3)); // cubic ease-out, cap 99%
      serverWaitProgressRef.current = progress;
      setServerWaitProgress(progress);
    }, 50);

    (async () => {
      let attempts = 0;
      while (attempts < 30) {
        attempts++;
        try {
          console.log(`[Draft Room] Waiting for server (attempt ${attempts})...`);
          const info = await draftApi.getDraftInfo(pollDraftId);

          if (!info.draftOrder || info.draftOrder.length < 10) {
            throw new Error(`Draft order incomplete: ${info.draftOrder?.length || 0}/10`);
          }

          const realOrder = info.draftOrder.map((u: { ownerId: string }, idx: number) => ({
            id: String(idx + 1),
            name: u.ownerId,
            displayName: u.ownerId.length > 10
              ? u.ownerId.slice(0, 6) + '...' + u.ownerId.slice(-4)
              : u.ownerId,
            isYou: u.ownerId.toLowerCase() === walletParam.toLowerCase(),
            avatar: '🍌',
          }));

          pollDone = true;
          clearInterval(progressInterval);
          setDraftOrder(realOrder);
          console.log('[Draft Room] Wallets loaded:', realOrder.map((p: { displayName: string }) => p.displayName));

          // Smoothly animate remaining progress to 100% over ~300ms
          const currentProgress = serverWaitProgressRef.current;
          await new Promise<void>(resolve => {
            const steps = 10;
            const stepTime = 30; // 30ms per step = 300ms total
            let step = 0;
            const finishInterval = setInterval(() => {
              step++;
              const t = step / steps;
              const smoothed = currentProgress + (1 - currentProgress) * t;
              serverWaitProgressRef.current = smoothed;
              setServerWaitProgress(smoothed);
              if (step >= steps) {
                clearInterval(finishInterval);
                setServerWaitProgress(1);
                resolve();
              }
            }, stepTime);
          });

          // Ensure minimum total display time
          const elapsed = Date.now() - randomizingStartedAt;
          if (elapsed < MIN_RANDOMIZING_MS) {
            await new Promise(r => setTimeout(r, MIN_RANDOMIZING_MS - elapsed));
          }

          // Store result in state — the transition effect below will pick it up
          console.log('[Draft Room] Setting serverPollResult to trigger transition');
          setServerPollResult({ order: realOrder, countdownStart: Date.now() });
          return;
        } catch (err) {
          console.warn(`[Draft Room] Server not ready (attempt ${attempts}):`, err instanceof Error ? err.message : err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      // Exhausted — fall back to local
      pollDone = true;
      clearInterval(progressInterval);
      console.log('[Draft Room] Server poll exhausted — falling back to local');
      const shuffled = [...DRAFT_PLAYERS].sort(() => Math.random() - 0.5);
      setServerPollResult({ order: shuffled, countdownStart: Date.now() });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playerCount, draftId]);

  // ---- Transition effect: when serverPollResult is set, move to pre-spin ----
  useEffect(() => {
    if (!serverPollResult) return;
    // Only transition if we're still in filling phase
    if (phase !== 'filling') {
      setServerPollResult(null);
      return;
    }

    const { order, countdownStart } = serverPollResult;
    setServerPollResult(null); // Consume the result

    const userPos = order.findIndex((p: { isYou: boolean }) => p.isYou);
    setDraftOrder(order);
    setUserDraftPosition(userPos);
    preSpinStartedAtRef.current = countdownStart;
    setWaitingForServer(false);
    setPhase('pre-spin');
    setPreSpinCountdown(15);
    const remaining = Math.max(0, Math.floor(60 - (Date.now() - countdownStart) / 1000));
    setMainCountdown(remaining);

    if (isLiveMode) setLiveDataReady(true);
    if (draftId) {
      draftStore.updateDraft(draftId, {
        phase: 'pre-spin',
        preSpinStartedAt: countdownStart,
        randomizingStartedAt: undefined,  // Clear — no longer randomizing
        draftOrder: order,
        userDraftPosition: userPos,
      });
    }
    console.log('[Draft Room] Transitioned to pre-spin phase');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPollResult]);

  // ==================== PRE-SPIN COUNTDOWN (timestamp-based) ====================
  useEffect(() => {
    if (phase !== 'pre-spin') return;
    const startedAt = preSpinStartedAtRef.current;
    if (!startedAt) return;

    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const preSpin = Math.max(0, Math.floor(15 - elapsed));
      const main = Math.max(0, Math.floor(60 - elapsed));
      setPreSpinCountdown(preSpin);
      setMainCountdown(main);
    };
    tick(); // immediate

    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Transition from pre-spin to spinning when preSpinCountdown hits 0
  useEffect(() => {
    if (phase !== 'pre-spin') return;
    if (preSpinCountdown > 0) return;

    const selectedResult: DraftType = draftType || 'pro';
    const reelResults: DraftType[] = [selectedResult, selectedResult, selectedResult];
    setDraftType(selectedResult);
    // Don't write type to store yet — reveal hasn't happened.
    // Type is written to store when slot animation completes (result phase).
    if (draftId) {
      draftStore.updateDraft(draftId, {
        phase: 'spinning',
        yourPosition: userDraftPosition >= 0 ? userDraftPosition + 1 : undefined,
      });
    }
    setAllReelItems([
      generateReelItemsForReel(reelResults[0], 0),
      generateReelItemsForReel(reelResults[1], 1),
      generateReelItemsForReel(reelResults[2], 2),
    ]);
    setShowSlotMachine(true);
    setSlotAnimationDone(false);
    setPhase('spinning');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, preSpinCountdown]);

  // Main countdown (timestamp-based, for spinning/result phases)
  useEffect(() => {
    if (phase !== 'spinning' && phase !== 'result') return;
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
    tick(); // immediate

    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, playCountdownTick]);

  // ==================== DRAFT START ====================
  // ==================== COUNTDOWN END: Transition to active drafting ====================
  useEffect(() => {
    if (phase !== 'pre-spin' && phase !== 'spinning' && phase !== 'result') return;
    if (mainCountdown > 0) return;

    // Clean up visual effects
    setShowSlotMachine(false);
    setScreenShake(false);
    setJackpotRain([]);
    setConfetti([]);
    setPulseGlow(false);
    setParticleBurst([]);

    if (isLiveMode) {
      if (engineReady) {
        // loadLiveData already initialized the engine from real server data — just transition phase.
        // The countdown was synced to the server's draftStartTime, so when it hits 0 the server
        // is ready and WS timer_update will start the 30-second pick timer naturally.
        console.log('[Draft Room] Engine ready from server — starting real multiplayer draft');
        setPhase('drafting');
        if (draftId) {
          draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10, isYourTurn: false });
        }
      } else {
        // Server data not loaded yet — fall back to local mode immediately so bots
        // start picking right away instead of waiting for server retries to exhaust.
        console.log('[Draft Room] Countdown finished, engine not ready — falling back to local mode');
        setFallbackLocal(true);
        setPhase('drafting');
        if (draftOrder.length > 0) {
          engine.initializeDraft(draftOrder);
        }
        setEngineReady(true);
        if (draftId) {
          draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10, isYourTurn: false });
        }
      }
    } else {
      // Local mode: initialize engine directly
      setPhase('drafting');
      if (draftOrder.length > 0) {
        engine.initializeDraft(draftOrder);
      }
      setEngineReady(true);
      if (draftId) {
        draftStore.updateDraft(draftId, { status: 'drafting', phase: 'drafting', players: 10, isYourTurn: false });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mainCountdown, draftOrder, isLiveMode, engineReady, fallbackLocal]);

  // Note: No safety fallback needed — engine is always initialized immediately when countdown ends.
  // In live mode, loadLiveData continues retrying in the background and initializeFromServer()
  // overwrites the local engine state with real server data when it succeeds.

  useEffect(() => {
    if (mainCountdown <= 15 && showSlotMachine && slotAnimationDone) setShowSlotMachine(false);
  }, [mainCountdown, showSlotMachine, slotAnimationDone]);

  useEffect(() => {
    if (mainCountdown <= 15 && screenShake) setScreenShake(false);
  }, [mainCountdown, screenShake]);

  // Continuous rain while shaking
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

  // ==================== SPINNING ANIMATION ====================
  useEffect(() => {
    if (phase !== 'spinning') return;
    if (allReelItems[0]?.length === 0) return;

    const itemHeight = 130;
    const landingIndex = (allReelItems[0]?.length || 50) - 8;
    const targetOffset = landingIndex * itemHeight;
    const reelDurations = [2000, 4000, 6000];
    const offset = animationOffsetRef.current;
    animationOffsetRef.current = 0; // Reset after use
    const startTime = performance.now() - offset;
    let animationId: number;
    const stoppedReels = [false, false, false];
    // Mark reels that are already stopped from the offset (don't play sound for them)
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
        if (progress >= 1 && !stoppedReels[i]) { stoppedReels[i] = true; playReelStop(); }
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
            id: i, x: Math.random() * 100,
            color: colors[Math.floor(Math.random() * colors.length)],
            delay: Math.random() * 0.3,
          })));
          setTimeout(() => {
            setConfetti(prev => [...prev, ...Array.from({ length: 100 }, (_, i) => ({
              id: 200 + i, x: Math.random() * 100,
              color: colors[Math.floor(Math.random() * colors.length)],
              delay: Math.random() * 0.3,
            }))]);
          }, 1000);
          setTimeout(() => setConfetti([]), 6000);

          setParticleBurst(Array.from({ length: 40 }, (_, i) => ({
            id: i, x: 50, y: 40, angle: (i / 40) * 360,
            color: colors[Math.floor(Math.random() * colors.length)],
          })));
          setTimeout(() => setParticleBurst([]), 1500);

          setJackpotRain(Array.from({ length: 35 }, (_, i) => ({
            id: i, x: Math.random() * 100,
            delay: Math.random() * 2.5,
            size: 16 + Math.random() * 24,
          })));
        }

        setTimeout(() => {
          playWinSound(draftType === 'jackpot' || draftType === 'hof');
          setSlotAnimationDone(true);
          setPhase('result');
          if (draftId) {
            // NOW reveal the type to draftStore — slot machine animation is done
            draftStore.updateDraft(draftId, { phase: 'result', type: draftType, draftType: draftType });
          }
        }, 400);
      }
    };

    const startTimeout = setTimeout(() => {
      playSpinningSound();
      animationId = requestAnimationFrame(animate);
    }, 200);

    return () => {
      clearTimeout(startTimeout);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [phase, allReelItems, draftType, playReelStop, playWinSound, playSpinningSound]);

  // ==================== AUTO-SCROLL BANNER TO CURRENT PICK ====================
  useEffect(() => {
    if (phase !== 'drafting' || !bannerRef.current) return;
    const currentCard = bannerRef.current.querySelector(`[data-pick="${engine.currentPickNumber}"]`);
    if (currentCard) {
      currentCard.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    }
  }, [phase, engine.currentPickNumber]);

  // ==================== FREEZE DETECTION (matches old system) ====================
  // Increased threshold to 30s to avoid triggering unnecessary reconnects that cause
  // state oscillation when Cloud Run has multiple instances.
  useEffect(() => {
    // Only check for freezes when draft is actively picking (not during countdown or pre-draft)
    if (!isLiveMode || phase !== 'drafting' || engine.draftStatus === 'completed' || engine.draftPhase === 'countdown') return;
    const check = setTimeout(() => {
      if (Date.now() - lastWsUpdateRef.current > 30_000) {
        console.log('[Freeze] No timer update in 30s, forcing reconnect');
        ws.forceReconnect();
      }
    }, 10_000);
    return () => clearTimeout(check);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, phase, engine.draftStatus, engine.draftPhase, engine.timeRemaining]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? `0${m}` : m}:${s < 10 ? `0${s}` : s}`;
  };

  // All phases share the same layout — no separate filling page

  const getBgColor = () => {
    if ((phase === 'result' || phase === 'drafting') && draftType) {
      if (draftType === 'jackpot') return 'bg-gradient-to-b from-red-950 to-red-950/50';
      if (draftType === 'hof') return 'bg-gradient-to-b from-yellow-950 to-yellow-950/50';
    }
    return 'bg-black';
  };

  // Helper to get position counts for banner cards
  const getPositionCountsForPlayer = (playerName: string) => {
    const roster = engine.rosters[playerName];
    if (!roster) return { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
    return {
      QB: roster.QB?.length ?? 0,
      RB: roster.RB?.length ?? 0,
      WR: roster.WR?.length ?? 0,
      TE: roster.TE?.length ?? 0,
      DST: roster.DST?.length ?? 0,
    };
  };

  // Roster view switch
  const handleViewRoster = (_playerName: string) => {
    setActiveTab('roster');
  };

  // ==================== RENDER ====================
  return (
    <div className={`min-h-screen text-white overflow-hidden flex flex-col transition-colors duration-1000 ${getBgColor()} ${screenShake ? 'animate-shake' : ''}`}>
      {/* Flash overlay */}
      {showFlash && <div className="fixed inset-0 z-50 bg-white/30 pointer-events-none animate-flash" />}

      {/* Confetti */}
      {confetti.length > 0 && (
        <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
          {confetti.map((particle) => (
            <div
              key={particle.id}
              className="absolute animate-confetti"
              style={{
                left: `${particle.x}%`,
                backgroundColor: particle.color,
                animationDelay: `${particle.delay}s`,
                borderRadius: Math.random() > 0.5 ? '50%' : '0',
                width: `${8 + Math.random() * 8}px`,
                height: `${8 + Math.random() * 8}px`,
              }}
            />
          ))}
        </div>
      )}

      {/* Particle Burst */}
      {particleBurst.length > 0 && (
        <div className="fixed inset-0 z-45 pointer-events-none overflow-hidden">
          {particleBurst.map((particle) => {
            const rad = (particle.angle * Math.PI) / 180;
            return (
              <div
                key={particle.id}
                className="absolute w-4 h-4 rounded-full animate-burst"
                style={{
                  left: `${particle.x}%`, top: `${particle.y}%`,
                  backgroundColor: particle.color,
                  '--end-x': `${Math.cos(rad) * 400}px`,
                  '--end-y': `${Math.sin(rad) * 400}px`,
                  boxShadow: `0 0 10px ${particle.color}`,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      )}

      {/* Pulsing glow */}
      {pulseGlow && draftType && (draftType === 'jackpot' || draftType === 'hof') && (
        <div
          className="fixed inset-0 z-30 pointer-events-none animate-pulse-glow"
          style={{
            background: draftType === 'jackpot'
              ? 'radial-gradient(circle at center, rgba(239, 68, 68, 0.3) 0%, transparent 70%)'
              : 'radial-gradient(circle at center, rgba(255, 215, 0, 0.3) 0%, transparent 70%)',
          }}
        />
      )}

      {/* Text Rain */}
      {jackpotRain.length > 0 && draftType && (
        <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
          {jackpotRain.map((item) => (
            <div
              key={item.id}
              className={`absolute animate-jackpot-rain font-black italic ${draftType === 'jackpot' ? 'text-red-500' : 'text-yellow-400'}`}
              style={{
                left: `${item.x}%`, fontSize: `${item.size}px`,
                animationDelay: `${item.delay}s`,
                textShadow: draftType === 'jackpot'
                  ? '0 0 10px rgba(239, 68, 68, 0.8)'
                  : '0 0 10px rgba(250, 204, 21, 0.8)',
              }}
            >
              {draftType === 'jackpot' ? 'JACKPOT' : 'HOF'}
            </div>
          ))}
        </div>
      )}

      {/* Top Bar — during filling, loading, or when draft completed */}
      {(phase === 'filling' || phase === 'loading' || engine.draftStatus === 'completed') && (
        <div className="h-14 bg-black/30 border-b border-white/10 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-bold">{contestName}</span>
            {draftType && phase !== 'filling' && (
              <>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  draftType === 'jackpot' ? 'bg-red-500/30 text-red-400' :
                  draftType === 'hof' ? 'bg-yellow-500/30 text-yellow-400' :
                  'bg-purple-500/30 text-purple-400'
                }`}>{draftType.toUpperCase()}</span>
                <VerifiedBadge type="draft-type" draftType={draftType} />
              </>
            )}
            {phase === 'filling' && (
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-white/10 text-white/50">UNREVEALED</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {phase === 'drafting' && engine.draftStatus === 'active' && (
              <>
                {engine.isUserTurn && (
                  <div className={`px-3 py-1 rounded-full text-sm font-bold ${
                    engine.timeRemaining <= 10 ? 'bg-red-500 animate-pulse' : 'bg-yellow-500 text-black'
                  }`}>
                    {formatTime(engine.timeRemaining)}
                  </div>
                )}
                <span className="text-white/50 text-sm">Pick {engine.currentPickNumber}/{TOTAL_PICKS}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Live mode loading is handled by the loading skeleton in the player list area */}

      {/* Live mode error — floating card (non-blocking) */}
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
                onClick={() => {
                  liveRetryCountRef.current = 0;
                  liveInitializedRef.current = false;
                  setLiveError(null);
                  setLiveDataReady(false);
                  setTimeout(() => setLiveDataReady(true), 100);
                }}
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

      {/* Live mode connection indicator */}
      {isLiveMode && (phase === 'drafting' || phase === 'loading' || phase === 'filling') && (
        <div className="absolute top-16 right-4 z-20 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${ws.isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
          <span className="text-xs text-white/40">{ws.isConnected ? 'Connected' : 'Reconnecting...'}</span>
        </div>
      )}

      {/* Loading phase — brief spinner while checking server state on re-entry */}
      {phase === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-banana border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/60 text-sm">Reconnecting to draft...</p>
          </div>
        </div>
      )}

      {/* Filling/pre-drafting overlays removed — all status shown inline in unified banner */}

      {/* ==================== UNIFIED BANNER (ALL phases except loading) ==================== */}
      {engine.draftStatus !== 'completed' && phase !== 'loading' && (
        <>
          {/* Pick Cards Banner */}
          <div className="fixed top-0 left-0 z-20 w-full overflow-hidden font-primary" style={{ backgroundColor: (phase === 'result' || phase === 'drafting') ? (draftType === 'jackpot' ? '#ef4444' : draftType === 'hof' ? '#B8960C' : '#000') : '#000' }}>
            <div
              ref={bannerRef}
              className="w-full flex gap-2 lg:gap-5 overflow-x-auto banner-no-scrollbar"
              style={{ marginTop: '15px' }}
            >
              {/* Engine-powered banner (after data loads) OR pre-engine 10-box banner */}
              {engineReady ? engine.draftSummary.map((slot) => {
                const isPicked = slot.playerId !== '';
                const isCurrent = slot.pickNum === engine.currentPickNumber;
                const isUpcoming = slot.pickNum > engine.currentPickNumber;
                const isUserCard = slot.ownerIndex === engine.userDraftPosition;
                const posHex = isPicked ? getPositionColorHex(slot.position) : '';
                const counts = getPositionCountsForPlayer(slot.ownerName);

                // Border color: user = banana yellow, current = white, others = #444
                const borderColor = isUserCard ? '#F3E216' : isCurrent ? '#fff' : '#444';
                // Text color based on league level
                const textColor = draftType === 'hof' && isUserCard ? '#111'
                  : draftType === 'jackpot' && isUserCard ? '#222'
                  : '#fff';

                const playerData = engine.draftOrder[slot.ownerIndex];
                const displayName = playerData
                  ? (playerData.isYou ? (playerData.displayName || 'You') : (playerData.displayName || playerData.name || ''))
                  : (slot.ownerName || '');
                const truncatedName = (displayName || '').length > 12 ? (displayName || '').substring(0, 10) + '...' : (displayName || '');

                return (
                  <div
                    key={slot.pickNum}
                    data-pick={slot.pickNum}
                    className="flex-shrink-0 text-center overflow-hidden cursor-pointer"
                    style={{
                      minWidth: '140px',
                      flex: 1,
                      padding: '10px 0 0 0',
                      borderRadius: '5px',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor: borderColor,
                      transition: 'all 0.25s ease-in-out',
                      background: isUserCard
                        ? (draftType === 'hof' ? '#F3E216' : draftType === 'jackpot' ? '#FF474C' : '#222')
                        : '#222',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.borderColor = '#fff'; }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isUserCard
                        ? (draftType === 'hof' ? '#F3E216' : draftType === 'jackpot' ? '#FF474C' : '#222')
                        : '#222';
                      e.currentTarget.style.borderColor = borderColor;
                    }}
                    onClick={() => handleViewRoster(slot.ownerName)}
                  >
                    <div>
                      {/* Profile image — always shown */}
                      {isUserCard && user?.profilePicture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.profilePicture} alt="You" className="rounded-full w-[30px] h-[30px] mx-auto border border-gray-500 object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src="/banana-profile.png" alt="Banana" className="rounded-full w-[30px] mx-auto h-[30px] border border-gray-500" />
                      )}

                      {/* Timer (current pick) OR R/P labels (all other picks) — matches old layout */}
                      {isCurrent && engine.draftStatus !== 'completed' ? (
                        <div style={{
                          fontWeight: 'bold',
                          fontSize: '18px',
                          margin: '5px auto 0px auto',
                          textAlign: 'center',
                          color: (phase !== 'drafting' ? mainCountdown : engine.timeRemaining) > 10 ? '#fff' : (draftType === 'jackpot' ? 'yellow' : 'red'),
                        }}>
                          {formatTime(phase !== 'drafting' ? mainCountdown : engine.timeRemaining)}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginTop: 5, paddingBottom: 3 }}>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: textColor }}>R{slot.round}</span>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: textColor }}>P{slot.pickNum}</span>
                        </div>
                      )}

                      {/* Display name — always shown */}
                      <div className="lg:mt-1 font-bold text-[11px] lg:text-[14px] font-primary" style={{ color: textColor }}>
                        {truncatedName}
                      </div>

                      {/* Bottom section: position counts (upcoming), status text (current), or player ID (completed) */}
                      {isUpcoming && (
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: '54px', color: textColor }}>
                          {(['QB', 'RB', 'WR', 'TE', 'DST'] as const).map(pos => (
                            <div
                              key={pos}
                              style={{ flex: 1, borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: POSITION_COLORS[pos], textAlign: 'center' }}
                            >
                              <p style={{ fontSize: '10px' }}>{pos}</p>
                              <p className="text-xs">{counts[pos]}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {isCurrent && (
                        <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: '#fff', width: '100%', minHeight: '54px' }}>
                          <p className="font-primary text-[15px] font-bold italic text-center pt-2" style={{ color: textColor }}>
                            {phase !== 'drafting' ? 'Starting soon!' : 'Picking...'}
                          </p>
                        </div>
                      )}
                      {isPicked && (
                        <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: posHex, width: '100%', height: '55px' }}>
                          <p className="font-primary" style={{ fontWeight: 800, fontSize: 15, textAlign: 'center', paddingTop: 5, color: textColor }}>
                            {slot.playerId}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }) : /* Pre-engine: unified 10-box banner for filling + pre-spin + spinning + result */
              Array.from({ length: 10 }, (_, i) => {
                const player = draftOrder[i];
                const isFilling = phase === 'filling';
                const isRandomizing = isFilling && waitingForServer;
                const isFilled = isRandomizing ? true : isFilling ? (i < playerCount) : true;
                const isUser = player?.isYou ?? false;
                // Match drafting card style: user = yellow border, filled = #444, unfilled = #333
                const borderColor = isUser ? '#F3E216' : isFilled ? '#444' : '#333';
                // Show wallet addresses when available, placeholder names otherwise
                const hasWalletData = player && !player.isYou && player.name && player.name.length > 10;
                const displayName = isRandomizing
                  ? (isUser ? 'You' : (hasWalletData ? player!.displayName : `Player ${i + 1}`))
                  : isFilling
                  ? (isUser ? 'You' : (isFilled ? `Player ${i + 1}` : '---'))
                  : (player ? (player.isYou ? (player.displayName || 'You') : (player.displayName || player.name || '')) : '???');
                const truncatedName = (displayName || '').length > 12 ? (displayName || '').substring(0, 10) + '...' : (displayName || '');

                // During pre-spin+, first box shows countdown timer
                const showCountdown = !isFilling && i === 0;
                // User background matches drafting cards (draft-type color when known)
                const bgColor = isUser && isFilled
                  ? (draftType === 'hof' ? '#F3E216' : draftType === 'jackpot' ? '#FF474C' : '#222')
                  : '#222';
                const textColor = isUser && draftType === 'hof' ? '#111'
                  : isUser && draftType === 'jackpot' ? '#222'
                  : '#fff';

                return (
                  <div
                    key={i}
                    className="flex-shrink-0 text-center overflow-hidden cursor-pointer"
                    style={{
                      minWidth: '140px',
                      flex: 1,
                      padding: '10px 0 0 0',
                      borderRadius: '5px',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor,
                      transition: 'all 0.4s ease-in-out',
                      background: isFilled ? bgColor : '#1a1a1a',
                    }}
                  >
                    <div>
                      {/* Avatar — same as drafting cards */}
                      {isUser && user?.profilePicture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.profilePicture} alt="You" className="rounded-full w-[30px] h-[30px] mx-auto border border-gray-500 object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src="/banana-profile.png"
                          alt="Banana"
                          className={`rounded-full w-[30px] mx-auto h-[30px] border border-gray-500 ${!isFilled ? 'animate-pulse' : ''}`}
                          style={{ opacity: isFilled ? 1 : 0.4 }}
                        />
                      )}

                      {/* Countdown timer (pre-spin+, first box) or slot number — same layout as drafting R/P labels */}
                      {showCountdown ? (
                        <div style={{ fontWeight: 'bold', fontSize: '18px', margin: '5px auto 0px auto', textAlign: 'center', color: textColor }}>
                          {formatTime(mainCountdown)}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginTop: 5, paddingBottom: 3 }}>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: isFilled ? textColor : '#444' }}>#{i + 1}</span>
                        </div>
                      )}

                      {/* Display name — same font/size as drafting cards */}
                      <div className={`lg:mt-1 font-bold text-[11px] lg:text-[14px] font-primary ${isRandomizing && !isUser ? 'animate-pulse' : ''}`} style={{ color: isFilled ? (isUser ? (draftType ? textColor : '#F3E216') : textColor) : '#444' }}>
                        {truncatedName}
                      </div>

                      {/* Bottom section — matches drafting card layout */}
                      {!isFilled ? (
                        // Unfilled: subtle waiting indicator with same height as position counts
                        <div style={{ minHeight: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="animate-pulse" style={{ fontSize: '12px', color: '#444' }}>Waiting...</span>
                        </div>
                      ) : showCountdown ? (
                        // Countdown box: "Starting soon!" with white bottom border (matches "Picking..." style)
                        <div style={{ borderBottomWidth: 5, borderBottomStyle: 'solid', borderBottomColor: '#fff', width: '100%', minHeight: '54px' }}>
                          <p className="font-primary text-[15px] font-bold italic text-center pt-2" style={{ color: '#4ade80' }}>
                            Starting soon!
                          </p>
                        </div>
                      ) : (
                        // Filled: position count columns (all zeros) — matches drafting "upcoming" cards
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: '54px', color: textColor }}>
                          {(['QB', 'RB', 'WR', 'TE', 'DST'] as const).map(pos => (
                            <div
                              key={pos}
                              style={{ flex: 1, borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: POSITION_COLORS[pos], textAlign: 'center', opacity: 0.5 }}
                            >
                              <p style={{ fontSize: '10px' }}>{pos}</p>
                              <p className="text-xs">0</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Status text below banner — all phases */}
            <div className="grow text-center uppercase text-sm font-bold px-3 pt-2 mt-3 font-primary">
              {phase === 'filling' && waitingForServer ? (
                <div className="flex flex-col items-center gap-2 w-full max-w-xs mx-auto">
                  <span className="text-white/70 text-xs tracking-widest uppercase">Randomizing Draft Order</span>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden backdrop-blur-sm">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(serverWaitProgress * 100)}%`,
                        background: serverWaitProgress >= 1
                          ? '#4ade80'
                          : 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                      }}
                    />
                  </div>
                  <span className="text-white/40 text-[10px]">{Math.round(serverWaitProgress * 100)}%</span>
                </div>
              ) : phase === 'filling' ? (
                <span className="text-yellow-400">
                  <span className="text-2xl font-black tabular-nums">{playerCount}/10</span>
                  <span className="text-white/60 ml-2 text-sm">Waiting for players...</span>
                </span>
              ) : phase === 'pre-spin' ? (
                <span className="text-yellow-400 flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                  Draft type reveal in {preSpinCountdown}s
                  <span className="text-white/50 ml-2">· Starting in {formatTime(mainCountdown)}</span>
                </span>
              ) : (phase === 'spinning' || phase === 'result') ? (
                <span className="text-white/70">Draft starting in {formatTime(mainCountdown)}</span>
              ) : phase === 'drafting' && engine.isUserTurn ? (
                'Your turn to draft!'
              ) : phase === 'drafting' && engine.turnsUntilUserPick > 0 ? (
                `${engine.turnsUntilUserPick} turn(s) until your pick!`
              ) : null}
            </div>

            {/* Mute button + league logo row */}
            <div className="flex items-center justify-center py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
              {draftType === 'hof' && (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/hof-logo.jpg" alt="Hall of Fame" className="w-[50px] mr-2 h-auto" style={{ filter: 'sepia(100%) saturate(400%) brightness(110%) hue-rotate(10deg)' }} />
                </div>
              )}
              {draftType === 'jackpot' && (
                <div style={{ marginRight: '5px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/jackpot-logo.png" alt="Jackpot" className="w-[100px] mr-2 h-auto" />
                </div>
              )}
              <div>
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="text-[12px] text-right cursor-pointer flex items-center justify-end border border-gray-500 px-1 mr-2 font-primary"
                >
                  {isMuted ? 'UNMUTE' : 'MUTE'} <span className="ml-1">🎵</span>
                </button>
              </div>
            </div>
          </div>

          {/* Spacer after fixed banner */}
          <div style={{ height: '290px', flexShrink: 0, backgroundColor: '#000' }} />

        </>
      )}

      {/* Main Content — single column, no sidebar (hidden during loading) */}
      <div className={`flex-1 flex flex-col overflow-hidden ${phase === 'loading' ? 'hidden' : ''}`}>
        {/* Tab navigation — inside content so it centers on the same width */}
        <DraftTabs activeTab={activeTab} onTabChange={setActiveTab} queueCount={engine.queuedPlayers.length} />

        {/* Tab content area */}
        {phase === 'drafting' && engine.draftStatus === 'completed' ? (
          <DraftComplete />
        ) : (
          <>
            {activeTab === 'draft' && (
              <DraftPlayerList
                availablePlayers={engine.availablePlayers}
                isUserTurn={phase === 'drafting' && engine.isUserTurn}
                onDraft={(playerId) => {
                  if (phase !== 'drafting') return;
                  handleLiveDraft(playerId);
                }}
                onAddToQueue={(player) => {
                  engine.addToQueue(player);
                  if (isLiveMode && phase === 'drafting') {
                    const newQueue = [...engine.queuedPlayers, player];
                    handleLiveQueueSync(newQueue);
                  }
                }}
                onRemoveFromQueue={(playerId) => {
                  engine.removeFromQueue(playerId);
                  if (isLiveMode && phase === 'drafting') {
                    const newQueue = engine.queuedPlayers.filter(p => p.playerId !== playerId);
                    handleLiveQueueSync(newQueue);
                  }
                }}
                isInQueue={(playerId) => engine.isInQueue(playerId)}
              />
            )}
            {activeTab === 'queue' && (
              <DraftQueue
                queuedPlayers={engine.queuedPlayers}
                availablePlayers={engine.availablePlayers}
                isUserTurn={phase === 'drafting' && engine.isUserTurn}
                onDraft={(playerId) => {
                  if (phase !== 'drafting') return;
                  handleLiveDraft(playerId);
                }}
                onRemoveFromQueue={(playerId) => {
                  engine.removeFromQueue(playerId);
                  if (isLiveMode && phase === 'drafting') {
                    const newQueue = engine.queuedPlayers.filter(p => p.playerId !== playerId);
                    handleLiveQueueSync(newQueue);
                  }
                }}
                onReorderQueue={(newOrder) => {
                  engine.reorderQueue(newOrder);
                  if (isLiveMode && phase === 'drafting') handleLiveQueueSync(newOrder);
                }}
              />
            )}
            {activeTab === 'board' && (
              <DraftBoardGrid
                draftOrder={engine.draftOrder}
                draftSummary={engine.draftSummary}
                currentPickNumber={engine.currentPickNumber}
                userDraftPosition={engine.userDraftPosition}
                onViewRoster={handleViewRoster}
              />
            )}
            {activeTab === 'roster' && (
              <DraftRoster
                draftOrder={engine.draftOrder}
                rosters={engine.rosters}
                picks={engine.picks}
                userDraftPosition={engine.userDraftPosition}
              />
            )}
            {activeTab === 'chat' && (
              <DraftRoomChat
                playerCount={playerCount}
                phase={phase}
                username={user?.username}
              />
            )}
          </>
        )}
      </div>

      {/* Slot Machine Overlay */}
      {showSlotMachine && (
        <SlotMachineOverlay
          allReelItems={allReelItems}
          reelOffsets={reelOffsets}
          draftType={draftType}
          phase={phase}
          mainCountdown={mainCountdown}
          slotAnimationDone={slotAnimationDone}
          formatTime={formatTime}
          onClose={() => slotAnimationDone && setShowSlotMachine(false)}
        />
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
        @keyframes result-appear {
          0% { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-result-appear { animation: result-appear 0.5s ease-out forwards; }
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
        .banner-no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .banner-no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
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
// force deploy 1772096171
