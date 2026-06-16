'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRealTimeDraftInfo } from '@/hooks/useRealTimeDraftInfo';
import { useDraftWebSocket } from '@/hooks/useDraftWebSocket';
import { useTimeRemaining } from '@/hooks/useTimeRemaining';
import { isSlowDraftPickLength, isSlowDraftNightPause } from '@/utils/slowDraftClock';
import { useDraftEngine } from '@/hooks/useDraftEngine';
import * as draftApi from '@/lib/draftApi';
import * as draftStore from '@/lib/draftStore';
import { isStagingMode } from '@/lib/staging';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { logger } from '@/lib/logger';
import { capDisplayTimeRemaining } from '@/utils/draftTimer';
import { clientLog } from '@/lib/clientLog';
import type { RoomPhase } from '@/lib/draftRoomConstants';
import type {
  DraftInfoPayload,
  NewPickPayload,
  TimerPayload,
} from '@/hooks/useDraftWebSocket';

type PendingWsMessage =
  | { type: 'timer_update'; payload: TimerPayload }
  | { type: 'new_pick'; payload: NewPickPayload }
  | { type: 'draft_info_update'; payload: DraftInfoPayload };

type JoinStatus = 'idle' | 'joining' | 'joined' | 'failed';

function countSummaryPicks(summary: draftApi.DraftSummary): number {
  return summary.filter((item) => Boolean(item.playerInfo?.playerId)).length;
}

interface UseDraftLiveSyncParams {
  engine: ReturnType<typeof useDraftEngine>;
  isLiveMode: boolean;
  draftId: string;
  setDraftId: Dispatch<SetStateAction<string>>;
  walletParam: string;
  speedParam: 'fast' | 'slow' | null;
  passTypeParam: 'paid' | 'free' | null;
  phase: RoomPhase;
  liveDataReady: boolean;
  setLiveDataReady: Dispatch<SetStateAction<boolean>>;
  setFallbackLocal: Dispatch<SetStateAction<boolean>>;
  setPhase: Dispatch<SetStateAction<RoomPhase>>;
  setMainCountdown: Dispatch<SetStateAction<number>>;
  setShowSlotMachine: Dispatch<SetStateAction<boolean>>;
  setPlayerCount: Dispatch<SetStateAction<number | null>>;
  /** Stamped with Date.now() when our join lands, to gate the post-join
   *  stale-count grace window in the draft room. */
  joinAtRef: MutableRefObject<number>;
  draftIdRef: MutableRefObject<string>;
}

export function useDraftLiveSync({
  engine,
  isLiveMode,
  draftId,
  setDraftId,
  walletParam,
  speedParam,
  passTypeParam,
  phase,
  liveDataReady,
  setLiveDataReady,
  setFallbackLocal,
  setPhase,
  setMainCountdown,
  setShowSlotMachine,
  setPlayerCount,
  joinAtRef,
  draftIdRef,
}: UseDraftLiveSyncParams) {
  const { getAccessToken } = usePrivy();
  const getAccessTokenRef = useRef(getAccessToken);
  useEffect(() => { getAccessTokenRef.current = getAccessToken; }, [getAccessToken]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);

  const liveInitializedRef = useRef(false);
  const [joinStatus, setJoinStatus] = useState<JoinStatus>('idle');
  const [joinAttempt, setJoinAttempt] = useState(0);
  const liveRetryCountRef = useRef(0);
  // How many times loadLiveData has waited because the draft simply hasn't
  // STARTED yet (still filling/randomizing). These waits are NOT failures —
  // a slow bot-filled draft can sit in filling for minutes — so they must not
  // count toward liveRetryCountRef (the fall-to-local budget). Bounded only by
  // a generous ceiling so a genuinely stuck draft still eventually surfaces.
  const fillingWaitCountRef = useRef(0);
  // Mirror of `phase` so the loadLiveData retry closure (which doesn't list
  // phase in its deps) can read the CURRENT phase when deciding wait-vs-fail.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const loadLiveDataGenerationRef = useRef(0);
  const loadLiveDataRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadLiveDataReadyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWsMessagesRef = useRef<PendingWsMessage[]>([]);
  const lastWsUpdateRef = useRef<number>(Date.now());
  const lastFirebaseUpdateRef = useRef<number>(Date.now());
  const watchdogBackoffRef = useRef(5_000);
  const lastWatchdogAttemptRef = useRef(0);
  // Slow-draft "your pick is up" push fires exclusively server-side via the
  // Firebase Cloud Function listening on drafts/{id}/realTimeDraftInfo; a
  // previous client-side trigger here was removed because proving "some
  // logged-in user" doesn't prove "this push target is legitimate." The
  // server path with a shared secret is the sole caller of /api/notifications/pick-up.

  const firebaseActive = isLiveMode && engineReady && !!draftId;
  const firebaseRtdb = useRealTimeDraftInfo(draftId || null, firebaseActive);

  useEffect(() => {
    if (!firebaseActive || !firebaseRtdb.data) return;
    engine.setFirebaseState(firebaseRtdb.data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseActive, firebaseRtdb.data]);

  useEffect(() => {
    if (!firebaseActive || !firebaseRtdb.newPickDetected || !firebaseRtdb.detectedPick) return;

    logger.debug('[Firebase] New pick detected:', firebaseRtdb.detectedPick.playerId, 'pick#', firebaseRtdb.detectedPick.pickNum);
    engine.handleFirebaseNewPick(firebaseRtdb.detectedPick);
    firebaseRtdb.clearNewPick();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseActive, firebaseRtdb.newPickDetected, firebaseRtdb.detectedPick]);

  const firebaseEndOfTurn = firebaseRtdb.data?.pickEndTime ?? null;
  const firebaseDraftStart = firebaseRtdb.data?.draftStartTime ?? null;
  const firebasePickLength = firebaseRtdb.data?.pickLength ?? null;
  const firebaseTimeRemaining = useTimeRemaining(
    firebaseActive ? firebaseEndOfTurn : null,
    firebaseActive ? firebaseDraftStart : null,
    firebaseActive ? firebasePickLength : null,
  );

  useEffect(() => {
    if (firebaseRtdb.data) lastFirebaseUpdateRef.current = Date.now();
  }, [firebaseRtdb.data]);

  const prevJoinParamsRef = useRef({ walletParam, speedParam, passTypeParam, promoTypeParam });

  useEffect(() => {
    const prev = prevJoinParamsRef.current;
    if (
      prev.walletParam === walletParam &&
      prev.speedParam === speedParam &&
      prev.passTypeParam === passTypeParam &&
      prev.promoTypeParam === promoTypeParam
    ) {
      return;
    }
    prevJoinParamsRef.current = { walletParam, speedParam, passTypeParam, promoTypeParam };
    setJoinStatus('idle');
    setJoinAttempt((a) => a + 1);
  }, [walletParam, speedParam, passTypeParam, promoTypeParam]);

  useEffect(() => {
    if (!isLiveMode || draftId || !walletParam) return;
    setJoinStatus('joining');

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
      liveWalletAddress: walletParam,
      passType: passTypeParam || 'paid',
    });

    let cancelled = false;

    async function joinAndFill() {
      const MAX_JOIN_RETRIES = 3;
      let lastErr: unknown = null;
      // NOTE: no auto-mint here. Entry uses the real draft pass the wallet
      // already holds (free or paid), exactly like prod — the backend selects
      // a pass of the chosen type and binds that exact token to the league.
      // (Previously this minted a fake Date.now() staging token every join,
      // which bypassed the real pass, piled up stray tokens, and broke leave/
      // refund. Stock test wallets via /staging/mint-tokens instead.)

      for (let attempt = 1; attempt <= MAX_JOIN_RETRIES; attempt++) {
        if (cancelled) return;
        try {
          const { joinDraft } = await import('@/lib/api/leagues');
          const draftRoom = await joinDraft(
            walletParam,
            speedParam || 'fast',
            getAccessTokenRef.current,
            1,
            promoTypeParam ?? undefined,
            passTypeParam || 'paid',
          );
          if (!draftRoom?.id) throw new Error('Join failed: no draft ID');

          const newId = draftRoom.id;
          // Backend returns the post-join count under `numPlayers` (see
          // DraftToken.NumPlayers added in sbs-drafts-api models/draft-token.go).
          // Fallback to `.players` for any in-flight response from an
          // older backend revision during the deploy crossover.
          const joinedCount = (draftRoom as { numPlayers?: number; players?: number }).numPlayers
            ?? (draftRoom as { players?: number }).players;
          logger.debug('[Draft Room] Joined draft:', newId, 'numPlayers:', joinedCount);
          if (cancelled) return;
          setDraftId(newId);
          setJoinStatus('joined');

          // Show the real player count immediately from the join response —
          // the backend tells us the post-join count, so the room renders
          // the right number the instant the join lands instead of waiting
          // for the RTDB push or the 2.5s poll to catch up.
          if (typeof joinedCount === 'number' && joinedCount > 0) {
            clientLog('pcdiag', 'set.join', { numPlayers: joinedCount });
            // Mark our join time so the draft room ignores the brief stale
            // downward RTDB/poll reading that follows (our own count bump
            // hasn't propagated yet), while still showing real leaves live.
            joinAtRef.current = Date.now();
            setPlayerCount(Math.min(Math.max(joinedCount, 1), 10));
          }

          try {
            const hidden = JSON.parse(localStorage.getItem('banana-hidden-drafts') || '[]');
            if (hidden.includes(newId)) {
              localStorage.setItem('banana-hidden-drafts', JSON.stringify(hidden.filter((id: string) => id !== newId)));
            }
          } catch {}

          draftStore.removeDraft(pendingId);
          draftStore.addDraft({
            id: newId,
            // NEVER derive a number from the slot id — the slot counter
            // (per-speed-per-year) drifts from the global league number,
            // so `League #${slot}` is almost always wrong by the time
            // the season fills up. Empty contestName signals DraftRow to
            // show "League…" until useLeagueNumberForSlot resolves the
            // real number from the doc's DisplayName.
            contestName: draftRoom.contestName || '',
            status: 'filling',
            type: null,
            draftSpeed: speedParam || 'fast',
            players: joinedCount || 1,
            maxPlayers: 10,
            joinedAt: joinStartedAt,
            phase: 'filling',
            liveWalletAddress: walletParam,
            passType: passTypeParam || 'paid',
            cardId: draftRoom.cardId,
          });
          // addDraft no-ops if a record for this draftId already exists, which
          // would leave a STALE cardId from a previous join — and leaving then
          // sends the wrong token → 409 ("said good but kept me in"). Force the
          // exact token this join landed on so leave refunds the token we
          // actually entered with.
          if (draftRoom.cardId) {
            draftStore.updateDraft(newId, { cardId: draftRoom.cardId });
          }

          return;
        } catch (err) {
          lastErr = err;
          console.warn(`[Draft Room] Join attempt ${attempt}/${MAX_JOIN_RETRIES} failed:`, err instanceof Error ? err.message : err);
          if (attempt < MAX_JOIN_RETRIES) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
      }

      if (cancelled) return;
      console.error('[Draft Room] Failed to join draft after retries:', lastErr);
      reportClientError({
        source: LOG_SOURCES.draft.JOIN_FAILED,
        message: lastErr instanceof Error ? lastErr.message : String(lastErr),
        route: 'draft-room',
        actor: walletParam,
        context: { speed: speedParam || 'fast', passType: passTypeParam || 'paid', attempts: MAX_JOIN_RETRIES },
        stack: lastErr instanceof Error ? lastErr.stack : undefined,
      });
      draftStore.removeDraft(pendingId);
      setJoinStatus('failed');
      setLiveError(lastErr instanceof Error ? lastErr.message : 'Failed to join draft');
    }

    joinAndFill();
    return () => { cancelled = true; };
  }, [isLiveMode, draftId, walletParam, speedParam, passTypeParam, joinAttempt, setDraftId, setPlayerCount]);

  const handleLiveDraft = useCallback((playerId: string) => {
    // Manual-pick / airplane auto-off side effects are handled at the
    // page level (app/draft-room/page.tsx → onDraftPlayer prop) because
    // the airplane icon in live mode reads from the page's `autoDraft`
    // state, which this hook can't touch. Here we just mark the pick as
    // manual so the engine's consecutive-timeout counter resets when the
    // pick echoes back through Firebase.
    engine.markManualPick();
    if (!isLiveMode) {
      engine.draftPlayer(playerId);
      return;
    }

    const pickPayload = engine.draftPlayer(playerId);
    if (pickPayload && draftId) {
      // Submit pick via REST to draft-actions service
      draftApi.submitPickREST(draftId, walletParam, {
        playerId: pickPayload.playerId,
        displayName: pickPayload.displayName,
        team: pickPayload.team,
        position: pickPayload.position,
      }, getAccessTokenRef.current).then(() => {
        logger.debug('[REST] Pick submitted:', pickPayload.playerId);
      }).catch((err) => {
        const msg = err?.message || '';
        const match = msg.match(/already picked (\S+)/);
        const handledByAutopick = engine.airplaneMode && engine.isUserTurn && !!match;
        if (handledByAutopick) {
          const staleId = match[1];
          logger.debug('[Airplane] Removing stale player and retrying:', staleId);
          engine.removeFromAvailable(staleId);
          // Defer to next tick so removeFromAvailable settles before
          // getAutoPickPlayer runs. Was 300ms — no longer visible.
          setTimeout(() => {
            const nextPick = engine.getAutoPickPlayer();
            if (nextPick && draftId) {
              logger.debug('[Airplane] Retrying auto-pick with:', nextPick);
              const retryPayload = engine.draftPlayer(nextPick);
              if (retryPayload) {
                draftApi.submitPickREST(draftId, walletParam, {
                  playerId: retryPayload.playerId,
                  displayName: retryPayload.displayName,
                  team: retryPayload.team,
                  position: retryPayload.position,
                }, getAccessTokenRef.current).catch(e => {
                  console.error('[Airplane] Retry failed:', e);
                  // Stale-player autopick retry ALSO failed → a real dropped pick. Critical.
                  reportClientError({
                    source: LOG_SOURCES.draft.AUTOPICK_SUBMIT_FAILED,
                    message: e instanceof Error ? e.message : String(e),
                    route: 'draft-room',
                    actor: walletParam,
                    context: { draftId, playerId: retryPayload.playerId, retry: true },
                  });
                });
              }
            }
          }, 0);
        } else {
          // Pick-submit failure that the autopick stale-player handler
          // does not cover — surface it so we don't silently drop picks.
          reportClientError({
            source: LOG_SOURCES.draft.PICK_SUBMIT_UNHANDLED,
            message: err instanceof Error ? err.message : String(err),
            route: 'draft-room',
            actor: walletParam,
            context: { draftId, playerId: pickPayload.playerId, airplaneMode: engine.airplaneMode, isUserTurn: engine.isUserTurn },
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, engine.draftPlayer, engine.markManualPick]);

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
    draftApi.updateQueue(walletParam, draftId, payload, getAccessTokenRef.current).catch(err => {
      console.error('[Queue] REST sync failed:', err);
      reportClientError({
        source: LOG_SOURCES.draft.QUEUE_UPDATE_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'draft-room',
        actor: walletParam,
        context: { draftId, queueSize: payload.length },
        stack: err instanceof Error ? err.stack : undefined,
      });
    });
  }, [isLiveMode, draftId, walletParam]);

  // Firebase RTDB is the primary live-state transport. The standalone
  // WebSocket server (sbs-drafts-server) is being retired by the dev — staging
  // rules now permit /drafts/{id}/realTimeDraftInfo reads (verified
  // 2026-05-25), so the supplementary Firebase listener can fully drive the
  // engine. WS handlers below remain for now as dead code but are not connected;
  // removal of the WS hook + lib/api/websocket.ts is the next migration step.
  const wsEnabled = false;

  const ws = useDraftWebSocket({
    walletAddress: walletParam,
    draftName: draftId,
    enabled: wsEnabled,
    getToken: getAccessToken,
    onCountdownUpdate: (payload) => {
      engine.handleCountdownUpdate(payload);
    },
    onTimerUpdate: (payload) => {
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'timer_update', payload });
        return;
      }
      engine.handleTimerUpdate(payload);
      lastWsUpdateRef.current = Date.now();
    },
    onNewPick: (payload) => {
      logger.debug('[WS] new_pick received:', payload?.playerId, 'pick#', payload?.pickNum, 'initialized:', liveInitializedRef.current);
      if (!liveInitializedRef.current) {
        pendingWsMessagesRef.current.push({ type: 'new_pick', payload });
        logger.debug('[WS] Queued new_pick (engine not ready). Queue size:', pendingWsMessagesRef.current.length);
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
      engine.handleDraftInfoUpdate(payload as unknown as Parameters<typeof engine.handleDraftInfoUpdate>[0]);
      lastWsUpdateRef.current = Date.now();
    },
    onDraftComplete: () => {
      engine.handleDraftComplete();
    },
    onFinalCard: (payload) => {
      engine.handleFinalCard(payload);
    },
    onInvalidPick: (payload) => {
      console.warn('[WS] Invalid pick rejected by server:', payload);
      if (engine.airplaneMode && engine.isUserTurn) {
        const msg = (payload as { errorMessage?: string })?.errorMessage || '';
        const match = msg.match(/already picked (\S+)/);
        if (match) {
          const staleId = match[1];
          logger.debug('[Airplane] Removing stale player and retrying:', staleId);
          engine.removeFromAvailable(staleId);
          setTimeout(() => {
            const nextPick = engine.getAutoPickPlayer();
            if (nextPick) {
              logger.debug('[Airplane] Retrying auto-pick with:', nextPick);
              const retryPayload = engine.draftPlayer(nextPick);
              if (retryPayload) ws.sendPick(retryPayload);
            }
          }, 300);
        }
      }
    },
    onNewQueue: (payload) => {
      const available = engine.availablePlayers;
      const queuePlayers = payload
        .map(q => available.find(a => a.playerId === q.playerId))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);
      engine.reorderQueue(queuePlayers);
    },
    onOpen: () => {
      logger.debug('[WS] Connected to draft server');
      lastWsUpdateRef.current = Date.now();
      if (liveInitializedRef.current && draftId) {
        draftApi.getDraftSummary(draftId).then(summary => {
          const summaryArr = summary;
          if (summaryArr.length > 0) {
            engine.refreshSummaryPicks(summaryArr);
            logger.debug(`[WS Reconnect] Synced ${countSummaryPicks(summaryArr)} picks from summary`);
          }
        }).catch(() => {});
      }
    },
    onClose: () => {
      logger.debug('[WS] Disconnected from draft server');
    },
  });

  useEffect(() => {
    if (!isLiveMode || !draftId) return;
    // Cross-tab coordination: drafting page skips its own WS/poll for this
    // draft if our heartbeat is fresh (< 10s old). Contract is a numeric
    // timestamp. Ownership is handled by always overwriting — last writer
    // wins, and readers only care about recency, not identity.
    const key = `draft-room-ws:${draftId}`;
    const writeHeartbeat = () => localStorage.setItem(key, String(Date.now()));
    writeHeartbeat();
    const interval = setInterval(writeHeartbeat, 3_000);
    return () => {
      clearInterval(interval);
      localStorage.removeItem(key);
    };
  }, [isLiveMode, draftId]);

  useEffect(() => {
    if (!isLiveMode || liveInitializedRef.current || !liveDataReady || !draftId) return;

    const generation = ++loadLiveDataGenerationRef.current;
    const isStaleLoad = () => generation !== loadLiveDataGenerationRef.current;

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
        logger.debug('[Draft Room] Loading draft data for', draftId);

        const [rankingsResult, infoResult, rostersResult, queueResult, summaryResult] =
          await Promise.allSettled([
            retryAsync(() => draftApi.getPlayerRankings(draftId, walletParam)),
            retryAsync(() => draftApi.getDraftInfo(draftId)),
            draftApi.getDraftRosters(draftId),
            draftApi.getQueue(walletParam, draftId, getAccessTokenRef.current),
            draftApi.getDraftSummary(draftId),
          ]);

        const playerRankings = rankingsResult.status === 'fulfilled' ? rankingsResult.value : [];
        const draftInfo = infoResult.status === 'fulfilled' ? infoResult.value : null;
        const serverRosters = rostersResult.status === 'fulfilled'
          ? rostersResult.value
          : ({} as draftApi.RosterState);
        const queue = queueResult.status === 'fulfilled' ? queueResult.value : ([] as draftApi.PlayerStateInfo[]);
        const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : ([] as draftApi.DraftSummaryItem[]);

        if (isStaleLoad()) return;

        if (!draftInfo || (playerRankings as draftApi.PlayerDataResponse[]).length === 0) {
          throw new Error('Required draft data not available yet');
        }

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
          adp: (draftInfo.adp || []).map(a => ({
            adp: a.adp,
            byeWeek: String(a.bye ?? a.byeWeek ?? ''),
            playerId: a.playerId,
          })),
        };

        const queuePayload = (queue as draftApi.PlayerStateInfo[]).map(q => ({
          playerId: q.playerId,
          displayName: q.displayName,
          team: q.team,
          position: q.position,
          ownerAddress: q.ownerAddress,
          pickNum: q.pickNum,
          round: q.round,
        }));

        const rostersForEngine: draftApi.RosterState = {};
        for (const [addr, roster] of Object.entries(serverRosters)) {
          rostersForEngine[addr] = roster;
        }

        const localQueue = engine.queuedPlayers;

        engine.initializeFromServer(
          serverDraftInfo,
          playerRankings,
          summary,
          rostersForEngine,
          queuePayload,
          walletParam,
        );

        if (queuePayload.length === 0 && localQueue.length > 0) {
          engine.reorderQueue(localQueue);
        }

        liveInitializedRef.current = true;
        setEngineReady(true);
        if (loadLiveDataRetryTimeoutRef.current) {
          clearTimeout(loadLiveDataRetryTimeoutRef.current);
          loadLiveDataRetryTimeoutRef.current = null;
        }
        if (loadLiveDataReadyTimeoutRef.current) {
          clearTimeout(loadLiveDataReadyTimeoutRef.current);
          loadLiveDataReadyTimeoutRef.current = null;
        }

        logger.debug('[Draft Room] Engine ready — draft data loaded successfully');

        if (pendingWsMessagesRef.current.length > 0) {
          logger.debug(`[Draft Room] Replaying ${pendingWsMessagesRef.current.length} queued WS messages`);
          for (const msg of pendingWsMessagesRef.current) {
            switch (msg.type) {
              case 'new_pick':
                engine.handleNewPick(msg.payload);
                break;
              case 'timer_update':
                engine.handleTimerUpdate(msg.payload);
                break;
              case 'draft_info_update':
                engine.handleDraftInfoUpdate(msg.payload as unknown as Parameters<typeof engine.handleDraftInfoUpdate>[0]);
                break;
            }
          }
          pendingWsMessagesRef.current = [];
        }
        lastWsUpdateRef.current = Date.now();
        setLiveLoading(false);

        const draftAlreadyStarted = draftInfo.pickNumber > 1 ||
          (draftInfo.draftStartTime && draftInfo.draftStartTime * 1000 < Date.now());
        if (draftAlreadyStarted) {
          logger.debug(`[Draft Room] Draft already at pick ${draftInfo.pickNumber} — skipping countdown, jumping to drafting`);
          setPhase('drafting');
          setMainCountdown(0);
          setShowSlotMachine(false);
          if (draftId) {
            draftStore.updateDraft(draftId, { phase: 'drafting', status: 'drafting', players: 10, isYourTurn: false });
          }
        }
      } catch (err) {
        setLiveLoading(false);

        // ── Patient wait: the draft simply hasn't STARTED yet ──────────────
        // "Required draft data not available yet" while the room is still
        // filling/randomizing is NOT a failure — the backend has no draftOrder
        // until the draft starts, and a slow bot-filled draft can sit filling
        // for minutes. Keep polling patiently WITHOUT touching the
        // fall-to-local budget (liveRetryCountRef). This is the fix for
        // draft.live_load_exhausted_retries firing on slow-filling drafts: the
        // old code burned its ~100s budget and dropped the user into local
        // mode minutes before the (perfectly healthy) draft actually started.
        const notStartedYet = err instanceof Error && err.message === 'Required draft data not available yet';
        const stillFilling = phaseRef.current === 'filling' || phaseRef.current === 'pre-spin'
          || phaseRef.current === 'countdown' || phaseRef.current === 'spinning' || phaseRef.current === 'result';
        const MAX_FILLING_WAITS = 150; // ~150 × 4s ≈ 10 min — far beyond any real fill
        if (notStartedYet && stillFilling && fillingWaitCountRef.current < MAX_FILLING_WAITS) {
          fillingWaitCountRef.current += 1;
          clientLog('liveload', 'waiting-for-draft-start', {
            draftId, phase: phaseRef.current, waits: fillingWaitCountRef.current,
          });
          if (loadLiveDataRetryTimeoutRef.current) clearTimeout(loadLiveDataRetryTimeoutRef.current);
          if (loadLiveDataReadyTimeoutRef.current) clearTimeout(loadLiveDataReadyTimeoutRef.current);
          loadLiveDataRetryTimeoutRef.current = setTimeout(() => {
            liveInitializedRef.current = false;
            setLiveDataReady(false);
            loadLiveDataReadyTimeoutRef.current = setTimeout(() => {
              setLiveDataReady(true);
              loadLiveDataReadyTimeoutRef.current = null;
            }, 100);
            loadLiveDataRetryTimeoutRef.current = null;
          }, 4000);
          return;
        }
        // ───────────────────────────────────────────────────────────────────

        const MAX_OUTER_RETRIES = 8;
        liveRetryCountRef.current += 1;
        console.error(`[Live Mode] loadLiveData attempt ${liveRetryCountRef.current}/${MAX_OUTER_RETRIES} failed:`, err);

        if (liveRetryCountRef.current >= MAX_OUTER_RETRIES) {
          logger.debug('[Draft Room] All retries exhausted — falling back to local mode');
          reportClientError({
            source: LOG_SOURCES.draft.LIVE_LOAD_EXHAUSTED,
            message: err instanceof Error ? err.message : String(err),
            route: 'draft-room',
            actor: walletParam,
            context: {
              draftId,
              attempts: liveRetryCountRef.current,
              maxRetries: MAX_OUTER_RETRIES,
              phase: phaseRef.current,
              fillingWaits: fillingWaitCountRef.current,
              // If fillingWaits hit the ceiling, this draft was stuck FILLING for
              // ~10min (real problem) rather than just genuinely-broken data.
              stuckWhileFilling: fillingWaitCountRef.current >= 150,
            },
            stack: err instanceof Error ? err.stack : undefined,
          });
          setFallbackLocal(true);
          liveInitializedRef.current = true;
        } else {
          logger.debug('[Live Mode] Auto-retrying in 5s...');
          if (loadLiveDataRetryTimeoutRef.current) clearTimeout(loadLiveDataRetryTimeoutRef.current);
          if (loadLiveDataReadyTimeoutRef.current) clearTimeout(loadLiveDataReadyTimeoutRef.current);
          loadLiveDataRetryTimeoutRef.current = setTimeout(() => {
            if (isStaleLoad()) return;
            liveInitializedRef.current = false;
            setLiveDataReady(false);
            loadLiveDataReadyTimeoutRef.current = setTimeout(() => {
              if (isStaleLoad()) return;
              setLiveDataReady(true);
              loadLiveDataReadyTimeoutRef.current = null;
            }, 100);
            loadLiveDataRetryTimeoutRef.current = null;
          }, 5000);
        }
      }
    }

    void loadLiveData();

    return () => {
      loadLiveDataGenerationRef.current += 1;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, walletParam, liveDataReady]);

  useEffect(() => {
    return () => {
      if (loadLiveDataRetryTimeoutRef.current) {
        clearTimeout(loadLiveDataRetryTimeoutRef.current);
        loadLiveDataRetryTimeoutRef.current = null;
      }
      if (loadLiveDataReadyTimeoutRef.current) {
        clearTimeout(loadLiveDataReadyTimeoutRef.current);
        loadLiveDataReadyTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isLiveMode || !draftId || engine.draftStatus === 'completed') return;

    const STALE_THRESHOLD = 30_000;
    const CHECK_INTERVAL = 10_000;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastFirebaseUpdateRef.current;

      if (elapsed > STALE_THRESHOLD) {
        const now = Date.now();
        if (now - lastWatchdogAttemptRef.current < watchdogBackoffRef.current) {
          return;
        }
        lastWatchdogAttemptRef.current = now;

        console.warn(`[Watchdog] No Firebase RTDB update in ${Math.round(elapsed / 1000)}s — re-syncing from REST`);

        if (liveInitializedRef.current) {
          const summaryPromise = draftApi.getDraftSummary(draftId).then(summary => {
            const summaryArr = summary;
            if (summaryArr.length > 0) {
              engine.refreshSummaryPicks(summaryArr);
              logger.debug(`[Watchdog] Re-synced ${countSummaryPicks(summaryArr)} picks from REST`);
            }
          }).catch((err) => {
            reportClientError({
              source: LOG_SOURCES.draft.WATCHDOG_RESYNC_FAILED,
              message: err instanceof Error ? err.message : String(err),
              route: 'draft-room',
              actor: walletParam,
              context: { draftId, call: 'getDraftSummary' },
              stack: err instanceof Error ? err.stack : undefined,
            });
            throw err;
          });

          const infoPromise = draftApi.getDraftInfo(draftId).then(info => {
            // Defensive null-handling: the Go backend can return null for
            // `adp` (and occasionally other arrays) during state
            // transitions or after a draft completes. Without these
            // fallbacks, `info.adp.map(...)` crashed the watchdog with
            // "Cannot read properties of null (reading 'map')" — two
            // users hit it 10× in the wild before this guard landed.
            engine.handleDraftInfoUpdate({
              draftId: info.draftId,
              displayName: info.displayName,
              draftStartTime: info.draftStartTime,
              pickLength: info.pickLength,
              currentDrafter: info.currentDrafter,
              pickNumber: info.pickNumber,
              roundNum: info.roundNum,
              pickInRound: info.pickInRound,
              draftOrder: info.draftOrder ?? [],
              adp: (info.adp ?? []).map(a => ({
                adp: a.adp,
                byeWeek: String(a.bye ?? a.byeWeek ?? ''),
                playerId: a.playerId,
              })),
            });
            logger.debug(`[Watchdog] Re-synced draft info: pick ${info.pickNumber}, drafter ${info.currentDrafter.slice(0, 8)}...`);
          }).catch((err) => {
            reportClientError({
              source: LOG_SOURCES.draft.WATCHDOG_RESYNC_FAILED,
              message: err instanceof Error ? err.message : String(err),
              route: 'draft-room',
              actor: walletParam,
              context: { draftId, call: 'getDraftInfo' },
              stack: err instanceof Error ? err.stack : undefined,
            });
            throw err;
          });

          void Promise.allSettled([summaryPromise, infoPromise]).then((results) => {
            const allOk = results.every(r => r.status === 'fulfilled');
            if (allOk) {
              lastFirebaseUpdateRef.current = Date.now();
              watchdogBackoffRef.current = 5_000;
            } else {
              watchdogBackoffRef.current = Math.min(watchdogBackoffRef.current * 2, 60_000);
            }
          });
        }
      }
    }, CHECK_INTERVAL);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveMode, draftId, engine.draftStatus]);

  const retryLiveSync = useCallback(() => {
    setLiveError(null);
    if (!draftId) {
      setJoinStatus('idle');
      setJoinAttempt((a) => a + 1);
      return;
    }
    if (loadLiveDataRetryTimeoutRef.current) {
      clearTimeout(loadLiveDataRetryTimeoutRef.current);
      loadLiveDataRetryTimeoutRef.current = null;
    }
    if (loadLiveDataReadyTimeoutRef.current) {
      clearTimeout(loadLiveDataReadyTimeoutRef.current);
      loadLiveDataReadyTimeoutRef.current = null;
    }
    liveRetryCountRef.current = 0;
    fillingWaitCountRef.current = 0;
    liveInitializedRef.current = false;
    setLiveDataReady(false);
    loadLiveDataReadyTimeoutRef.current = setTimeout(() => {
      setLiveDataReady(true);
      loadLiveDataReadyTimeoutRef.current = null;
    }, 100);
  }, [draftId, setLiveDataReady]);

  const bestTimeRemaining = useMemo(() => {
    const value = (firebaseActive && firebaseTimeRemaining !== null)
      ? firebaseTimeRemaining
      : engine.timeRemaining;
    return capDisplayTimeRemaining(value ?? 0, firebasePickLength);
  }, [firebaseActive, firebaseTimeRemaining, engine.timeRemaining, firebasePickLength]);

  // Slow drafts pause overnight (22:00–05:00 PT). Surface whether this is a slow
  // draft and whether the clock is currently frozen so the UI can show the
  // "paused, you can still pick" copy. Polled because during the pause the timer
  // value is constant (no re-render) — we still need to flip the flag at 05:00.
  const isSlowDraft = isSlowDraftPickLength(firebasePickLength ?? 0);
  const [isSlowDraftPaused, setIsSlowDraftPaused] = useState(false);
  useEffect(() => {
    if (!firebaseActive || !isSlowDraft) {
      setIsSlowDraftPaused(false);
      return;
    }
    const check = () => setIsSlowDraftPaused(isSlowDraftNightPause(Math.floor(Date.now() / 1000)));
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [firebaseActive, isSlowDraft]);

  return {
    liveLoading,
    liveError,
    setLiveError,
    retryLiveSync,
    engineReady,
    setEngineReady,
    firebaseActive,
    firebaseRtdb,
    ws,
    bestTimeRemaining,
    isSlowDraft,
    isSlowDraftPaused,
    handleLiveDraft,
    handleLiveQueueSync,
    liveInitializedRef,
    lastWsUpdateRef,
    draftIdRef,
  };
}
